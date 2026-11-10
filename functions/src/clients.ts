import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import {
  createClientSchema,
  updateClientSchema,
  clientRefSchema,
  setClientStatusSchema,
  clientNotesSchema,
  formatClientId,
  buildSearchTokens,
  type ClientDoc,
} from "../../shared/index.js";
import { db, parse, audit, nextSequence, FieldValue, fail, requirePermission, appUrl } from "./lib/core.js";
import { sendPasswordResetEmail } from "./lib/identity.js";
import { callableOptions } from "./lib/options.js";

/** Domaine technique réservé (RFC 2606) pour les clients sans e-mail : aucun message n'y est envoyé. */
const TECHNICAL_DOMAIN = "clients.shena-express.invalid";
const technicalEmail = (clientId: string) => `${clientId.toLowerCase()}@${TECHNICAL_DOMAIN}`;
const phoneKey = (phone: string) => phone.replace(/\D/g, "");

function clientTokens(p: { clientId: string; fullName: string; phone: string; whatsapp?: string | null; email?: string | null; city?: string | null }) {
  return buildSearchTokens(p.clientId, p.fullName, p.phone, p.whatsapp, p.email, p.city);
}

async function assertNoDuplicate(phone: string, email: string | null, exceptClientId?: string) {
  const dupPhone = await db().collection("clients").where("phoneKey", "==", phoneKey(phone)).limit(2).get();
  if (dupPhone.docs.some((d) => d.id !== exceptClientId)) {
    fail("already-exists", "Un client avec ce numéro de téléphone existe déjà.");
  }
  if (email) {
    const dupEmail = await db().collection("clients").where("email", "==", email).limit(2).get();
    if (dupEmail.docs.some((d) => d.id !== exceptClientId)) fail("already-exists", "Un client avec cette adresse e-mail existe déjà.");
  }
}

/** Création d'un client : identifiant séquentiel unique, compte Auth sans mot de passe, invitation optionnelle. */
export const createClient = onCall(callableOptions(), async (req) => {
  const actor = requirePermission(req, "clients.write");
  const input = parse(createClientSchema, req.data);
  await assertNoDuplicate(input.phone, input.email);

  // 1) Réservation de l'identifiant (le compteur n'est jamais décrémenté : pas de réutilisation).
  const clientId = await db().runTransaction(async (tx) => formatClientId(await nextSequence(tx, "clients")));

  // 2) Compte Firebase Auth (aucun mot de passe : le client le définit via le lien sécurisé).
  const email = input.email ?? technicalEmail(clientId);
  let uid: string;
  try {
    const user = await getAuth().createUser({ email, emailVerified: false, displayName: input.fullName, disabled: false });
    uid = user.uid;
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "auth/email-already-exists") fail("already-exists", "Cette adresse e-mail est déjà utilisée par un autre compte.");
    throw e;
  }
  await getAuth().setCustomUserClaims(uid, { role: "client", clientId });

  // 3) Documents Firestore + audit (en cas d'échec, le compte Auth est supprimé).
  try {
    const batch = db().batch();
    const now = FieldValue.serverTimestamp();
    batch.set(db().doc(`users/${uid}`), {
      uid,
      role: "client",
      clientId,
      displayName: input.fullName,
      email: input.email,
      disabled: false,
      createdAt: now,
      updatedAt: now,
    });
    batch.set(db().doc(`clients/${clientId}`), {
      clientId,
      clientUid: uid,
      fullName: input.fullName,
      phone: input.phone,
      phoneKey: phoneKey(input.phone),
      whatsapp: input.whatsapp,
      email: input.email,
      hasRealEmail: !!input.email,
      address: input.address,
      city: input.city,
      status: "active",
      searchTokens: clientTokens({ clientId, ...input }),
      createdAt: now,
      updatedAt: now,
    });
    batch.set(db().doc(`clientNotes/${clientId}`), { clientId, notes: input.notes ?? "", updatedAt: now, updatedBy: actor.uid });
    audit(batch, actor, "client.create", "client", clientId, `Création du client ${clientId} (${input.fullName})`);
    await batch.commit();
  } catch (e) {
    await getAuth().deleteUser(uid).catch(() => undefined);
    throw e;
  }

  let inviteSent = false;
  if (input.sendInvite && input.email) inviteSent = await sendPasswordResetEmail(input.email);
  return { clientId, inviteSent };
});

