import { onCall, HttpsError } from "firebase-functions/v2/https";
import { createHash } from "node:crypto";
import {
  accountingCommandSchema,
  shippingAmount,
  toUsd,
  hasPermission,
} from "../../shared/index.js";
import { db, requirePermission, audit, FieldValue, fail } from "./lib/core.js";
import { callableOptions } from "./lib/options.js";

/** Les écritures comptables n'ont aucun fallback SDK Web. */
export const accountingCommand = onCall(callableOptions(), async (req) => {
  const actor = requirePermission(req, "finance.write");
  const user = await db().doc(`users/${actor.uid}`).get();
  if (user.exists) {
    const u = user.data()!;
    if (
      u.disabled ||
      !hasPermission({ role: u.role, perms: u.permissions }, "finance.write")
    )
      throw new HttpsError("permission-denied", "Accès comptable refusé.");
  }
  if (JSON.stringify(req.data ?? null).length > 200_000)
    fail("invalid-argument", "Requête comptable trop volumineuse.");
  const validated = accountingCommandSchema.safeParse(req.data);
  if (!validated.success)
    fail(
      "invalid-argument",
      "Données comptables invalides. Vérifiez les montants, les dates, la devise et les champs obligatoires.",
    );
  const input = validated.data;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  return db().runTransaction(async (tx) => {
    const receipt = db().doc(
        `accountingRequests/${actor.uid}_${input.requestId}`,
      ),
      previous = await tx.get(receipt);
    if (previous.exists) {
      if (previous.data()!.fingerprint !== fingerprint)
        fail("already-exists", "Cette clé identifie une autre opération.");
      return previous.data()!.result;
    }
    const now = FieldValue.serverTimestamp();
    const write = (result: Record<string, unknown>) => {
      tx.create(receipt, { fingerprint, result, createdAt: now });
      // Copie comptable protégée, indépendante du journal administratif historique.
      tx.create(db().doc(`accountingAudit/${receipt.id}`), {
        action: input.kind,
        actorUid: actor.uid,
        actorRole: actor.role,
        requestId: input.requestId,
        input,
        result,
        fingerprint,
        createdAt: now,
      });
      audit(
        tx,
        actor,
        `accounting.${input.kind}`,
        "accounting",
        input.targetId ?? input.requestId,
        input.description || input.kind,
        { requestId: input.requestId },
      );
      return result;
    };
    if (input.kind === "rates") {
      if (
        actor.role !== "admin" ||
        (user.exists && user.data()!.role !== "admin")
      )
        throw new HttpsError(
          "permission-denied",
          "Tarifs réservés aux administrateurs.",
        );
      if (!input.clientRateCents || !input.carrierRateCents)
        fail("invalid-argument", "Les deux tarifs sont obligatoires.");
      tx.set(
        db().doc("settings/public"),
        { shippingRatePerLbCents: input.clientRateCents },
        { merge: true },
      );
      tx.set(db().doc("accountingSettings/rates"), {
        clientRateCents: input.clientRateCents,
        carrierRateCents: input.carrierRateCents,
        updatedBy: actor.uid,
        updatedAt: now,
      });
      return write({ ok: true });
    }
    if (input.kind === "goal") {
      if (
        !input.metric ||
        !input.amount ||
        !input.end ||
        input.end < input.date
      )
        fail("invalid-argument", "Objectif, dates et montant requis.");
      tx.create(db().doc(`accountingGoals/${input.requestId}`), {
        metric: input.metric,
        amount:
          input.metric === "savings"
            ? (input.dailyTargetCents ?? 10000) *
              (Math.round(
                (Date.parse(input.end) - Date.parse(input.date)) / 86400000,
              ) +
                1)
            : input.amount,
        dailyTargetCents:
          input.metric === "savings" ? (input.dailyTargetCents ?? 10000) : null,
        start: input.date,
        end: input.end,
        description: input.description,
        recordedBy: actor.uid,
        createdAt: now,
      });
      return write({ ok: true });
    }
    if (input.kind === "invoice") {
      if (!input.targetId)
        fail("invalid-argument", "Choisissez un colis pesé.");
      const ship = await tx.get(db().doc(`shipments/${input.targetId}`));
      if (!ship.exists) fail("not-found", "Colis introuvable.");
      const s = ship.data()!;
      if (s.status === "cancelled" || !s.weighedAt || !s.actualWeightLb)
        fail("failed-precondition", "Le colis doit être pesé et actif.");
      if (s.orderIds?.length !== 1)
        fail(
          "failed-precondition",
          "La ventilation des colis multicommandes doit être effectuée avant facturation.",
        );
      const order = await tx.get(db().doc(`orders/${s.orderIds[0]}`));
      if (!order.exists || order.data()!.clientUid !== s.clientUid)
        fail("failed-precondition", "Association client/commande invalide.");
      if (order.data()!.currency !== "USD")
        fail(
          "failed-precondition",
          "La commande historique en HTG doit être rapprochée manuellement avant facturation USD.",
        );
      const ref = db().doc(`accountingInvoices/${input.targetId}`),
        exists = await tx.get(ref),
        rates = await tx.get(db().doc("accountingSettings/rates"));
      const legacy = await tx.get(
        db().collection("paymentRecords").where("orderId", "==", s.orderIds[0]),
      );
      const oldFinance = await tx.get(
        db().doc(`orderFinance/${s.orderIds[0]}`),
      );
      if (exists.exists)
        fail("already-exists", "Ce colis possède déjà une facture.");
      if (
        s.shippingPaymentStatus === "paid" ||
        (s.paidAmountCents ?? 0) > 0 ||
        legacy.docs.some(
          (d) => !d.data().voided && !d.data().accountingInvoiceId,
        ) ||
        ((oldFinance.data()?.charges?.length ||
          oldFinance.data()?.totalDue ||
          oldFinance.data()?.totalPaid ||
          oldFinance.data()?.balance) &&
          !oldFinance.data()?.accountingManaged)
      )
        fail(
          "failed-precondition",
          "Des frais ou paiements historiques existent : rapprochement obligatoire, aucune donnée ne sera remplacée.",
        );
      const weightMilli = Math.round(s.actualWeightLb * 1000);
      if (Math.abs(weightMilli - s.actualWeightLb * 1000) > 0.00001)
        fail("invalid-argument", "Poids limité à trois décimales.");
      const clientRateCents =
          s.ratePerLbCents ?? rates.data()?.clientRateCents ?? 600,
        carrierRateCents = rates.data()?.carrierRateCents ?? 450;
      const revenue = shippingAmount(weightMilli, clientRateCents),
        cost = shippingAmount(weightMilli, carrierRateCents);
      tx.update(ship.ref, { accountingManaged: true });
      tx.create(ref, {
        id: ref.id,
        orderId: order.id,
        shipmentId: ship.id,
        clientId: s.clientId,
        clientUid: s.clientUid,
        date: input.date,
        weightMilli,
        clientRateCents,
        carrierRateCents,
        revenue,
        cost,
        costConfirmed: false,
        estimatedCost: cost,
        paid: 0,
        supplierPaid: 0,
        currency: "USD",
        recordedBy: actor.uid,
        createdAt: now,
      });
      tx.set(db().doc(`orderFinance/${order.id}`), {
        accountingManaged: true,
        orderId: order.id,
        clientId: s.clientId,
        clientUid: s.clientUid,
        currency: "USD",
        charges: [
          ...(oldFinance.data()?.charges ?? []),
          {
            id: ref.id,
            kind: "shipping",
            label: `Shipping ${s.trackingNumber}`,
            amount: revenue,
          },
        ],
        totalDue: (oldFinance.data()?.totalDue ?? 0) + revenue,
        totalPaid: oldFinance.data()?.totalPaid ?? 0,
        balance: (oldFinance.data()?.balance ?? 0) + revenue,
        paymentStatus:
          (oldFinance.data()?.totalPaid ?? 0) > 0 ? "partial" : "unpaid",
        updatedAt: now,
      });
      return write({ invoiceId: ref.id });
    }
    let usd: number,
      amount = input.amount ?? 0,
      currency = input.currency,
      rateMicros = currency === "USD" ? 1000000 : input.rateMicros,
      rateDate = input.rateDate ?? input.date,
      targetId = input.targetId ?? "",
      orderId = "";
    const category = input.category;
    let costAdjustment = 0;
    let invoice: FirebaseFirestore.DocumentSnapshot | undefined;
    let original: FirebaseFirestore.DocumentSnapshot | undefined;
    if (input.kind === "refund" || input.kind === "void") {
      if (!targetId || !input.description.trim())
        fail("invalid-argument", "Paiement et motif obligatoires.");
      original = await tx.get(db().doc(`accountingEntries/${targetId}`));
      if (!original.exists || original.data()!.kind !== "payment")
        fail("invalid-argument", "Choisissez un encaissement original.");
      const p = original.data()!;
      targetId = p.targetId;
      if (input.date < p.date)
        fail(
          "invalid-argument",
          "Le remboursement ne peut pas précéder le paiement.",
        );
      if (input.kind === "void") {
        if (p.refundedAmount)
          fail(
            "failed-precondition",
            "Ce paiement est déjà remboursé en partie.",
          );
        amount = p.amount;
        currency = p.currency;
      } else if (currency !== p.currency)
        fail("invalid-argument", "Utilisez la devise du paiement original.");
      if (!amount || amount > p.amount - (p.refundedAmount ?? 0))
        fail(
          "invalid-argument",
          "Remboursement supérieur au paiement disponible.",
        );
      // Remboursements au taux historique ; cumul arrondi pour éviter les centimes résiduels.
      const totalRefunded = toUsd(
        (p.refundedAmount ?? 0) + amount,
        p.currency,
        p.rateMicros,
      );
      usd = -(totalRefunded - (p.refundedUsd ?? 0));
      rateMicros = p.rateMicros;
      rateDate = p.rateDate;
    } else usd = toUsd(amount, currency, rateMicros);
    if (currency === "HTG" && !input.rateDate && !original)
      fail("invalid-argument", "La date du taux HTG est obligatoire.");
    if (
      [
        "payment",
        "refund",
        "void",
        "supplier_payment",
        "confirm_cost",
      ].includes(input.kind)
    ) {
      if (!targetId) fail("invalid-argument", "Facture obligatoire.");
      invoice = await tx.get(db().doc(`accountingInvoices/${targetId}`));
      if (!invoice.exists) fail("not-found", "Facture introuvable.");
      orderId = invoice.data()!.orderId;
      if (input.date < invoice.data()!.date)
        fail(
          "invalid-argument",
          "L’opération ne peut pas précéder la facture.",
        );
    }
    const expense =
      input.kind === "expense_payment" && targetId
        ? await tx.get(db().doc(`accountingEntries/${targetId}`))
        : undefined;
    const fin = invoice
      ? await tx.get(db().doc(`orderFinance/${orderId}`))
      : undefined;
    const referenceId = input.reference
      ? createHash("sha256")
          .update(
            `${input.kind}:${input.method}:${input.reference.toUpperCase()}`,
          )
          .digest("hex")
      : null;
    if (
      referenceId &&
      (await tx.get(db().doc(`accountingReferences/${referenceId}`))).exists
    )
      fail(
        "already-exists",
        "Cette référence de paiement est déjà enregistrée.",
      );
    if (input.kind === "expense" && !input.description)
      fail("invalid-argument", "La description de la dépense est obligatoire.");
    if (input.kind === "expense" && category === "shipping")
      fail(
        "invalid-argument",
        "Le shipping est déjà calculé sur facture. Utilisez le règlement fournisseur.",
      );
    if (input.kind === "expense_payment") {
      if (
        !expense?.exists ||
        expense.data()!.kind !== "expense" ||
        expense.data()!.paid
      )
        fail("invalid-argument", "Choisissez une dépense non payée.");
      const e = expense.data()!;
      if (input.date < e.date)
        fail(
          "invalid-argument",
          "Le règlement ne peut pas précéder la dépense.",
        );
      if (usd > e.usd - (e.settledUsd ?? 0))
        fail("invalid-argument", "Règlement supérieur à la dette.");
      tx.update(expense.ref, { settledUsd: (e.settledUsd ?? 0) + usd });
    }
    if (invoice) {
      const i = invoice.data()!;
      if (input.kind === "confirm_cost") {
        if (!input.reference || !input.description)
          fail(
            "invalid-argument",
            "Référence fournisseur et description obligatoires.",
          );
        if (i.supplierPaid || i.costConfirmed)
          fail("failed-precondition", "Le coût est déjà confirmé ou réglé.");
        costAdjustment = usd - i.cost;
        tx.update(invoice.ref, {
          cost: usd,
          costConfirmed: true,
          costConfirmedOn: input.date,
        });
      } else if (input.kind === "supplier_payment") {
        if (i.costConfirmedOn && input.date < i.costConfirmedOn)
          fail(
            "invalid-argument",
            "Le règlement ne peut pas précéder la confirmation de dette.",
          );
        if (!i.costConfirmed)
          fail(
            "failed-precondition",
            "Confirmez la dette fournisseur avant règlement.",
          );
        if (usd > i.cost - i.supplierPaid)
          fail(
            "invalid-argument",
            "Règlement supérieur à la dette fournisseur.",
          );
        tx.update(invoice.ref, { supplierPaid: i.supplierPaid + usd });
      } else {
        const paid = i.paid + usd;
        if (paid < 0 || paid > i.revenue)
          fail("invalid-argument", "Montant supérieur au solde disponible.");
        tx.update(invoice.ref, { paid });
        tx.update(db().doc(`shipments/${i.shipmentId}`), {
          paidAmountCents: paid,
          shippingPaymentStatus: paid >= i.revenue ? "paid" : "unpaid",
          updatedAt: now,
        });
        const paidOrder = (fin?.data()?.totalPaid ?? 0) + usd,
          due = fin?.data()?.totalDue ?? 0;
        tx.update(fin!.ref, {
          totalPaid: paidOrder,
          balance: due - paidOrder,
          paymentStatus:
            paidOrder === 0 ? "unpaid" : paidOrder >= due ? "paid" : "partial",
          updatedAt: now,
        });
        tx.create(db().doc(`paymentRecords/ACC_${input.requestId}`), {
          orderId,
          clientId: i.clientId,
          clientUid: i.clientUid,
          amount: usd,
          currency: "USD",
          method: input.method,
          reference: input.reference,
          receivedOn: input.date,
          voided: false,
          voidReason: null,
          recordedBy: actor.uid,
          accountingInvoiceId: invoice.id,
          originalAmount: amount,
          originalCurrency: currency,
          rateMicros,
          rateDate,
          createdAt: now,
        });
      }
    }
    if (original) {
      const p = original.data()!;
      tx.update(original.ref, {
        refundedAmount: (p.refundedAmount ?? 0) + amount,
        refundedUsd: (p.refundedUsd ?? 0) - usd,
      });
    }
    tx.create(db().doc(`accountingEntries/${input.requestId}`), {
      ...input,
      id: input.requestId,
      targetId,
      orderId,
      amount,
      currency,
      rateMicros: rateMicros ?? 1000000,
      rateDate,
      usd,
      category,
      costAdjustment,
      originalId: original?.id ?? null,
      recordedBy: actor.uid,
      createdAt: now,
    });
    if (referenceId)
      tx.create(db().doc(`accountingReferences/${referenceId}`), {
        entryId: input.requestId,
      });
    return write({ entryId: input.requestId });
  });
});
