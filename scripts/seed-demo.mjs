#!/usr/bin/env node
/**
 * SHENA Express — Initialisation de l'environnement de démonstration (ÉMULATEURS UNIQUEMENT).
 * Refuse de s'exécuter si FIRESTORE_EMULATOR_HOST n'est pas défini.
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
process.env.GCLOUD_PROJECT ||= "demo-shena";

if (!process.env.FIRESTORE_EMULATOR_HOST.includes("127.0.0.1") && !process.env.FIRESTORE_EMULATOR_HOST.includes("localhost")) {
  console.error("Refus d'exécution : seed-demo.mjs est strictement réservé à l'émulateur local.");
  process.exit(1);
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const auth = getAuth();
const db = getFirestore();
const now = FieldValue.serverTimestamp();

// 1. Paramètres d'entreprise clairement identifiés comme exemples de démonstration
await db.doc("settings/public").set({
  companyName: "SHENA Express",
  logoUrl: null,
  whatsappNumber: "50900000000",
  contactEmail: "exemple-contact@shena-express.invalid",
  address: "[EXEMPLE DÉMO] Entrepôt Miami & Point de retrait Port-au-Prince",
  serviceArea: "[EXEMPLE DÉMO] États-Unis → Haïti (Port-au-Prince, Cap-Haïtien)",
  currency: "USD",
  openingHours: "[EXEMPLE DÉMO] Lun–Sam 8h30–17h00",
  serviceMessage: "Environnement de démonstration local : ces coordonnées et commandes sont des exemples.",
  pickupInstructions: "[EXEMPLE DÉMO] Présentez votre identifiant client et une pièce d'identité au comptoir.",
  modules: { finance: true },
  statusLabels: {},
  disabledStatuses: [],
  isExample: true,
  updatedAt: now,
});

await db.doc("settings/private").set({
  notifications: { inApp: true, email: false, events: {} },
  updatedAt: now,
});

// 2. Compte administrateur de démo
let adminUser;
try {
  adminUser = await auth.getUserByEmail("admin@shena-express.demo");
} catch {
  adminUser = await auth.createUser({
    email: "admin@shena-express.demo",
    password: "AdminDemo#2026",
    displayName: "Admin Démo SHENA",
    emailVerified: true,
  });
}
await auth.setCustomUserClaims(adminUser.uid, { role: "admin" });
await db.doc(`users/${adminUser.uid}`).set({
  uid: adminUser.uid,
  role: "admin",
  displayName: "Admin Démo SHENA",
  email: "admin@shena-express.demo",
  disabled: false,
  createdAt: now,
  updatedAt: now,
});

console.log("Environnement de démonstration initialisé (admin@shena-express.demo / AdminDemo#2026).");
