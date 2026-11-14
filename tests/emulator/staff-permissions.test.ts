import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from "firebase/firestore";

let env: RulesTestEnvironment;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw Error("Émulateur local requis.");
  env = await initializeTestEnvironment({
    projectId: "demo-shena",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    for (const path of [
      "orders/perm-order",
      "orderPrivate/perm-order",
      "shipments/perm-shipment",
      "shipmentPrivate/perm-shipment",
      "clients/perm-client",
      "orderFinance/perm-order",
      "paymentRecords/perm-payment",
      "accountingInvoices/perm-invoice",
      "auditLogs/perm-log",
    ]) {
      await setDoc(doc(db, path), { clientUid: "perm-client-owner", value: 1 });
    }
    await setDoc(doc(db, "orderFinance/perm-managed"), {
      accountingManaged: true,
      totalPaid: 0,
    });
    await setDoc(doc(db, "settings/public"), {
      companyName: "Test local",
      shippingRatePerLbCents: 600,
    });
    await setDoc(doc(db, "settings/private"), { notifications: {} });
    await setDoc(doc(db, "users/perm-disabled"), {
      role: "staff",
      permissions: ["orders.read"],
      disabled: true,
    });
    await setDoc(doc(db, "users/perm-revoked"), {
      role: "staff",
      permissions: [],
      disabled: false,
    });
    await setDoc(doc(db, "users/perm-profile-only"), {
      role: "staff",
      permissions: ["orders.read"],
      disabled: false,
    });
    await setDoc(doc(db, "users/perm-current"), {
      role: "staff",
      permissions: ["orders.read"],
      disabled: false,
    });
  });
});
afterAll(async () => {
  await env?.clearFirestore();
  await env?.cleanup();
});

function staff(uid: string, perms: string[]) {
  return env.authenticatedContext(uid, { role: "staff", perms }).firestore();
}

describe("Permissions Firestore du rôle staff", () => {
  it("lecture des commandes sans ouverture des finances, clients, colis ou audit", async () => {
    const db = staff("perm-reader", ["orders.read"]);
    await assertSucceeds(getDoc(doc(db, "orders/perm-order")));
    await assertSucceeds(getDoc(doc(db, "orderPrivate/perm-order")));
    for (const path of [
      "clients/perm-client",
      "shipments/perm-shipment",
      "orderFinance/perm-order",
      "paymentRecords/perm-payment",
      "accountingInvoices/perm-invoice",
      "auditLogs/perm-log",
      "settings/private",
    ])
      await assertFails(getDoc(doc(db, path)));
    await assertFails(updateDoc(doc(db, "orders/perm-order"), { value: 2 }));
    await assertFails(setDoc(doc(db, "users/perm-reader"), { role: "admin" }));
  });
  it("finance.read autorise les finances mais aucune écriture ni gestion des rôles", async () => {
    const db = staff("perm-finance", ["finance.read"]);
    for (const path of [
      "orderFinance/perm-order",
      "paymentRecords/perm-payment",
      "accountingInvoices/perm-invoice",
    ])
      await assertSucceeds(getDoc(doc(db, path)));
    await assertFails(getDoc(doc(db, "orders/perm-order")));
    await assertFails(getDoc(doc(db, "auditLogs/perm-log")));
    await assertFails(
      updateDoc(doc(db, "orderFinance/perm-order"), { value: 2 }),
    );
    await assertFails(
      setDoc(doc(db, "accountingInvoices/perm-invoice"), { revenue: 1 }),
    );
  });
  it("shipments.read et audit.read restent indépendants", async () => {
    const shipping = staff("perm-shipping", ["shipments.read"]);
    await assertSucceeds(getDoc(doc(shipping, "shipments/perm-shipment")));
    await assertSucceeds(
      getDoc(doc(shipping, "shipmentPrivate/perm-shipment")),
    );
    await assertFails(getDoc(doc(shipping, "orderPrivate/perm-order")));
    await assertFails(getDoc(doc(shipping, "auditLogs/perm-log")));
    const audit = staff("perm-auditor", ["audit.read"]);
    await assertSucceeds(getDoc(doc(audit, "auditLogs/perm-log")));
    await assertFails(
      updateDoc(doc(audit, "auditLogs/perm-log"), { value: 2 }),
    );
    await assertFails(getDoc(doc(audit, "orders/perm-order")));
  });
  it("les écritures exigent leur permission et conservent les protections comptables", async () => {
    const writer = staff("perm-writer", ["orders.write"]);
    await assertSucceeds(
      updateDoc(doc(writer, "orders/perm-order"), { value: 3 }),
    );
    await assertFails(
      updateDoc(doc(writer, "shipments/perm-shipment"), { value: 3 }),
    );
    await assertFails(
      updateDoc(doc(writer, "orderFinance/perm-order"), { value: 3 }),
    );
    const finance = staff("perm-finance-writer", ["finance.write"]);
    await assertSucceeds(
      updateDoc(doc(finance, "orderFinance/perm-order"), { value: 3 }),
    );
    await assertFails(
      updateDoc(doc(finance, "orderFinance/perm-managed"), { totalPaid: 10 }),
    );
  });
  it("un compte désactivé ou une permission retirée reste bloqué malgré les claims", async () => {
    for (const uid of ["perm-disabled", "perm-revoked"])
      await assertFails(
        getDoc(doc(staff(uid, ["orders.read"]), "orders/perm-order")),
      );
    await assertFails(
      getDoc(doc(staff("perm-profile-only", []), "orders/perm-order")),
    );
    await assertSucceeds(
      getDoc(doc(staff("perm-current", ["orders.read"]), "orders/perm-order")),
    );
  });
  it("settings.write ne permet pas de changer les tarifs réservés à l’administrateur", async () => {
    const db = staff("perm-settings", ["settings.write"]);
    await assertSucceeds(getDoc(doc(db, "settings/private")));
    const batch = writeBatch(db);
    batch.set(
      doc(db, "settings/public"),
      { companyName: "Test corrigé" },
      { merge: true },
    );
    batch.set(
      doc(db, "settings/private"),
      { notifications: { inApp: true } },
      { merge: true },
    );
    await assertSucceeds(batch.commit());
    const publicDb = env.unauthenticatedContext().firestore();
    expect(
      (await getDoc(doc(publicDb, "settings/public"))).data()
        ?.shippingRatePerLbCents,
    ).toBe(600);
    await assertFails(
      updateDoc(doc(db, "settings/public"), { shippingRatePerLbCents: 1 }),
    );
    await assertFails(deleteDoc(doc(db, "settings/public")));
    await assertFails(
      setDoc(doc(db, "accountingSettings/rates"), { carrierRateCents: 1 }),
    );
  });
  it("les claims absents ne provoquent aucun accès privilégié", async () => {
    const db = env.authenticatedContext("perm-empty").firestore();
    await assertSucceeds(getDoc(doc(db, "settings/public")));
    await assertFails(getDoc(doc(db, "orders/perm-order")));
    await assertFails(getDoc(doc(db, "accountingInvoices/perm-invoice")));
  });
  it.each(["admin", "operator", "finance_manager"])(
    "conserve les accès historiques du rôle %s sans claim email",
    async (role) => {
      const db = env
        .authenticatedContext("perm-legacy-" + role, { role })
        .firestore();
      await assertSucceeds(getDoc(doc(db, "orders/perm-order")));
      await assertSucceeds(getDoc(doc(db, "auditLogs/perm-log")));
    },
  );
});
