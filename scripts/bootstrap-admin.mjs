#!/usr/bin/env node
/**
 * SHENA Express — Procédure sécurisée de création du premier administrateur.
 *
 * Exécution (avec identifiants de compte de service côté serveur uniquement) :
 *   GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/service-account.json \
 *   ADMIN_EMAIL=admin@domaine.com \
 *   ADMIN_NAME="Direction SHENA Express" \
 *   node scripts/bootstrap-admin.mjs
 *
 * En mode émulateur local :
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *   GCLOUD_PROJECT=demo-shena ADMIN_EMAIL=admin@shena-express.example ADMIN_PASSWORD=AdminDemo#2026 \
 *   node scripts/bootstrap-admin.mjs
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const displayName = (process.env.ADMIN_NAME || "Administrateur SHENA Express").trim();
const password = process.env.ADMIN_PASSWORD;

if (!email || !email.includes("@")) {
  console.error("Erreur : définissez ADMIN_EMAIL=adresse@domaine.com");
  process.exit(1);
}

initializeApp({
  projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "demo-shena",
});

const auth = getAuth();
const db = getFirestore();

let user;
try {
  user = await auth.getUserByEmail(email);
  console.log(`Compte existant trouvé (${user.uid}). Attribution du rôle admin…`);
} catch (err) {
  if (err?.code === "auth/user-not-found") {
    user = await auth.createUser({
      email,
      displayName,
      emailVerified: true,
      disabled: false,
      ...(password ? { password } : {}),
    });
    console.log(`Compte créé (${user.uid}).`);
  } else {
    throw err;
  }
}

await auth.setCustomUserClaims(user.uid, { role: "admin" });
const now = FieldValue.serverTimestamp();
await db.doc(`users/${user.uid}`).set(
  {
    uid: user.uid,
    role: "admin",
    permissions: [],
    displayName,
    email,
    disabled: false,
    createdAt: now,
    updatedAt: now,
  },
  { merge: true },
);

await db.collection("auditLogs").add({
  action: "admin.bootstrap",
  actorUid: user.uid,
  actorRole: "admin",
  targetType: "user",
  targetId: user.uid,
  summary: `Amorçage du compte administrateur ${email}`,
  details: null,
  at: now,
});

console.log(`Rôle administrateur attribué avec succès à ${email} (uid: ${user.uid}).`);
if (!password) {
  const resetLink = await auth.generatePasswordResetLink(email);
  console.log("Lien de définition du mot de passe (à ouvrir une seule fois) :");
  console.log(resetLink);
}
