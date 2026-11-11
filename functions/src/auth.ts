import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import {
  clientSignInSchema,
  passwordResetSchema,
  verifySetupTokenSchema,
  completePasswordSetupSchema,
  normalizeClientIdentifier,
  CLIENT_ID_RE,
  type ClientDoc,
} from "../../shared/index.js";
import { db, parse, audit, FieldValue } from "./lib/core.js";
import {
  assertNotLocked,
  recordAttempt,
  resetAttempts,
  verifyPassword,
  sendPasswordResetEmail,
  verifyOobPasswordCode,
  consumeOobPasswordCode,
  assertSetupTokenUsable,
  hashOobCode,
  LOGIN_POLICY,
  LOGIN_IP_POLICY,
  RESET_POLICY,
  RESET_IP_POLICY,
} from "./lib/identity.js";
import { callableOptions } from "./lib/options.js";

const GENERIC_LOGIN_ERROR = "Identifiant ou mot de passe incorrect.";

function clientIp(req: CallableRequest<unknown>): string {
  const fwd = req.rawRequest?.headers?.["x-forwarded-for"];
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(",")[0];
  return (first || req.rawRequest?.ip || "unknown").trim();
}

/**
 * Connexion par identifiant client (ex. SHE-CLIENT-001).
 * Le serveur résout l'identifiant vers le compte Firebase Auth, vérifie le mot de passe
 * puis renvoie un jeton personnalisé. L'e-mail associé n'est JAMAIS renvoyé au navigateur,
 * la réponse d'erreur est identique que l'identifiant existe ou non, et les tentatives
 * sont limitées par identifiant et par adresse IP.
 */
