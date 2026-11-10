import { onCall } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { settingsUpdateSchema, setStaffRoleSchema } from "../../shared/index.js";
import { db, parse, audit, FieldValue, fail, requirePermission, requireAdmin } from "./lib/core.js";
import { sendPasswordResetEmail } from "./lib/identity.js";
import { callableOptions } from "./lib/options.js";

/** Mise à jour des paramètres de l'entreprise (nom, WhatsApp, devise, statuts, notifications). */
export const updateSettings = onCall(callableOptions(), async (req) => {
  const actor = requirePermission(req, "settings.write");
  const { publicSettings, privateSettings } = parse(settingsUpdateSchema, req.data);

  const batch = db().batch();
  const now = FieldValue.serverTimestamp();
  batch.set(db().doc("settings/public"), { ...publicSettings, isExample: false, updatedAt: now }, { merge: true });
  batch.set(db().doc("settings/private"), { ...privateSettings, updatedAt: now }, { merge: true });
  audit(batch, actor, "settings.update", "settings", "global", "Paramètres de l'entreprise mis à jour", {
    currency: publicSettings.currency,
    financeModule: publicSettings.modules.finance,
  });
  await batch.commit();
  return { ok: true };
});

/**
 * Attribution ou révocation d'un rôle privilégié (administrateur ou employé avec permissions limitées).
 * Strictement réservé aux administrateurs. Aucun utilisateur ne peut s'accorder de rôle à l'inscription
 * et un administrateur ne peut pas retirer son propre rôle (évite le verrouillage accidentel).
 */
export const setStaffRole = onCall(callableOptions(), async (req) => {
  const actor = requireAdmin(req);
  const input = parse(setStaffRoleSchema, req.data);

  let user;
  let created = false;
  try {
    user = await getAuth().getUserByEmail(input.email);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "auth/user-not-found" && input.role !== "none") {
      user = await getAuth().createUser({
        email: input.email,
        displayName: input.displayName ?? input.email.split("@")[0],
        emailVerified: false,
        disabled: false,
      });
      created = true;
    } else {
      fail("not-found", "Aucun compte trouvé avec cette adresse e-mail.");
    }
  }

  if (user.uid === actor.uid && input.role !== "admin") {
    fail("failed-precondition", "Vous ne pouvez pas retirer votre propre rôle administrateur.");
  }

  const clientSnap = await db().collection("clients").where("clientUid", "==", user.uid).limit(1).get();
  if (!clientSnap.empty) {
    fail("failed-precondition", "Ce compte est un compte client. Utilisez une adresse e-mail dédiée pour le personnel.");
  }

  const batch = db().batch();
  const now = FieldValue.serverTimestamp();
  if (input.role === "none") {
    await getAuth().setCustomUserClaims(user.uid, {});
    await getAuth().revokeRefreshTokens(user.uid);
    batch.delete(db().doc(`users/${user.uid}`));
    audit(batch, actor, "staff.revoke", "user", user.uid, `Accès retiré pour ${input.email}`);
  } else {
    const claims = input.role === "admin" ? { role: "admin" } : { role: "staff", perms: input.permissions };
    await getAuth().setCustomUserClaims(user.uid, claims);
    await getAuth().revokeRefreshTokens(user.uid);
    const displayName = input.displayName ?? user.displayName ?? input.email;
    if (input.displayName && input.displayName !== user.displayName) {
      await getAuth().updateUser(user.uid, { displayName: input.displayName });
    }
    batch.set(
      db().doc(`users/${user.uid}`),
      {
        uid: user.uid,
        role: input.role,
        permissions: input.role === "staff" ? input.permissions : [],
        displayName,
        email: input.email,
        disabled: false,
        updatedAt: now,
        ...(created ? { createdAt: now } : {}),
      },
      { merge: true },
    );
    audit(batch, actor, "staff.grant", "user", user.uid, `Rôle ${input.role} attribué à ${input.email}`, {
      role: input.role,
      permissions: input.permissions,
    });
  }
  await batch.commit();

  if (created) await sendPasswordResetEmail(input.email);
  return { uid: user.uid, created };
});
