import { createHash } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { HttpsError } from "firebase-functions/v2/https";
import { db, FieldValue, Timestamp, appUrl } from "./core.js";

/**
 * Accès à l'API REST Identity Toolkit (Firebase Auth) depuis le serveur.
 * - Vérification d'un mot de passe sans jamais exposer l'e-mail associé à un identifiant client.
 * - Envoi des e-mails de réinitialisation par Firebase (modèles configurés dans la console).
 * En émulation, les appels sont dirigés vers l'émulateur Auth.
 */
function identityBase(): string {
  const emu = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  return emu ? `http://${emu}/identitytoolkit.googleapis.com/v1` : "https://identitytoolkit.googleapis.com/v1";
}

function apiKey(): string {
  const key = process.env.WEB_API_KEY;
  if (key) return key;
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) return "demo-api-key";
  throw new HttpsError("failed-precondition", "Configuration serveur incomplète (WEB_API_KEY).");
}

async function identityCall(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(`${identityBase()}/${path}?key=${encodeURIComponent(apiKey())}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

export type PasswordCheck = { ok: true; uid: string } | { ok: false; reason: "invalid" | "disabled" | "throttled" | "error" };

/** Vérifie un couple e-mail / mot de passe. Le mot de passe n'est ni stocké ni journalisé. */
export async function verifyPassword(email: string, password: string): Promise<PasswordCheck> {
  const { ok, data } = await identityCall("accounts:signInWithPassword", { email, password, returnSecureToken: true });
  if (ok && typeof data.localId === "string") return { ok: true, uid: data.localId };
  const message = String((data.error as { message?: string } | undefined)?.message ?? "");
  if (message.startsWith("USER_DISABLED")) return { ok: false, reason: "disabled" };
  if (message.startsWith("TOO_MANY_ATTEMPTS")) return { ok: false, reason: "throttled" };
  if (/EMAIL_NOT_FOUND|INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS|INVALID_EMAIL|MISSING_PASSWORD/.test(message)) {
    return { ok: false, reason: "invalid" };
  }
  console.error("verifyPassword: réponse inattendue", message || "inconnue");
  return { ok: false, reason: "error" };
}

/** Firebase envoie lui-même l'e-mail de définition / réinitialisation du mot de passe. */
export async function sendPasswordResetEmail(email: string): Promise<boolean> {
  const { ok, data } = await identityCall("accounts:sendOobCode", {
    requestType: "PASSWORD_RESET",
    email,
    continueUrl: `${appUrl()}/definir-mot-de-passe`,
  });
  if (!ok) console.error("sendPasswordResetEmail: échec", (data.error as { message?: string } | undefined)?.message);
  return ok;
}

export type OobVerifyResult = { ok: true; email: string } | { ok: false; reason: "invalid" | "error" };
export type OobConsumeResult = { ok: true; email: string } | { ok: false; reason: "invalid" | "weak" | "error" };

/** Vérifie un code OOB Firebase Auth sans le consommer et sans jamais exposer d'e-mail technique au navigateur. */
export async function verifyOobPasswordCode(oobCode: string): Promise<OobVerifyResult> {
  const { ok, data } = await identityCall("accounts:resetPassword", { oobCode });
  if (ok && typeof data.email === "string") {
    return { ok: true, email: data.email.toLowerCase() };
  }
  const message = String((data.error as { message?: string } | undefined)?.message ?? "");
  if (/INVALID_OOB_CODE|EXPIRED_OOB_CODE|USER_DISABLED|EMAIL_NOT_FOUND/.test(message)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: false, reason: "error" };
}

/** Consomme le code OOB à usage unique dans Firebase Auth et définit le nouveau mot de passe. */
export async function consumeOobPasswordCode(oobCode: string, newPassword: string): Promise<OobConsumeResult> {
  const { ok, data } = await identityCall("accounts:resetPassword", { oobCode, newPassword });
  if (ok && typeof data.email === "string") {
    return { ok: true, email: data.email.toLowerCase() };
  }
  const message = String((data.error as { message?: string } | undefined)?.message ?? "");
  if (message.includes("WEAK_PASSWORD")) {
    return { ok: false, reason: "weak" };
  }
  if (/INVALID_OOB_CODE|EXPIRED_OOB_CODE|USER_DISABLED|EMAIL_NOT_FOUND/.test(message)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: false, reason: "error" };
}

const SETUP_LINK_TTL_MS = 24 * 3600 * 1000; // 24 heures

export function hashOobCode(oobCode: string): string {
  return hash(`oob:${oobCode}`);
}

/**
 * Génère un lien sécurisé à usage unique permettant au client de définir son mot de passe
 * directement sur l'interface SHENA Express (/definir-mot-de-passe), en révoquant tout lien précédent.
 */
export async function createClientPasswordSetupLink(email: string, clientId: string, clientUid: string): Promise<string> {
  const rawLink = await getAuth().generatePasswordResetLink(email, { url: `${appUrl()}/definir-mot-de-passe` });
  const parsed = new URL(rawLink);
  const oobCode = parsed.searchParams.get("oobCode");
  if (!oobCode) {
    throw new HttpsError("internal", "Impossible de générer le code de configuration du mot de passe.");
  }

  const prevSnap = await db()
    .collection("passwordSetupTokens")
    .where("clientId", "==", clientId)
    .where("revoked", "==", false)
    .get();

  const batch = db().batch();
  const now = Date.now();
  for (const d of prevSnap.docs) {
    batch.update(d.ref, { revoked: true, updatedAt: FieldValue.serverTimestamp() });
  }
  batch.set(db().collection("passwordSetupTokens").doc(hashOobCode(oobCode)), {
    clientId,
    clientUid,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(now + SETUP_LINK_TTL_MS),
    usedAt: null,
    revoked: false,
  });
  await batch.commit();

  return `${appUrl()}/definir-mot-de-passe?oobCode=${encodeURIComponent(oobCode)}&clientId=${encodeURIComponent(clientId)}`;
}

/** Vérifie qu'un jeton de configuration n'a été ni révoqué, ni déjà utilisé, ni expiré. */
export async function assertSetupTokenUsable(oobCode: string): Promise<void> {
  const snap = await db().collection("passwordSetupTokens").doc(hashOobCode(oobCode)).get();
  if (!snap.exists) return;
  const data = snap.data() as { revoked?: boolean; usedAt?: Timestamp | null; expiresAt?: Timestamp };
  if (data.revoked || data.usedAt) {
    throw new HttpsError("failed-precondition", "Ce lien de configuration a déjà été utilisé ou remplacé par un lien plus récent.");
  }
  if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) {
    throw new HttpsError("failed-precondition", "Ce lien de configuration a expiré. Demandez un nouveau lien à SHENA Express.");
  }
}

/* ------------------------------------------------------------ throttling */
const hash = (v: string) => createHash("sha256").update(v).digest("hex").slice(0, 40);

export interface ThrottlePolicy {
  scope: string;
  maxAttempts: number;
  windowMinutes: number;
  lockMinutes: number;
}

export const LOGIN_POLICY: ThrottlePolicy = { scope: "login", maxAttempts: 5, windowMinutes: 15, lockMinutes: 15 };
export const LOGIN_IP_POLICY: ThrottlePolicy = { scope: "login-ip", maxAttempts: 30, windowMinutes: 15, lockMinutes: 15 };
export const RESET_POLICY: ThrottlePolicy = { scope: "reset", maxAttempts: 3, windowMinutes: 60, lockMinutes: 60 };
export const RESET_IP_POLICY: ThrottlePolicy = { scope: "reset-ip", maxAttempts: 10, windowMinutes: 60, lockMinutes: 60 };

function throttleRef(policy: ThrottlePolicy, key: string) {
  return db().collection("rateLimits").doc(`${policy.scope}_${hash(key)}`);
}

/** Lève une erreur si la clé est verrouillée. */
export async function assertNotLocked(policy: ThrottlePolicy, key: string): Promise<void> {
  const snap = await throttleRef(policy, key).get();
  const lockedUntil = snap.data()?.lockedUntil as Timestamp | undefined;
  if (lockedUntil && lockedUntil.toMillis() > Date.now()) {
    const minutes = Math.ceil((lockedUntil.toMillis() - Date.now()) / 60000);
    throw new HttpsError("resource-exhausted", `Trop de tentatives. Réessayez dans ${minutes} minute(s).`);
  }
}

/** Enregistre une tentative (échec de connexion ou demande de réinitialisation). */
export async function recordAttempt(policy: ThrottlePolicy, key: string): Promise<void> {
  const ref = throttleRef(policy, key);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const data = snap.data() ?? {};
    const windowStart = (data.windowStart as Timestamp | undefined)?.toMillis() ?? 0;
    const inWindow = now - windowStart < policy.windowMinutes * 60000;
    const count = (inWindow ? (data.count as number) || 0 : 0) + 1;
    const update: Record<string, unknown> = {
      count,
      windowStart: inWindow ? data.windowStart : Timestamp.fromMillis(now),
      updatedAt: FieldValue.serverTimestamp(),
      // Suppression automatique possible via une politique TTL Firestore sur ce champ.
      expireAt: Timestamp.fromMillis(now + 24 * 3600 * 1000),
    };
    if (count >= policy.maxAttempts) update.lockedUntil = Timestamp.fromMillis(now + policy.lockMinutes * 60000);
    tx.set(ref, update, { merge: true });
  });
}

export async function resetAttempts(policy: ThrottlePolicy, key: string): Promise<void> {
  await throttleRef(policy, key).delete();
}
