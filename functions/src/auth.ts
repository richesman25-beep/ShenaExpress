import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { clientSignInSchema, passwordResetSchema, normalizeClientIdentifier, CLIENT_ID_RE } from "../../shared/index.js";
import { db, parse } from "./lib/core.js";
import {
  assertNotLocked,
  recordAttempt,
  resetAttempts,
  verifyPassword,
  sendPasswordResetEmail,
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
