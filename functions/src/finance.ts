import { onCall } from "firebase-functions/v2/https";
import {
  setChargesSchema,
  recordPaymentSchema,
  voidPaymentSchema,
  totalDue,
  totalPaid,
  balance,
  paymentStatus,
  formatMoney,
  type ChargeLine,
  type OrderFinanceDoc,
  type PaymentRecordDoc,
} from "../../shared/index.js";
import { db, parse, audit, FieldValue, fail, requirePermission } from "./lib/core.js";
import type { OrderData } from "./lib/logistics.js";
import { callableOptions } from "./lib/options.js";

function nextChargeId(existing: Set<string>): string {
  let n = existing.size + 1;
  while (existing.has(`C${n}`)) n += 1;
  existing.add(`C${n}`);
  return `C${n}`;
}

/** Définit les lignes de frais (transport, frais supplémentaires, réductions) d'une commande. */
export const setOrderCharges = onCall(callableOptions(), async (req) => {
  const actor = requirePermission(req, "finance.write");
  const input = parse(setChargesSchema, req.data);

  await db().runTransaction(async (tx) => {
    const orderSnap = await tx.get(db().doc(`orders/${input.orderId}`));
    if (!orderSnap.exists) fail("not-found", "Commande introuvable.");
    const order = orderSnap.data() as OrderData;
    const finRef = db().doc(`orderFinance/${input.orderId}`);
    const finSnap = await tx.get(finRef);
    const paymentsSnap = await tx.get(db().collection("paymentRecords").where("orderId", "==", input.orderId));

    const used = new Set<string>();
    const charges: ChargeLine[] = input.charges.map((c) => {
      const id = c.id && !used.has(c.id) ? (used.add(c.id), c.id) : nextChargeId(used);
      return { id, kind: c.kind, label: c.label, amount: c.amount };
    });

    const due = Math.max(0, totalDue(charges));
    const payments = paymentsSnap.docs.map((d) => d.data() as PaymentRecordDoc);
    const paid = totalPaid(payments, order.currency);
    const bal = balance(due, paid);
    const status = paymentStatus(due, paid);

    const prevDue = (finSnap.data() as OrderFinanceDoc | undefined)?.totalDue ?? 0;
    tx.set(finRef, {
      orderId: order.orderId,
      clientUid: order.clientUid,
      clientId: order.clientId,
      currency: order.currency,
      charges,
      totalDue: due,
      totalPaid: paid,
      balance: bal,
      paymentStatus: status,
      updatedAt: FieldValue.serverTimestamp(),
    });

    audit(
      tx,
      actor,
      "finance.charges",
      "order",
      order.orderId,
      `Frais mis à jour (${order.orderId}) : ${formatMoney(due, order.currency)}`,
      { previousDue: prevDue, newDue: due, chargesCount: charges.length },
    );
  });
  return { ok: true };
});

/** Enregistre manuellement un paiement reçu (espèces, virement, MonCash, NatCash, etc.). */
export const recordPayment = onCall(callableOptions(), async (req) => {
  const actor = requirePermission(req, "finance.write");
  const input = parse(recordPaymentSchema, req.data);

  const paymentId = await db().runTransaction(async (tx) => {
    const orderSnap = await tx.get(db().doc(`orders/${input.orderId}`));
    if (!orderSnap.exists) fail("not-found", "Commande introuvable.");
    const order = orderSnap.data() as OrderData;
    if (input.currency !== order.currency) {
      fail("invalid-argument", `Devise incohérente : la commande ${order.orderId} est en ${order.currency}.`);
    }

    const finRef = db().doc(`orderFinance/${input.orderId}`);
    const finSnap = await tx.get(finRef);
    const paymentsSnap = await tx.get(db().collection("paymentRecords").where("orderId", "==", input.orderId));

    const charges = (finSnap.data() as OrderFinanceDoc | undefined)?.charges ?? [];
    const due = Math.max(0, totalDue(charges));
    const existingPayments = paymentsSnap.docs.map((d) => d.data() as PaymentRecordDoc);
    const paid = totalPaid([...existingPayments, { amount: input.amount, currency: input.currency, voided: false }], order.currency);
    const bal = balance(due, paid);
    const status = paymentStatus(due, paid);

    const payRef = db().collection("paymentRecords").doc();
    const now = FieldValue.serverTimestamp();
    tx.set(payRef, {
      orderId: order.orderId,
      clientUid: order.clientUid,
      clientId: order.clientId,
      amount: input.amount,
      currency: order.currency,
      method: input.method,
      reference: input.reference,
      receivedOn: input.receivedOn,
      voided: false,
      voidReason: null,
      recordedBy: actor.uid,
      createdAt: now,
    });

    tx.set(finRef, {
      orderId: order.orderId,
      clientUid: order.clientUid,
      clientId: order.clientId,
      currency: order.currency,
      charges,
      totalDue: due,
      totalPaid: paid,
      balance: bal,
      paymentStatus: status,
      updatedAt: now,
    });

    audit(
      tx,
      actor,
      "finance.payment",
      "order",
      order.orderId,
      `Paiement enregistré (${order.orderId}) : ${formatMoney(input.amount, order.currency)}`,
      { paymentId: payRef.id, amount: input.amount, method: input.method, balanceAfter: bal },
    );
    return payRef.id;
  });
  return { paymentId };
});

/** Annule un paiement enregistré par erreur (conservé dans l'historique avec son motif). */
export const voidPayment = onCall(callableOptions(), async (req) => {
  const actor = requirePermission(req, "finance.write");
  const { paymentId, reason } = parse(voidPaymentSchema, req.data);

  await db().runTransaction(async (tx) => {
    const payRef = db().doc(`paymentRecords/${paymentId}`);
    const paySnap = await tx.get(payRef);
    if (!paySnap.exists) fail("not-found", "Paiement introuvable.");
    const pay = paySnap.data() as PaymentRecordDoc;
    if (pay.voided) fail("failed-precondition", "Ce paiement est déjà annulé.");

    const finRef = db().doc(`orderFinance/${pay.orderId}`);
    const finSnap = await tx.get(finRef);
    const paymentsSnap = await tx.get(db().collection("paymentRecords").where("orderId", "==", pay.orderId));

    const charges = (finSnap.data() as OrderFinanceDoc | undefined)?.charges ?? [];
    const due = Math.max(0, totalDue(charges));
    const others = paymentsSnap.docs
      .filter((d) => d.id !== paymentId)
      .map((d) => d.data() as PaymentRecordDoc);
    const paid = totalPaid(others, pay.currency);
    const bal = balance(due, paid);
    const status = paymentStatus(due, paid);

    const now = FieldValue.serverTimestamp();
    tx.update(payRef, { voided: true, voidReason: reason, updatedAt: now });
    tx.set(
      finRef,
      {
        orderId: pay.orderId,
        clientUid: pay.clientUid,
        clientId: pay.clientId,
        currency: pay.currency,
        charges,
        totalDue: due,
        totalPaid: paid,
        balance: bal,
        paymentStatus: status,
        updatedAt: now,
      },
      { merge: true },
    );

    audit(
      tx,
      actor,
      "finance.void_payment",
      "order",
      pay.orderId,
      `Paiement annulé (${pay.orderId}) : ${formatMoney(pay.amount, pay.currency)} — ${reason}`,
      { paymentId, amount: pay.amount, reason },
    );
  });
  return { ok: true };
});
