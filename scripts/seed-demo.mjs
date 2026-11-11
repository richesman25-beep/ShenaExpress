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
  whatsappNumber: "50934000000",
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
  await auth.updateUser(adminUser.uid, { password: "AdminDemo#2026" });
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

// 3. Compte client de démo : SHE-CLIENT-001 / ClientDemo#2026
const clientId = "SHE-CLIENT-001";
let clientUser;
try {
  clientUser = await auth.getUserByEmail("client1@shena-express.demo");
  await auth.updateUser(clientUser.uid, { password: "ClientDemo#2026" });
} catch {
  clientUser = await auth.createUser({
    email: "client1@shena-express.demo",
    password: "ClientDemo#2026",
    displayName: "Jean-Pierre Louis (Démo)",
    emailVerified: true,
  });
}
await auth.setCustomUserClaims(clientUser.uid, { role: "client", clientId });

await db.doc("counters/clients").set({ value: 1, updatedAt: now });
await db.doc("counters/orders-2026").set({ value: 1, updatedAt: now });
await db.doc("counters/shipments-2026").set({ value: 1, updatedAt: now });

await db.doc(`users/${clientUser.uid}`).set({
  uid: clientUser.uid,
  role: "client",
  clientId,
  displayName: "Jean-Pierre Louis (Démo)",
  email: "client1@shena-express.demo",
  disabled: false,
  createdAt: now,
  updatedAt: now,
});

await db.doc(`clients/${clientId}`).set({
  clientId,
  clientUid: clientUser.uid,
  fullName: "Jean-Pierre Louis (Démo)",
  phone: "+509 37 00 11 22",
  phoneKey: "50937001122",
  whatsapp: "+509 37 00 11 22",
  email: "client1@shena-express.demo",
  hasRealEmail: true,
  address: "Delmas 60, Rue des Miracles #12",
  city: "Port-au-Prince",
  status: "active",
  searchTokens: ["she-client-001", "jean", "pierre", "louis", "50937001122", "port", "prince"],
  createdAt: now,
  updatedAt: now,
});

await db.doc(`clientNotes/${clientId}`).set({
  clientId,
  notes: "[EXEMPLE DÉMO] Client régulier — préfère être appelé avant livraison.",
  updatedAt: now,
  updatedBy: adminUser.uid,
});

// 4. Commande et colis d'exemple
const orderId = "SHE-CMD-2026-00001";
const shipmentId = "SHE-COLIS-2026-00001";
const trackingNumber = "SHX26000001";

await db.doc(`orders/${orderId}`).set({
  orderId,
  clientId,
  clientUid: clientUser.uid,
  clientName: "Jean-Pierre Louis (Démo)",
  merchant: "Amazon",
  merchantOrderRef: "AMZ-114-5520",
  orderDate: "2026-11-05",
  items: [
    {
      lineId: "L1",
      description: "Écouteurs Bluetooth réduction de bruit",
      merchantRef: "B09X-DEMO",
      quantityOrdered: 2,
      quantityReceived: 2,
      declaredUnitValue: 8500,
    },
    {
      lineId: "L2",
      description: "Sac à dos ordinateur 15 pouces",
      merchantRef: "BAG-15P",
      quantityOrdered: 1,
      quantityReceived: 1,
      declaredUnitValue: 4500,
    },
  ],
  currency: "USD",
  status: "in_transit",
  transportMode: "air",
  stats: {
    ordered: 3,
    received: 3,
    packed: 3,
    shipped: 3,
    delivered: 0,
    shipmentCount: 1,
  },
  shipmentIds: [shipmentId],
  searchTokens: ["she-cmd-2026-00001", "she-client-001", "amazon", "shx26000001"],
  publicNote: "Articles vérifiés à l'entrepôt de Miami et regroupés dans le colis SHX26000001.",
  createdAt: now,
  updatedAt: now,
});

await db.doc(`orderPrivate/${orderId}`).set({
  orderId,
  internalNotes: "[EXEMPLE DÉMO] Emballage renforcé effectué au comptoir.",
  updatedAt: now,
  updatedBy: adminUser.uid,
});