export const updateClient = onCall(callableOptions(), async (req) => {
  const actor = requirePermission(req, "clients.write");
  const input = parse(updateClientSchema, req.data);
  const ref = db().doc(`clients/${input.clientId}`);
  const snap = await ref.get();
  if (!snap.exists) fail("not-found", "Client introuvable.");
  const current = snap.data() as ClientDoc;
  await assertNoDuplicate(input.phone, input.email, input.clientId);

  const emailChanged = (input.email ?? null) !== (current.hasRealEmail ? current.email ?? null : null);
  if (emailChanged) {
    try {
      await getAuth().updateUser(current.clientUid, {
        email: input.email ?? technicalEmail(input.clientId),
        emailVerified: false,
      });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === "auth/email-already-exists") fail("already-exists", "Cette adresse e-mail est déjà utilisée.");
      throw e;
    }
  }
  await getAuth().updateUser(current.clientUid, { displayName: input.fullName });

  const batch = db().batch();
  batch.update(ref, {
    fullName: input.fullName,
    phone: input.phone,
    phoneKey: phoneKey(input.phone),
    whatsapp: input.whatsapp,
    email: input.email,
    hasRealEmail: !!input.email,
    address: input.address,
    city: input.city,
    searchTokens: clientTokens(input),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.update(db().doc(`users/${current.clientUid}`), { displayName: input.fullName, email: input.email, updatedAt: FieldValue.serverTimestamp() });
  audit(batch, actor, "client.update", "client", input.clientId, `Modification du client ${input.clientId}`, {
    emailChanged,
    fields: Object.keys(input).filter((k) => k !== "clientId" && (input as Record<string, unknown>)[k] !== (current as unknown as Record<string, unknown>)[k]),
  });
  await batch.commit();
  return { ok: true };
});

/** Désactivation / réactivation : compte Auth désactivé et sessions révoquées. */
export const setClientStatus = onCall(callableOptions(), async (req) => {
  const actor = requirePermission(req, "clients.write");
  const { clientId, active } = parse(setClientStatusSchema, req.data);
  const ref = db().doc(`clients/${clientId}`);
  const snap = await ref.get();
  if (!snap.exists) fail("not-found", "Client introuvable.");
  const client = snap.data() as ClientDoc;
  await getAuth().updateUser(client.clientUid, { disabled: !active });
  if (!active) await getAuth().revokeRefreshTokens(client.clientUid);
  const batch = db().batch();
  batch.update(ref, { status: active ? "active" : "disabled", updatedAt: FieldValue.serverTimestamp() });
  batch.update(db().doc(`users/${client.clientUid}`), { disabled: !active, updatedAt: FieldValue.serverTimestamp() });
  audit(batch, actor, active ? "client.enable" : "client.disable", "client", clientId, `${active ? "Réactivation" : "Désactivation"} de l'accès ${clientId}`);
  await batch.commit();
  return { ok: true };
});

/** Invitation par e-mail : Firebase envoie un lien permettant au client de définir son mot de passe. */
export const sendClientInvite = onCall(callableOptions(), async (req) => {
  const actor = requirePermission(req, "clients.write");
  const { clientId } = parse(clientRefSchema, req.data);
  const snap = await db().doc(`clients/${clientId}`).get();
  if (!snap.exists) fail("not-found", "Client introuvable.");
  const client = snap.data() as ClientDoc;
  if (client.status !== "active") fail("failed-precondition", "Réactivez d'abord l'accès de ce client.");
  if (!client.hasRealEmail || !client.email) fail("failed-precondition", "Ce client n'a pas d'adresse e-mail. Utilisez un lien d'accès à transmettre manuellement.");
  const sent = await sendPasswordResetEmail(client.email);
  if (!sent) throw new HttpsError("unavailable", "L'e-mail n'a pas pu être envoyé. Réessayez plus tard.");
  const batch = db().batch();
  audit(batch, actor, "client.invite", "client", clientId, `Invitation envoyée à ${clientId}`);
  await batch.commit();
  return { sent: true };
});

/**
 * Assistance administrative : génère un lien à usage unique (expiration courte) permettant au client
 * de définir un nouveau mot de passe, sans que l'administrateur ne le connaisse jamais.
 * À transmettre au client par un canal vérifié (WhatsApp officiel, en personne).
 */
export const generateClientAccessLink = onCall(callableOptions(), async (req) => {
  const actor = requirePermission(req, "clients.write");
  const { clientId } = parse(clientRefSchema, req.data);
  const snap = await db().doc(`clients/${clientId}`).get();
  if (!snap.exists) fail("not-found", "Client introuvable.");
  const client = snap.data() as ClientDoc;
  if (client.status !== "active") fail("failed-precondition", "Réactivez d'abord l'accès de ce client.");
  const user = await getAuth().getUser(client.clientUid);
  if (!user.email) fail("failed-precondition", "Compte incomplet.");
  await getAuth().revokeRefreshTokens(client.clientUid);
  const link = await getAuth().generatePasswordResetLink(user.email, { url: `${appUrl()}/connexion` });
  const batch = db().batch();
  audit(batch, actor, "client.access_link", "client", clientId, `Lien d'accès généré pour ${clientId} (sessions révoquées)`);
  await batch.commit();
  return { link };
});

export const saveClientNotes = onCall(callableOptions(), async (req) => {
  const actor = requirePermission(req, "clients.write");
  const { clientId, notes } = parse(clientNotesSchema, req.data);
  const snap = await db().doc(`clients/${clientId}`).get();
  if (!snap.exists) fail("not-found", "Client introuvable.");
  const batch = db().batch();
  batch.set(db().doc(`clientNotes/${clientId}`), { clientId, notes, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid });
  audit(batch, actor, "client.notes", "client", clientId, `Notes privées modifiées (${clientId})`);
  await batch.commit();
  return { ok: true };
});
