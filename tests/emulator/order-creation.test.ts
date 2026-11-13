import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, where, type Firestore } from "firebase/firestore";
import { initializeApp, deleteApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithCustomToken } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { initializeApp as initializeAdminApp, getApps } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { formatOrderId, formatShipmentId } from "../../shared/index";

const state = vi.hoisted(() => ({ db: null as Firestore | null }));
vi.mock("@/lib/firebase", () => ({
  getFirebaseDb: () => state.db!,
  getFirebaseAuth: () => ({ currentUser: { uid: "order-regression-admin", email: "orders@example.test" } }),
  firebaseState: { mode: "emulator", projectId: "demo-shena" },
}));
import { directBackend } from "../../src/lib/directBackend";

const PROJECT_ID = "demo-shena";
const CLIENT_ID = "SHE-CLIENT-70001";
const CLIENT_UID = "order-regression-client";
const year = new Date().getUTCFullYear();
let env: RulesTestEnvironment;
const app = initializeApp({ apiKey: "demo-api-key", projectId: PROJECT_ID }, "order-regression");
const auth = getAuth(app);
const functions = getFunctions(app, "us-east1");
const callableCreate = httpsCallable<unknown, { orderId: string }>(functions, "createOrder");

beforeAll(async () => {
  // Refuse tout accès à une base de production, même en cas de mauvaise commande.
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Lancez ce test avec Firebase emulators:exec --project demo-shena.");
  }
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync(resolve(import.meta.dirname, "../../firestore.rules"), "utf8") },
  });
  // rules-unit-testing retourne le wrapper compat, accepté par le SDK modulaire.
  state.db = env.authenticatedContext("order-regression-admin", { role: "admin" }).firestore() as unknown as Firestore;
  if (!getApps().length) initializeAdminApp({ projectId: PROJECT_ID });
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  const adminAuth = getAdminAuth();
  await adminAuth.getUser("order-regression-admin").catch(() => adminAuth.createUser({ uid: "order-regression-admin" }));
  await adminAuth.setCustomUserClaims("order-regression-admin", { role: "admin" });
  await signInWithCustomToken(auth, await adminAuth.createCustomToken("order-regression-admin"));
});

beforeEach(async () => {
  // Base jetable demo-shena uniquement ; aucune donnée distante n'est utilisée.
  await env.clearFirestore();
  await setDoc(doc(state.db!, "clients", CLIENT_ID), {
    clientId: CLIENT_ID, clientUid: CLIENT_UID, fullName: "Client test commandes", status: "active",
  });
  await setDoc(doc(state.db!, "settings/public"), { modules: { finance: true } });
  await setDoc(doc(state.db!, "settings/private"), { notifications: { inApp: true, email: false, events: {} } });
});
afterAll(async () => { await env?.cleanup(); await deleteApp(app); });

function payload(trackingNumber: string | null = "TEST-SHENA-001") {
  return {
    clientId: CLIENT_ID, trackingNumber, orderDate: "2026-11-13", currency: "USD",
    description: "Colis de régression", internalNotes: "Note réservée au personnel",
    items: [{ description: "Chaussures", quantityOrdered: 2 }],
  };
}
async function counts() {
  const names = ["orders", "shipments", "orderPrivate", "orderFinance", "shipmentPrivate", "shipmentEvents", "auditLogs", "counters"];
  return Promise.all(names.map(async name => (await getDocs(collection(state.db!, name))).size));
}