await db.doc(`shipments/${shipmentId}`).set({
  shipmentId,
  trackingNumber,
  clientId,
  clientUid: clientUser.uid,
  orderIds: [orderId],
  lines: [
    { orderId, lineId: "L1", description: "Écouteurs Bluetooth réduction de bruit", quantity: 2 },
    { orderId, lineId: "L2", description: "Sac à dos ordinateur 15 pouces", quantity: 1 },
  ],
  itemCount: 3,
  weightKg: 2.4,
  dimensionsCm: { length: 38, width: 28, height: 18 },
  transportMode: "air",
  status: "in_transit",
  lastStep: 2,
  dates: {
    warehouseReceivedAt: "2026-11-07",
    estimatedDeparture: "2026-11-09",
    shippedAt: "2026-11-09",
    estimatedArrival: "2026-11-14",
    deliveryWindowStart: "2026-11-14",
    deliveryWindowEnd: "2026-11-16",
    availableAt: null,
    deliveredAt: null,
  },
  dateChangeMessage: null,
  pickupInstructions: "Présentez votre identifiant SHE-CLIENT-001 et une pièce d'identité.",
  searchTokens: [trackingNumber.toLowerCase(), shipmentId.toLowerCase()],
  createdAt: now,
  updatedAt: now,
});

await db.doc(`trackingNumbers/${trackingNumber}`).set({ shipmentId, createdAt: now });
await db.doc(`shipmentPrivate/${shipmentId}`).set({
  shipmentId,
  internalNotes: "[EXEMPLE DÉMO] Conteneur aérien lot #12.",
  updatedAt: now,
  updatedBy: adminUser.uid,
});

await db.doc("shipmentEvents/demo-ev-1").set({
  kind: "created",
  targetType: "shipment",
  orderId,
  shipmentId,
  clientUid: clientUser.uid,
  fromStatus: null,
  toStatus: "received",
  publicNote: "Colis réceptionné et enregistré à l'entrepôt de Miami (2,4 kg).",
  dateChanges: null,
  actorUid: adminUser.uid,
  actorRole: "admin",
  at: now,
});

await db.doc("shipmentEvents/demo-ev-2").set({
  kind: "status",
  targetType: "shipment",
  orderId,
  shipmentId,
  clientUid: clientUser.uid,
  fromStatus: "received",
  toStatus: "in_transit",
  publicNote: "Départ du vol cargo vers Port-au-Prince.",
  dateChanges: null,
  actorUid: adminUser.uid,
  actorRole: "admin",
  at: now,
});

await db.doc(`orderFinance/${orderId}`).set({
  orderId,
  clientUid: clientUser.uid,
  clientId,
  currency: "USD",
  charges: [
    { id: "C1", kind: "transport", label: "Fret aérien Miami -> Port-au-Prince (2,4 kg)", amount: 2800 },
    { id: "C2", kind: "extra", label: "Frais de dédouanement & manutention", amount: 700 },
  ],
  totalDue: 3500,
  totalPaid: 2000,
  balance: 1500,
  paymentStatus: "partial",
  updatedAt: now,
});

await db.doc("paymentRecords/demo-pay-1").set({
  orderId,
  clientUid: clientUser.uid,
  clientId,
  amount: 2000,
  currency: "USD",
  method: "moncash",
  reference: "MC-DEMO-001",
  receivedOn: "2026-11-08",
  voided: false,
  voidReason: null,
  recordedBy: adminUser.uid,
  createdAt: now,
});

await db.doc("notifications/demo-notif-1").set({
  recipientUid: clientUser.uid,
  type: "shipment_shipped",
  title: `Colis ${trackingNumber} — En transit`,
  body: `Votre colis ${trackingNumber} a quitté l'entrepôt de Miami vers Port-au-Prince.`,
  orderId,
  shipmentId,
  createdAt: now,
  readAt: null,
  channels: ["in_app"],
});

console.log("Environnement de démonstration initialisé :");
console.log("  - Admin  : admin@shena-express.demo / AdminDemo#2026");
console.log("  - Client : SHE-CLIENT-001 / ClientDemo#2026");
