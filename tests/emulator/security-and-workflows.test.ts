import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { initializeApp as initAdmin, getApps as getAdminApps } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { initializeApp as initClient } from "firebase/app";
import {
  getAuth as getClientAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  signInWithCustomToken,
} from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";

const PROJECT_ID = "demo-shena";
let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
  process.env.GCLOUD_PROJECT = PROJECT_ID;

  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync(resolve(import.meta.dirname, "../../firestore.rules"), "utf8"),
    },
  });

  if (getAdminApps().length === 0) {
    initAdmin({ projectId: PROJECT_ID });
  }
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe("Sécurité Firestore (règles testées sur l'émulateur)", () => {
  it("3, 4, 5 & 13. Protège toutes les collections contre les visiteurs, l'accès croisé entre clients et toute modification client", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "settings/public"), {
        companyName: "SHENA Express",
        currency: "USD",
        modules: { finance: true },
      });
      await setDoc(doc(db, "settings/private"), {
        notifications: { inApp: true, email: false, events: {} },
      });
      await setDoc(doc(db, "users/clientA"), {
        uid: "clientA",
        role: "client",
        clientId: "SHE-CLIENT-001",
        displayName: "Client A",
        disabled: false,
      });
      await setDoc(doc(db, "clients/SHE-CLIENT-001"), {
        clientId: "SHE-CLIENT-001",
        clientUid: "clientA",
        fullName: "Client A",
        phone: "+50934000001",
        status: "active",
      });
      await setDoc(doc(db, "clientNotes/SHE-CLIENT-001"), {
        clientId: "SHE-CLIENT-001",
        notes: "Note secrète admin sur Client A",
      });
      await setDoc(doc(db, "orders/SHE-CMD-2026-00001"), {
        orderId: "SHE-CMD-2026-00001",
        clientId: "SHE-CLIENT-001",
        clientUid: "clientA",
        status: "registered",
      });
      await setDoc(doc(db, "orderPrivate/SHE-CMD-2026-00001"), {
        orderId: "SHE-CMD-2026-00001",
        internalNotes: "Note interne commande A",
      });
      await setDoc(doc(db, "shipments/SHE-COLIS-2026-00001"), {
        shipmentId: "SHE-COLIS-2026-00001",
        trackingNumber: "SHX26000001",
        clientId: "SHE-CLIENT-001",
        clientUid: "clientA",
        status: "in_transit",
      });
      await setDoc(doc(db, "shipmentPrivate/SHE-COLIS-2026-00001"), {
        shipmentId: "SHE-COLIS-2026-00001",
        internalNotes: "Note interne colis A",
      });
      await setDoc(doc(db, "orderFinance/SHE-CMD-2026-00001"), {
        orderId: "SHE-CMD-2026-00001",
        clientId: "SHE-CLIENT-001",
        clientUid: "clientA",
        currency: "USD",
        totalDue: 5000,
        totalPaid: 1000,
        balance: 4000,
        paymentStatus: "partial",
      });
      await setDoc(doc(db, "notifications/notifA"), {
        recipientUid: "clientA",
        title: "Test",
        body: "Corps",
        readAt: null,
      });
      await setDoc(doc(db, "auditLogs/log1"), {
        action: "test",
        summary: "Action admin",
      });
    });

    // 3. Visiteur non authentifié
    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(anonDb, "settings/public")));
    await assertFails(getDoc(doc(anonDb, "settings/private")));
    await assertFails(getDoc(doc(anonDb, "clients/SHE-CLIENT-001")));
    await assertFails(getDoc(doc(anonDb, "orders/SHE-CMD-2026-00001")));
    await assertFails(getDoc(doc(anonDb, "shipments/SHE-COLIS-2026-00001")));
    await assertFails(getDoc(doc(anonDb, "auditLogs/log1")));

    // 4. Client B ne peut JAMAIS lire les données du Client A
    const clientBDb = testEnv
      .authenticatedContext("clientB", { role: "client", clientId: "SHE-CLIENT-002" })
      .firestore();
    await assertFails(getDoc(doc(clientBDb, "clients/SHE-CLIENT-001")));
    await assertFails(getDoc(doc(clientBDb, "orders/SHE-CMD-2026-00001")));
    await assertFails(getDoc(doc(clientBDb, "shipments/SHE-COLIS-2026-00001")));
    await assertFails(getDoc(doc(clientBDb, "orderFinance/SHE-CMD-2026-00001")));
    await assertFails(getDoc(doc(clientBDb, "notifications/notifA")));

    // Client A peut lire ses propres données publiques mais JAMAIS les notes internes ni l'audit
    const clientADb = testEnv
      .authenticatedContext("clientA", { role: "client", clientId: "SHE-CLIENT-001" })
      .firestore();
    await assertSucceeds(getDoc(doc(clientADb, "clients/SHE-CLIENT-001")));
    await assertSucceeds(getDoc(doc(clientADb, "orders/SHE-CMD-2026-00001")));
    await assertSucceeds(getDoc(doc(clientADb, "shipments/SHE-COLIS-2026-00001")));
    await assertSucceeds(getDoc(doc(clientADb, "orderFinance/SHE-CMD-2026-00001")));
    await assertFails(getDoc(doc(clientADb, "clientNotes/SHE-CLIENT-001")));
    await assertFails(getDoc(doc(clientADb, "orderPrivate/SHE-CMD-2026-00001")));
    await assertFails(getDoc(doc(clientADb, "shipmentPrivate/SHE-COLIS-2026-00001")));
    await assertFails(getDoc(doc(clientADb, "auditLogs/log1")));

    // 5. Client A ne peut JAMAIS modifier son rôle, ses statuts, ses montants ou ses dates
    await assertFails(updateDoc(doc(clientADb, "users/clientA"), { role: "admin" }));
    await assertFails(updateDoc(doc(clientADb, "shipments/SHE-COLIS-2026-00001"), { status: "delivered" }));
    await assertFails(updateDoc(doc(clientADb, "orderFinance/SHE-CMD-2026-00001"), { balance: 0, totalPaid: 5000 }));
    // Client A peut uniquement marquer sa propre notification comme lue avec serverTimestamp
    await assertSucceeds(updateDoc(doc(clientADb, "notifications/notifA"), { readAt: serverTimestamp() }));

    // 13. Employé avec permission limitée orders.read uniquement
    const staffDb = testEnv
      .authenticatedContext("staff1", { role: "staff", perms: ["orders.read"] })
      .firestore();
    await assertSucceeds(getDoc(doc(staffDb, "orders/SHE-CMD-2026-00001")));
    await assertSucceeds(getDoc(doc(staffDb, "orderPrivate/SHE-CMD-2026-00001")));
    await assertFails(getDoc(doc(staffDb, "auditLogs/log1")));
  });
});