for (const mode of ["direct", "callable"] as const) {
  const create = (data: unknown) => mode === "direct" ? directBackend.createOrder(data) : callableCreate(data).then(r => r.data);
  describe(`Création de commandes (${mode})`, () => {
    it("enregistre atomiquement commande, colis, finances et historique, visibles uniquement par le bon client", async () => {
      const { orderId } = await create(payload());
      const order = (await getDoc(doc(state.db!, "orders", orderId))).data()!;
      const shipmentId = order.shipmentIds[0];
      const shipment = (await getDoc(doc(state.db!, "shipments", shipmentId))).data()!;
      expect(order).toMatchObject({ clientId: CLIENT_ID, clientUid: CLIENT_UID, status: "registered", stats: { ordered: 2, received: 0 } });
      expect(shipment).toMatchObject({ trackingNumber: "TEST-SHENA-001", clientId: CLIENT_ID, clientUid: CLIENT_UID, orderIds: [orderId] });
      expect(shipment.lines[0]).toMatchObject({ orderId, quantity: 2 });
      expect(order.searchTokens).toContain("test-shena-001");
      expect((await getDoc(doc(state.db!, "orderFinance", orderId))).data()).toMatchObject({ clientId: CLIENT_ID, clientUid: CLIENT_UID, totalDue: 0 });
      expect((await getDocs(query(collection(state.db!, "shipmentEvents"), where("orderId", "==", orderId)))).size).toBe(2);
      const clientDb = env.authenticatedContext(CLIENT_UID, { role: "client", clientId: CLIENT_ID }).firestore();
      // Mêmes abonnements/critères que ClientLayout et les listes administrateur.
      const visibleOrders = await getDocs(query(collection(clientDb, "orders"), where("clientUid", "==", CLIENT_UID)));
      expect(visibleOrders.docs.map(d => d.id)).toEqual([orderId]);
      const visibleShipments = await new Promise<string[]>((resolve, reject) => {
        const unsubscribe = onSnapshot(query(collection(clientDb, "shipments"), where("clientUid", "==", CLIENT_UID)), snapshot => {
          unsubscribe(); resolve(snapshot.docs.map(d => d.id));
        }, reject);
      });
      expect(visibleShipments).toEqual([shipmentId]);
      expect((await getDocs(collection(state.db!, "orders"))).docs.map(d => d.id)).toContain(orderId);
      await assertFails(getDoc(doc(env.authenticatedContext("autre-client", { role: "client" }).firestore(), "orders", orderId)));
      await assertFails(getDoc(doc(clientDb, "orderPrivate", orderId)));
      await assertFails(setDoc(doc(clientDb, "orders", orderId), { status: "delivered" }, { merge: true }));
    });

    it("suit les six étapes et affiche le poids et le prix dès Miami", async () => {
      const { orderId } = await create(payload());
      const order = (await getDoc(doc(state.db!, "orders", orderId))).data()!;
      const shipmentId = order.shipmentIds[0];
      expect((await getDoc(doc(state.db!, "shipments", shipmentId))).data()?.actualWeightLb).toBeNull();
      const weighing = { shipmentId, weightLb: 4.75, confirmMiamiReceipt: true };
      if (mode === "direct") await directBackend.recordShipmentWeighing(weighing);
      else await httpsCallable(functions, "recordShipmentWeighing")(weighing);
      expect((await getDoc(doc(state.db!, "shipments", shipmentId))).data()).toMatchObject({ status: "received", actualWeightLb: 4.75, shippingFeeCents: 2850 });
      expect((await getDoc(doc(state.db!, "orders", orderId))).data()).toMatchObject({ status: "received", stats: { received: 2 } });
      for (const [status, field] of [["in_transit", "inTransitAt"], ["arrived_dr", "arrivedDominicanAt"], ["bus_to_haiti", "busToHaitiAt"], ["available", "readyForDeliveryAt"]] as const) {
        const change = { targetType: "shipment", targetId: shipmentId, status };
        if (mode === "direct") await directBackend.updateStatus(change);
        else await httpsCallable(functions, "updateStatus")(change);
        const shipment = (await getDoc(doc(state.db!, "shipments", shipmentId))).data()!;
        expect(shipment.status).toBe(status);
        expect(shipment[field]).toBeTruthy();
        expect(shipment.shippingFeeCents).toBe(2850);
        expect((await getDoc(doc(state.db!, "orders", orderId))).data()?.status).toBe(status);
      }
      const clientDb = env.authenticatedContext(CLIENT_UID, { role: "client", clientId: CLIENT_ID }).firestore();
      expect((await getDoc(doc(clientDb, "shipments", shipmentId))).data()).toMatchObject({ status: "available", actualWeightLb: 4.75, shippingFeeCents: 2850 });
    });

    it("refuse un suivi existant sans modifier la commande ou avancer les compteurs", async () => {
      const { orderId } = await create(payload());
      const before = await counts();
      const orderBefore = (await getDoc(doc(state.db!, "orders", orderId))).data();
      const counterBefore = (await getDoc(doc(state.db!, "counters", `orders_${year}`))).data();
      await expect(create(payload("test-shena-001"))).rejects.toThrow(/déjà utilisé/);
      expect(await counts()).toEqual(before);
      expect((await getDoc(doc(state.db!, "orders", orderId))).data()).toEqual(orderBefore);
      expect((await getDoc(doc(state.db!, "counters", `orders_${year}`))).data()).toEqual(counterBefore);
    });

    it("ne remplace jamais une commande existante si son compteur est absent", async () => {
      const id = formatOrderId(year, 1);
      await setDoc(doc(state.db!, "orders", id), { orderId: id, clientUid: "historique", marker: "à conserver" });
      const before = await counts();
      await expect(create(payload())).rejects.toThrow(/identifiant est déjà utilisé/);
      expect((await getDoc(doc(state.db!, "orders", id))).data()?.marker).toBe("à conserver");
      expect(await counts()).toEqual(before);
    });

    it("ne remplace pas un colis existant et ne laisse aucune commande partielle", async () => {
      const id = formatShipmentId(year, 1);
      await setDoc(doc(state.db!, "shipments", id), { shipmentId: id, trackingNumber: "OLD-TRACKING", marker: "historique" });
      const before = await counts();
      await expect(create(payload())).rejects.toThrow(/identifiant est déjà utilisé/);
      expect((await getDoc(doc(state.db!, "shipments", id))).data()?.marker).toBe("historique");
      expect(await counts()).toEqual(before);
    });

    it("conserve la création sans colis et utilise le plus grand compteur historique", async () => {
      await setDoc(doc(state.db!, "counters", `orders-${year}`), { value: 30 });
      const { orderId } = await create(payload(null));
      expect(orderId).toBe(formatOrderId(year, 31));
      expect((await getDoc(doc(state.db!, "orders", orderId))).data()).toMatchObject({ status: "registered", shipmentIds: [] });
      expect((await getDocs(collection(state.db!, "shipments"))).empty).toBe(true);
    });

    it("refuse un client désactivé sans aucune écriture métier", async () => {
      await setDoc(doc(state.db!, "clients", CLIENT_ID), { status: "disabled" }, { merge: true });
      const before = await counts();
      await expect(create(payload())).rejects.toThrow(/désactivé/);
      expect(await counts()).toEqual(before);
    });
  });
}