export const clientSignIn = onCall(callableOptions({ public: true }), async (req) => {
  const { identifier, password } = parse(clientSignInSchema, req.data);
  const id = normalizeClientIdentifier(identifier);
  const ip = clientIp(req);
  await assertNotLocked(LOGIN_POLICY, id);
  await assertNotLocked(LOGIN_IP_POLICY, ip);

  const failure = async (): Promise<never> => {
    await Promise.all([recordAttempt(LOGIN_POLICY, id), recordAttempt(LOGIN_IP_POLICY, ip)]);
    throw new HttpsError("unauthenticated", GENERIC_LOGIN_ERROR);
  };

  if (!CLIENT_ID_RE.test(id)) return failure();
  const clientSnap = await db().collection("clients").doc(id).get();
  if (!clientSnap.exists) return failure();
  const client = clientSnap.data() as { clientUid: string; status: string };

  let email: string | undefined;
  try {
    email = (await getAuth().getUser(client.clientUid)).email;
  } catch {
    return failure();
  }
  if (!email) return failure();

  const check = await verifyPassword(email, password);
  if (!check.ok) {
    if (check.reason === "error") throw new HttpsError("unavailable", "Service momentanément indisponible. Réessayez.");
    if (check.reason === "throttled") throw new HttpsError("resource-exhausted", "Trop de tentatives. Réessayez plus tard.");
    if (check.reason === "disabled") {
      await recordAttempt(LOGIN_POLICY, id);
      throw new HttpsError("permission-denied", "Cet accès est désactivé. Contactez SHENA Express.");
    }
    return failure();
  }
  if (check.uid !== client.clientUid) return failure();
  if (client.status !== "active") throw new HttpsError("permission-denied", "Cet accès est désactivé. Contactez SHENA Express.");

  if ((client as { passwordConfigured?: boolean }).passwordConfigured === false) {
    await db().collection("clients").doc(id).update({
      passwordConfigured: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await resetAttempts(LOGIN_POLICY, id);
  const token = await getAuth().createCustomToken(client.clientUid);
  return { token };
});

/**
 * « Mot de passe oublié » : accepte un identifiant client ou une adresse e-mail.
 * Envoie le lien uniquement à l'adresse réelle enregistrée sur le compte.
 * Réponse toujours identique (aucune énumération des comptes ni des e-mails).
 */
export const requestPasswordReset = onCall(callableOptions({ public: true }), async (req) => {
  const { identifier } = parse(passwordResetSchema, req.data);
  const ip = clientIp(req);
  const key = identifier.trim().toLowerCase();
  await assertNotLocked(RESET_IP_POLICY, ip);
  await recordAttempt(RESET_IP_POLICY, ip);
  try {
    await assertNotLocked(RESET_POLICY, key);
  } catch {
    return { ok: true };
  }
  await recordAttempt(RESET_POLICY, key);

  let email: string | null = null;
  if (key.includes("@")) {
    try {
      const user = await getAuth().getUserByEmail(key);
      const clientSnap = await db().collection("clients").where("clientUid", "==", user.uid).limit(1).get();
      const real = clientSnap.empty || clientSnap.docs[0]!.data().hasRealEmail === true;
      if (real && !user.disabled) email = user.email ?? null;
    } catch {
      email = null;
    }
  } else {
    const id = normalizeClientIdentifier(identifier);
    if (CLIENT_ID_RE.test(id)) {
      const snap = await db().collection("clients").doc(id).get();
      const data = snap.data() as { clientUid: string; hasRealEmail: boolean; status: string } | undefined;
      if (data?.hasRealEmail && data.status === "active") {
        try {
          const user = await getAuth().getUser(data.clientUid);
          email = user.email ?? null;
        } catch {
          email = null;
        }
      }
    }
  }
  if (email) await sendPasswordResetEmail(email);
  return { ok: true };
});

async function resolveClientFromOob(oobCode: string): Promise<{ client: ClientDoc; email: string }> {
  await assertSetupTokenUsable(oobCode);
  const check = await verifyOobPasswordCode(oobCode);
  if (!check.ok) {
    throw new HttpsError("invalid-argument", "Ce lien de configuration est invalide, expiré ou a déjà été utilisé.");
  }
  let uid: string;
  let disabled: boolean;
  try {
    const user = await getAuth().getUserByEmail(check.email);
    uid = user.uid;
    disabled = Boolean(user.disabled);
  } catch {
    throw new HttpsError("invalid-argument", "Ce lien de configuration est invalide ou a expiré.");
  }
  const clientSnap = await db().collection("clients").where("clientUid", "==", uid).limit(1).get();
  if (clientSnap.empty) {
    throw new HttpsError("not-found", "Aucun compte client associé à ce lien.");
  }
  const client = clientSnap.docs[0]!.data() as ClientDoc;
  if (disabled || client.status !== "active") {
    throw new HttpsError("permission-denied", "Ce compte client est désactivé. Contactez SHENA Express.");
  }
  return { client, email: check.email };
}

/**
 * Vérifie un lien de définition / réinitialisation de mot de passe sans le consommer
 * et sans jamais exposer d'adresse e-mail technique (.invalid) au navigateur.
 */
export const verifyPasswordSetupToken = onCall(callableOptions({ public: true }), async (req) => {
  const { oobCode } = parse(verifySetupTokenSchema, req.data);
  const ip = clientIp(req);
  await assertNotLocked(RESET_IP_POLICY, ip);
  const { client } = await resolveClientFromOob(oobCode);
  return {
    valid: true,
    clientId: client.clientId,
    fullName: client.fullName,
  };
});

/**
 * Définit le mot de passe du client à partir du lien sécurisé à usage unique,
 * consomme immédiatement le jeton et active l'accès au compte.
 */
export const completePasswordSetup = onCall(callableOptions({ public: true }), async (req) => {
  const { oobCode, newPassword } = parse(completePasswordSetupSchema, req.data);
  const ip = clientIp(req);
  await assertNotLocked(RESET_IP_POLICY, ip);

  const { client } = await resolveClientFromOob(oobCode);
  const consumed = await consumeOobPasswordCode(oobCode, newPassword);
  if (!consumed.ok) {
    await recordAttempt(RESET_IP_POLICY, ip);
    if (consumed.reason === "weak") {
      throw new HttpsError("invalid-argument", "Ce mot de passe est trop faible. Choisissez au moins 8 caractères avec lettres et chiffres.");
    }
    throw new HttpsError("invalid-argument", "Ce lien de configuration est invalide, expiré ou a déjà été utilisé.");
  }

  if (client.hasRealEmail) {
    await getAuth().updateUser(client.clientUid, { emailVerified: true }).catch(() => undefined);
  }

  const batch = db().batch();
  batch.update(db().doc(`clients/${client.clientId}`), {
    passwordConfigured: true,
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(
    db().collection("passwordSetupTokens").doc(hashOobCode(oobCode)),
    {
      clientId: client.clientId,
      clientUid: client.clientUid,
      usedAt: FieldValue.serverTimestamp(),
      revoked: true,
    },
    { merge: true },
  );
  audit(
    batch,
    { uid: client.clientUid, role: "client", claims: { role: "client", clientId: client.clientId } },
    "client.password_configured",
    "client",
    client.clientId,
    `Définition du mot de passe par le client ${client.clientId}`,
  );
  await batch.commit();
  await resetAttempts(LOGIN_POLICY, client.clientId);

  return { ok: true, clientId: client.clientId };
});