describe("Parcours de bout en bout via Cloud Functions & Firebase Auth Emulator", () => {
  it("1, 2, 6, 7, 8, 9, 10, 11 & 13. Exécute le cycle complet Admin & Client", async () => {
    const adminAuth = getAdminAuth();
    const adminDb = getAdminFirestore();

    // Création de l'administrateur côté serveur
    const adminUser = await adminAuth.createUser({
      email: "admin-e2e@shena-express.test",
      password: "StrongAdminPassword#2026",
      displayName: "Admin E2E",
      emailVerified: true,
    });
    await adminAuth.setCustomUserClaims(adminUser.uid, { role: "admin" });

    // Initialisation d'un client SDK connecté aux émulateurs
    const clientApp = initClient(
      { apiKey: "demo-api-key", projectId: PROJECT_ID, appId: "1:000:web:000" },
      "emulator-client",
    );
    const auth = getClientAuth(clientApp);
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    const fns = getFunctions(clientApp, "us-east1");
    connectFunctionsEmulator(fns, "127.0.0.1", 5001);

    // 1. Connexion administrateur valide
    await signInWithEmailAndPassword(auth, "admin-e2e@shena-express.test", "StrongAdminPassword#2026");

    // Création d'un client par l'administrateur
    const createClient = httpsCallable<
      { fullName: string; phone: string; email: string; city: string; notes: string; sendInvite: boolean },
      { clientId: string; inviteSent: boolean }
    >(fns, "createClient");
    const createdClient = await createClient({
      fullName: "Marie Jean-Baptiste",
      phone: "+509 37 11 22 33",
      email: "marie@client.test",
      city: "Port-au-Prince",
      notes: "Client VIP",
      sendInvite: true,
    });
    const clientId = createdClient.data.clientId;
    expect(clientId).toMatch(/^SHE-CLIENT-\d{3,}$/);

    // Définition d'un mot de passe sur le compte client pour tester clientSignIn
    const clientSnap = await adminDb.doc(`clients/${clientId}`).get();
    const clientUid = clientSnap.data()!.clientUid as string;
    await adminAuth.updateUser(clientUid, { password: "ClientPassword#2026", emailVerified: true });

    // 6. Création d'une commande avec 2 lignes d'articles
    const createOrder = httpsCallable<unknown, { orderId: string }>(fns, "createOrder");
    const createdOrder = await createOrder({
      clientId,
      merchant: "Amazon",
      merchantOrderRef: "AMZ-9988",
      orderDate: "2026-11-10",
      currency: "USD",
      transportMode: "air",
      publicNote: "Commande enregistrée à Miami",
      internalNotes: "Fragile — vérifier l'emballage",
      items: [
        { description: "Ordinateur portable 14p", quantityOrdered: 2, declaredUnitValue: 65000 },
        { description: "Souris sans fil", quantityOrdered: 3, declaredUnitValue: 2500 },
      ],
    });
    const orderId = createdOrder.data.orderId;
    expect(orderId).toMatch(/^SHE-CMD-2026-\d{5,}$/);

    // Vérifie qu'à la création, reçus = 0 et expédiés = 0
    let orderDoc = (await adminDb.doc(`orders/${orderId}`).get()).data()!;
    expect(orderDoc.stats).toEqual({
      ordered: 5,
      received: 0,
      packed: 0,
      shipped: 0,
      delivered: 0,
      shipmentCount: 0,
    });

    // 8. Réception explicite à l'entrepôt de la totalité des 5 articles
    const recordReceipt = httpsCallable(fns, "recordReceipt");
    await recordReceipt({
      orderId,
      lines: orderDoc.items.map((i: { lineId: string; quantityOrdered: number }) => ({
        lineId: i.lineId,
        quantityReceived: i.quantityOrdered,
      })),
      publicNote: "Tous les articles sont arrivés à Miami.",
    });

    orderDoc = (await adminDb.doc(`orders/${orderId}`).get()).data()!;
    expect(orderDoc.stats.received).toBe(5);
    expect(orderDoc.status).toBe("received");

    // 7. Association de 2 colis distincts à la même commande (répartition sans double comptage)
    const createShipment = httpsCallable<unknown, { shipmentId: string }>(fns, "createShipment");
    const sh1 = await createShipment({
      clientId,
      trackingNumber: "SHX26900001",
      transportMode: "air",
      weightKg: 3.4,
      lines: [
        { orderId, lineId: "L1", quantity: 1 },
        { orderId, lineId: "L2", quantity: 2 },
      ],
      dates: {
        warehouseReceivedAt: "2026-11-10",
        estimatedDeparture: "2026-11-12",
        estimatedArrival: "2026-11-15",
      },
    });
    const sh2 = await createShipment({
      clientId,
      trackingNumber: "SHX26900002",
      transportMode: "air",
      weightKg: 2.1,
      lines: [
        { orderId, lineId: "L1", quantity: 1 },
        { orderId, lineId: "L2", quantity: 1 },
      ],
      dates: {
        warehouseReceivedAt: "2026-11-10",
        estimatedArrival: "2026-11-16",
      },
    });
    expect(sh1.data.shipmentId).not.toBe(sh2.data.shipmentId);

    // Tenter d'emballer 1 article de plus doit échouer (anti-double-comptage)
    await expect(
      createShipment({
        clientId,
        transportMode: "air",
        lines: [{ orderId, lineId: "L1", quantity: 1 }],
        dates: {},
      }),
    ).rejects.toThrow();

    // 9 & 11. Mise à jour du statut + modification de la date estimée
    const updateStatus = httpsCallable(fns, "updateStatus");
    await updateStatus({
      targetType: "shipment",
      targetId: sh1.data.shipmentId,
      status: "in_transit",
      publicNote: "En vol vers Port-au-Prince",
      internalNote: "Vol cargo #402",
    });

    const updateShipment = httpsCallable(fns, "updateShipment");
    await updateShipment({
      shipmentId: sh1.data.shipmentId,
      trackingNumber: "SHX26900001",
      transportMode: "air",
      weightKg: 3.4,
      lines: [
        { orderId, lineId: "L1", quantity: 1 },
        { orderId, lineId: "L2", quantity: 2 },
      ],
      dates: {
        warehouseReceivedAt: "2026-11-10",
        estimatedDeparture: "2026-11-12",
        shippedAt: "2026-11-12",
        estimatedArrival: "2026-11-17",
      },
      dateChangeMessage: "Décalage de 48h du vol cargo",
    });

    orderDoc = (await adminDb.doc(`orders/${orderId}`).get()).data()!;
    expect(orderDoc.stats).toEqual({
      ordered: 5,
      received: 5,
      packed: 5,
      shipped: 3, // sh1 (3 articles) est en transit ; sh2 (2 articles) est en préparation
      delivered: 0,
      shipmentCount: 2,
    });

    // 10. Frais et paiements manuels
    const setOrderCharges = httpsCallable(fns, "setOrderCharges");
    await setOrderCharges({
      orderId,
      charges: [
        { kind: "transport", label: "Transport aérien (5,5 kg)", amount: 6600 },
        { kind: "extra", label: "Assurance", amount: 900 },
        { kind: "discount", label: "Remise", amount: 500 },
      ],
    });
    const recordPayment = httpsCallable<unknown, { paymentId: string }>(fns, "recordPayment");
    await recordPayment({
      orderId,
      amount: 4000,
      currency: "USD",
      method: "moncash",
      reference: "MC-778899",
      receivedOn: "2026-11-10",
    });

    const finDoc = (await adminDb.doc(`orderFinance/${orderId}`).get()).data()!;
    expect(finDoc.totalDue).toBe(7000);
    expect(finDoc.totalPaid).toBe(4000);
    expect(finDoc.balance).toBe(3000);
    expect(finDoc.paymentStatus).toBe("partial");

    // 1 & 2. Connexion client par identifiant (clientSignIn) + mot de passe invalide + récupération
    const clientSignIn = httpsCallable<{ identifier: string; password: string }, { token: string }>(
      fns,
      "clientSignIn",
    );
    await expect(clientSignIn({ identifier: clientId, password: "MauvaisPassword" })).rejects.toThrow(
      /Identifiant ou mot de passe incorrect/,
    );
    const signed = await clientSignIn({ identifier: clientId, password: "ClientPassword#2026" });
    expect(typeof signed.data.token).toBe("string");

    await signInWithCustomToken(auth, signed.data.token);
    expect(auth.currentUser?.uid).toBe(clientUid);

    const requestPasswordReset = httpsCallable<{ identifier: string }, { ok: boolean }>(fns, "requestPasswordReset");
    const resetRes = await requestPasswordReset({ identifier: clientId });
    expect(resetRes.data.ok).toBe(true);

    // 5 & 13. Connecté en tant que client, toute tentative d'appeler une fonction admin est refusée côté serveur
    await expect(
      updateStatus({
        targetType: "shipment",
        targetId: sh1.data.shipmentId,
        status: "delivered",
      }),
    ).rejects.toThrow();
    await expect(
      setOrderCharges({
        orderId,
        charges: [],
      }),
    ).rejects.toThrow();
  });
});