it("deux créations simultanées, directe et callable, ne peuvent pas partager le même suivi", async () => {
  const results = await Promise.allSettled([directBackend.createOrder(payload()), callableCreate(payload())]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
  expect((await getDocs(collection(state.db!, "orders"))).size).toBe(1);
  expect((await getDocs(collection(state.db!, "shipments"))).size).toBe(1);
});

it("deux commandes simultanées distinctes ont des identifiants différents et gardent leur client", async () => {
  const secondClientId = "SHE-CLIENT-70002";
  await setDoc(doc(state.db!, "clients", secondClientId), { clientId: secondClientId, clientUid: "second-client", fullName: "Second client", status: "active" });
  const results = await Promise.all([
    directBackend.createOrder(payload("TRACK-A")),
    directBackend.createOrder({ ...payload("TRACK-B"), clientId: secondClientId }),
  ]);
  expect(new Set(results.map(r => r.orderId)).size).toBe(2);
  for (const [index, { orderId }] of results.entries()) {
    const expectedUid = index === 0 ? CLIENT_UID : "second-client";
    const order = (await getDoc(doc(state.db!, "orders", orderId))).data()!;
    expect(order.clientUid).toBe(expectedUid);
    expect((await getDoc(doc(state.db!, "shipments", order.shipmentIds[0]))).data()?.clientUid).toBe(expectedUid);
  }
});

it("un suivi ancien sans index est détecté ; création et renommage de colis respectent aussi l'unicité", async () => {
  await setDoc(doc(state.db!, "shipments", "ancien-colis"), { trackingNumber: "LEGACY-001" });
  await expect(directBackend.createOrder(payload("LEGACY-001"))).rejects.toThrow(/déjà utilisé/);
  const first = await directBackend.createOrder(payload("TRACK-FIRST"));
  const second = await directBackend.createOrder(payload("TRACK-SECOND"));
  await expect(directBackend.updateOrder({ ...payload("TRACK-FIRST"), orderId: second.orderId })).rejects.toThrow(/déjà utilisé/);
  const order = (await getDoc(doc(state.db!, "orders", first.orderId))).data()!;
  await expect(directBackend.updateShipment({ shipmentId: order.shipmentIds[0], trackingNumber: "TRACK-SECOND", transportMode: "air", dates: {} })).rejects.toThrow(/déjà utilisé/);
});

for (const mode of ["direct", "callable"] as const) {
  it(`la création de colis ${mode} avec suivi généré termine toutes les lectures avant les écritures`, async () => {
    const data = { clientId: CLIENT_ID, transportMode: "air", lines: [], dates: {} };
    const result = mode === "direct"
      ? await directBackend.createShipment(data)
      : (await httpsCallable<unknown, { shipmentId: string }>(functions, "createShipment")(data)).data;
    const shipment = (await getDoc(doc(state.db!, "shipments", result.shipmentId))).data()!;
    expect(shipment.trackingNumber).toMatch(/^SHX\d+$/);
    expect(shipment.clientUid).toBe(CLIENT_UID);
    const before = await counts();
    await expect(directBackend.createOrder(payload(shipment.trackingNumber))).rejects.toThrow(/déjà utilisé/);
    expect(await counts()).toEqual(before);
  });
}

it("une commande et un colis créés simultanément ne peuvent pas partager le même suivi", async () => {
  const createShipment = httpsCallable(functions, "createShipment");
  const results = await Promise.allSettled([
    directBackend.createOrder(payload("CROSS-PATH-TRACKING")),
    createShipment({ clientId: CLIENT_ID, trackingNumber: "CROSS-PATH-TRACKING", dates: {}, lines: [] }),
  ]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
  expect((await getDocs(query(collection(state.db!, "shipments"), where("trackingNumber", "==", "CROSS-PATH-TRACKING")))).size).toBe(1);
});

it("préserve aussi les documents financiers préexistants quand un compteur est absent", async () => {
  const id = formatOrderId(year, 1);
  await setDoc(doc(state.db!, "orderFinance", id), { totalPaid: 12345, clientUid: "ancien-client" });
  const before = await counts();
  await expect(directBackend.createOrder(payload())).rejects.toThrow(/identifiant est déjà utilisé/);
  expect((await getDoc(doc(state.db!, "orderFinance", id))).data()?.totalPaid).toBe(12345);
  expect(await counts()).toEqual(before);
});
