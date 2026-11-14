import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, collection, getDocs } from "firebase/firestore";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  signInWithCustomToken,
} from "firebase/auth";
import {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable,
} from "firebase/functions";
import { getApps, initializeApp as adminInit } from "firebase-admin/app";
import { getAuth as adminAuth } from "firebase-admin/auth";
let env: RulesTestEnvironment;
const app = initializeApp(
  { projectId: "demo-shena", apiKey: "demo-api-key" },
  "book-tests",
);
const auth = getAuth(app),
  functions = getFunctions(app, "us-east1");
const command = httpsCallable(functions, "accountingCommand");
const invoice = "SHE-COLIS-2026-99001",
  order = "SHE-CMD-2026-99001";
let seq = 0;
const run = (kind: string, extra: Record<string, unknown> = {}) =>
  command({ kind, requestId: "book-" + ++seq, date: "2026-11-14", ...extra });
beforeAll(async () => {
  if (
    !process.env.FIRESTORE_EMULATOR_HOST ||
    !process.env.FIREBASE_AUTH_EMULATOR_HOST
  )
    throw Error("Émulateurs requis");
  env = await initializeTestEnvironment({
    projectId: "demo-shena",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
  if (!getApps().length) adminInit({ projectId: "demo-shena" });
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  await adminAuth()
    .getUser("book-admin")
    .catch(() => adminAuth().createUser({ uid: "book-admin" }));
  await adminAuth().setCustomUserClaims("book-admin", { role: "admin" });
  await signInWithCustomToken(
    auth,
    await adminAuth().createCustomToken("book-admin"),
  );
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "orders", order), {
      clientUid: "book-client",
      clientId: "SHE-CLIENT-99",
      currency: "USD",
    });
    await setDoc(doc(c.firestore(), "shipments", invoice), {
      orderIds: [order],
      clientUid: "book-client",
      clientId: "SHE-CLIENT-99",
      actualWeightLb: 4.75,
      ratePerLbCents: 600,
      weighedAt: "2026-11-14",
      trackingNumber: "BOOK-TRACK",
      status: "received",
    });
  });
});
afterAll(async () => {
  await env?.clearFirestore();
  await env?.cleanup();
  await deleteApp(app);
});
async function data(path: string) {
  let result: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (c) => {
    result = (await getDoc(doc(c.firestore(), path))).data();
  });
  return result;
}
it("facture, acomptes, paiements multiples, remboursements et synchronisation", async () => {
  await run("invoice", { targetId: invoice });
  expect(await data("accountingInvoices/" + invoice)).toMatchObject({
    revenue: 2850,
    cost: 2138,
    paid: 0,
  });
  const p = await run("payment", {
    targetId: invoice,
    amount: 1000,
    reference: "P1",
  });
  await run("payment", { targetId: invoice, amount: 1850, reference: "P2" });
  expect(await data("orderFinance/" + order)).toMatchObject({
    totalPaid: 2850,
    paymentStatus: "paid",
  });
  await run("refund", {
    targetId: (p.data as { entryId: string }).entryId,
    amount: 500,
    description: "Remboursement client",
  });
  expect(await data("orderFinance/" + order)).toMatchObject({
    totalPaid: 2350,
    balance: 500,
    paymentStatus: "partial",
  });
  await expect(
    run("refund", {
      targetId: (p.data as { entryId: string }).entryId,
      amount: 501,
      description: "Trop",
    }),
  ).rejects.toThrow();
});
it("idempotence, référence unique et concurrence sur le solde", async () => {
  await run("invoice", { targetId: invoice });
  const p = {
    kind: "payment",
    requestId: "stable",
    date: "2026-11-14",
    targetId: invoice,
    amount: 1000,
    reference: "UNIQUE",
  };
  await command(p);
  await command(p);
  await expect(
    run("payment", { targetId: invoice, amount: 1000, reference: "UNIQUE" }),
  ).rejects.toThrow();
  const results = await Promise.allSettled([
    run("payment", { targetId: invoice, amount: 1850 }),
    run("payment", { targetId: invoice, amount: 1850 }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await data("accountingInvoices/" + invoice)).toMatchObject({
    paid: 2850,
  });
});
it("taux historiques et annulation traçable", async () => {
  await run("invoice", { targetId: invoice });
  const p = await run("payment", {
    targetId: invoice,
    amount: 130000,
    currency: "HTG",
    rateMicros: 130000000,
    rateDate: "2026-11-13",
  });
  expect(await data("accountingInvoices/" + invoice)).toMatchObject({
    paid: 1000,
  });
  await run("void", {
    targetId: (p.data as { entryId: string }).entryId,
    description: "Erreur de saisie",
  });
  expect(await data("accountingInvoices/" + invoice)).toMatchObject({
    paid: 0,
  });
});
it("tarifs figés, dépenses et dettes distinctes, shipping non dupliqué", async () => {
  await run("invoice", { targetId: invoice });
  await run("rates", { clientRateCents: 800, carrierRateCents: 500 });
  expect(await data("accountingInvoices/" + invoice)).toMatchObject({
    clientRateCents: 600,
    carrierRateCents: 450,
  });
  await expect(
    run("expense", {
      amount: 2138,
      category: "shipping",
      description: "Coût déjà calculé",
    }),
  ).rejects.toThrow();
  await expect(
    run("supplier_payment", { targetId: invoice, amount: 100 }),
  ).rejects.toThrow();
  await run("confirm_cost", {
    targetId: invoice,
    amount: 2138,
    reference: "CARRIER-1",
    description: "Facture transporteur",
  });
  await run("supplier_payment", { targetId: invoice, amount: 1000 });
  expect(await data("accountingInvoices/" + invoice)).toMatchObject({
    supplierPaid: 1000,
  });
});
it("règles et serveur : clients refusés, écritures directes interdites, employés limités", async () => {
  await run("invoice", { targetId: invoice });
  const client = env
    .authenticatedContext("book-client", { role: "client" })
    .firestore();
  await assertFails(getDoc(doc(client, "accountingInvoices", invoice)));
  expect(
    (await getDoc(doc(client, "orderFinance", order))).data()?.balance,
  ).toBe(2850);
  const unprivileged = env
    .authenticatedContext("no-finance", {
      role: "staff",
      perms: ["orders.read"],
    })
    .firestore();
  await assertFails(getDoc(doc(unprivileged, "accountingInvoices", invoice)));
  await env.withSecurityRulesDisabled((c) =>
    setDoc(doc(c.firestore(), "users", "forged-profile"), {
      role: "admin",
      disabled: false,
    }),
  );
  const forged = env
    .authenticatedContext("forged-profile", { role: "operator" })
    .firestore();
  await assertFails(getDoc(doc(forged, "accountingInvoices", invoice)));
  const admin = env
    .authenticatedContext("book-admin", { role: "admin" })
    .firestore();
  await assertFails(
    setDoc(doc(admin, "accountingEntries", "fake"), { usd: 100 }),
  );
  await assertFails(
    setDoc(
      doc(admin, "orderFinance", order),
      { totalPaid: 999 },
      { merge: true },
    ),
  );
  await env.withSecurityRulesDisabled(async (c) => {
    const logs = await getDocs(collection(c.firestore(), "accountingAudit"));
    expect(logs.size).toBe(1);
    await assertFails(
      setDoc(doc(admin, "accountingAudit", logs.docs[0].id), {
        action: "falsifié",
      }),
    );
  });
  const staff = env
    .authenticatedContext("reader", { role: "staff", perms: ["finance.read"] })
    .firestore();
  expect((await getDocs(collection(staff, "accountingInvoices"))).size).toBe(1);
  await env.withSecurityRulesDisabled((c) =>
    setDoc(doc(c.firestore(), "users", "book-admin"), {
      role: "admin",
      disabled: true,
    }),
  );
  await expect(
    run("payment", { targetId: invoice, amount: 100 }),
  ).rejects.toThrow();
});
it("dettes de dépenses réglées sans compter deux fois la charge et objectif personnel quotidien", async () => {
  const expense = await run("expense", {
    amount: 10000,
    description: "Internet",
    category: "internet",
    paid: false,
  });
  await run("expense_payment", {
    targetId: (expense.data as { entryId: string }).entryId,
    amount: 4000,
  });
  await expect(
    run("expense_payment", {
      targetId: (expense.data as { entryId: string }).entryId,
      amount: 6001,
    }),
  ).rejects.toThrow();
  await run("goal", {
    metric: "savings",
    amount: 10000,
    dailyTargetCents: 10000,
    end: "2026-11-16",
  });
  await env.withSecurityRulesDisabled(async (c) => {
    const goals = await getDocs(collection(c.firestore(), "accountingGoals"));
    expect(goals.docs[0].data().amount).toBe(30000);
  });
});
it("refuse les opérations antidatées avant leur pièce d’origine", async () => {
  await run("invoice", { targetId: invoice });
  await expect(
    run("payment", { targetId: invoice, amount: 100, date: "2026-11-13" }),
  ).rejects.toThrow(/précéder/);
  const payment = await run("payment", { targetId: invoice, amount: 100 });
  await expect(
    run("refund", {
      targetId: (payment.data as { entryId: string }).entryId,
      amount: 50,
      date: "2026-11-13",
      description: "Correction",
    }),
  ).rejects.toThrow(/précéder/);
});
it("refuse la reprise aveugle des paiements historiques", async () => {
  await env.withSecurityRulesDisabled((c) =>
    setDoc(doc(c.firestore(), "paymentRecords", "legacy"), {
      orderId: order,
      amount: 100,
      currency: "USD",
      voided: false,
    }),
  );
  await expect(run("invoice", { targetId: invoice })).rejects.toThrow(
    /rapprochement/,
  );
  expect(await data("accountingInvoices/" + invoice)).toBeUndefined();
});
