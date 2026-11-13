import { onCall } from "firebase-functions/v2/https";
import {
  createShipmentSchema,
  updateShipmentSchema,
  recordShipmentWeighingSchema,
  updateShippingPaymentSchema,
  formatShipmentId,
  defaultTrackingNumber,
  validateAllocation,
  validateDateOrder,
  diffDates,
  todayIso,
  ESTIMATE_FIELDS,
  SHIPPED_STATUSES,
  DATE_FIELD_LABELS,
  formatIsoDate,
  COMMERCIAL_RATE_CENTS_PER_LB,
  calculateShippingFeeCents,
  computeOrderStats,
  hasConfirmedMiamiReception,
  formatMoney,
  formatWeightLb,
  type ClientDoc,
  type ShipmentDates,
  type ShipmentLine,
  type OrderItem,
  type WeightCorrectionEntry,
  type ShippingPaymentStatus,
} from "../../shared/index.js";
import type { Transaction } from "firebase-admin/firestore";
import { db, parse, audit, readCreationCounter, writeCreationCounter, readTrackingGuard, writeTrackingGuard, FieldValue, fail, requirePermission } from "./lib/core.js";
import { loadOrdersWithShipments, deriveOrder, type OrderData, type ShipmentData } from "./lib/logistics.js";
import { writeEvent } from "./lib/events.js";
import { dispatchNotifications, type PendingNotification } from "./lib/notify.js";
import { callableOptions } from "./lib/options.js";

const trackingRef = (tn: string) => db().doc(`trackingNumbers/${tn}`);

/** Vérifie la cohérence des lignes (même client, articles existants, quantités ≤ reçues non emballées). */
function buildLines(
  input: { orderId: string; lineId: string; quantity: number }[],
  orders: Map<string, OrderData>,
  otherShipments: ShipmentData[],
  clientUid: string,
): ShipmentLine[] {
  const merged = new Map<string, { orderId: string; lineId: string; quantity: number }>();
  for (const l of input) {
    const k = `${l.orderId}::${l.lineId}`;
    const prev = merged.get(k);
    merged.set(k, { ...l, quantity: (prev?.quantity ?? 0) + l.quantity });
  }
  const lines: ShipmentLine[] = [];
  for (const l of merged.values()) {
    const order = orders.get(l.orderId);
    if (!order) fail("not-found", `Commande ${l.orderId} introuvable.`);
    if (order.clientUid !== clientUid) fail("invalid-argument", `La commande ${l.orderId} appartient à un autre client.`);
    if (order.status === "cancelled") fail("failed-precondition", `La commande ${l.orderId} est annulée.`);
    const item = order.items.find((i) => i.lineId === l.lineId);
    if (!item) fail("invalid-argument", "Article introuvable dans la commande.");
    lines.push({ orderId: l.orderId, lineId: l.lineId, description: item.description, quantity: l.quantity });
  }
  const ordersItems: Record<string, OrderItem[]> = {};
  for (const [id, o] of orders) ordersItems[id] = o.items;
  const issues = validateAllocation({ newLines: lines, orders: ordersItems, otherShipments });
  if (issues.length) fail("failed-precondition", issues.map((i) => i.message).join(" "));
  return lines;
}

function assertDates(dates: ShipmentDates) {
  const errors = validateDateOrder(dates);
  if (errors.length) fail("invalid-argument", errors.join(" "));
}

async function reserveTracking(tx: Transaction, tn: string, shipmentId: string) {
  const reservation = await tx.get(trackingRef(tn));
  if (reservation.exists && reservation.data()?.shipmentId !== shipmentId) fail("already-exists", `Le numéro de suivi ${tn} est déjà utilisé.`);
  const matches = await tx.get(db().collection("shipments").where("trackingNumber", "==", tn));
  if (matches.docs.some(snap => snap.id !== shipmentId)) fail("already-exists", `Le numéro de suivi ${tn} est déjà utilisé.`);
}

/** Création d'un colis pour un client, avec répartition optionnelle d'articles reçus. */
export const createShipment = onCall(callableOptions(), async (req) => {
  const actor = requirePermission(req, "shipments.write");
  const input = parse(createShipmentSchema, req.data);
  assertDates(input.dates);
  const year = Number(todayIso().slice(0, 4));
  const shipmentId = await db().runTransaction(async (tx) => {
    const guard = await readTrackingGuard(tx);
    const clientSnap = await tx.get(db().doc(`clients/${input.clientId}`));
    if (!clientSnap.exists) fail("not-found", "Client introuvable.");
    const client = clientSnap.data() as ClientDoc;
    if (client.status !== "active") fail("failed-precondition", "Le compte de ce client est désactivé.");
    const orderIds = [...new Set(input.lines.map((l) => l.orderId))];
    const { orders, shipments } = await loadOrdersWithShipments(tx, orderIds);
    if (input.trackingNumber) await reserveTracking(tx, input.trackingNumber, "__new__");
    const lines = buildLines(input.lines, orders, [...shipments.values()], client.clientUid);
    const counter = await readCreationCounter(tx, "shipments", year);
    const seq = counter.next;
    const id = formatShipmentId(year, seq);
    const existing = await tx.getAll(db().doc(`shipments/${id}`), db().doc(`shipmentPrivate/${id}`));
    if (existing.some(snap => snap.exists)) fail("already-exists", "Cet identifiant de colis est déjà utilisé. Aucune donnée n'a été remplacée.");
    const trackingNumber = input.trackingNumber ?? defaultTrackingNumber(year, seq);
    if (!input.trackingNumber) await reserveTracking(tx, trackingNumber, id);
    const status = lines.length > 0 ? "preparing" : "awaiting_receipt";
    const data: ShipmentData = {
      shipmentId: id,
      trackingNumber,
      clientId: client.clientId,
      clientUid: client.clientUid,
      orderIds,
      lines,
      itemCount: lines.reduce((s, l) => s + l.quantity, 0),
      weightKg: input.weightKg,
      dimensionsCm: input.dimensionsCm,
      transportMode: input.transportMode,
      status,
      lastStep: 1,
      dates: input.dates,
      dateChangeMessage: input.dateChangeMessage,
      pickupInstructions: input.pickupInstructions,
    };
    if (status === "awaiting_receipt") data.lastStep = 0;
    const now = FieldValue.serverTimestamp();
    writeCreationCounter(tx, counter);
    tx.create(db().doc(`shipments/${id}`), { ...data, searchTokens: [trackingNumber.toLowerCase(), id.toLowerCase()], createdAt: now, updatedAt: now });
    tx.set(trackingRef(trackingNumber), { shipmentId: id, createdAt: now });
    tx.set(db().doc(`shipmentPrivate/${id}`), { shipmentId: id, internalNotes: input.internalNotes ?? "", updatedAt: now, updatedBy: actor.uid });
    shipments.set(id, data);
    for (const o of orders.values()) {
      tx.update(db().doc(`orders/${o.orderId}`), { ...deriveOrder(o, shipments.values()), updatedAt: now });
    }
    writeEvent(tx, actor, {
      kind: "created",
      targetType: "shipment",
      shipmentId: id,
      orderId: orderIds[0] ?? null,
      clientUid: client.clientUid,
      toStatus: status,
      publicNote: lines.length ? `Colis ${trackingNumber} créé avec ${data.itemCount} article(s).` : `Colis ${trackingNumber} enregistré, en attente de réception.`,
    });
    audit(tx, actor, "shipment.create", "shipment", id, `Colis ${id} (${trackingNumber}) créé pour ${client.clientId}`, { orderIds, itemCount: data.itemCount });
    writeTrackingGuard(tx, guard);
    return id;
  });
  return { shipmentId };
});

/** Modification d'un colis : contenu (avant expédition), caractéristiques, dates et instructions. */
export const updateShipment = onCall(callableOptions(), async (req) => {
  const actor = requirePermission(req, "shipments.write");
  const input = parse(updateShipmentSchema, req.data);
  assertDates(input.dates);
  const notifications: PendingNotification[] = [];
  await db().runTransaction(async (tx) => {
    const guard = await readTrackingGuard(tx);
    const ref = db().doc(`shipments/${input.shipmentId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) fail("not-found", "Colis introuvable.");
    const current = snap.data() as ShipmentData;
    if (current.status === "cancelled") fail("failed-precondition", "Un colis annulé ne peut plus être modifié.");
    const newOrderIds = [...new Set(input.lines.map((l) => l.orderId))];
    const { orders, shipments } = await loadOrdersWithShipments(tx, [...new Set([...current.orderIds, ...newOrderIds])]);
    const trackingNumber = input.trackingNumber ?? current.trackingNumber;
    if (trackingNumber !== current.trackingNumber) await reserveTracking(tx, trackingNumber, current.shipmentId);

    const linesChanged = JSON.stringify(input.lines.map((l) => [l.orderId, l.lineId, l.quantity]).sort()) !==
      JSON.stringify(current.lines.map((l) => [l.orderId, l.lineId, l.quantity]).sort());
    if (linesChanged && SHIPPED_STATUSES.includes(current.status)) {
      fail("failed-precondition", "Le contenu d'un colis expédié ne peut plus être modifié.");
    }
    const others = [...shipments.values()].filter((s) => s.shipmentId !== current.shipmentId);
    const lines = linesChanged ? buildLines(input.lines, orders, others, current.clientUid) : current.lines;

    const changes = diffDates(current.dates ?? {}, input.dates);
    const next: ShipmentData = {
      ...current,
      trackingNumber,
      orderIds: [...new Set(lines.map((l) => l.orderId))],
      lines,
      itemCount: lines.reduce((s, l) => s + l.quantity, 0),
      weightKg: input.weightKg,
      dimensionsCm: input.dimensionsCm,
      transportMode: input.transportMode,
      dates: input.dates,
      dateChangeMessage: Object.keys(changes).length ? input.dateChangeMessage : current.dateChangeMessage ?? null,
      pickupInstructions: input.pickupInstructions,
    };
    if (next.orderIds.length === 0) next.orderIds = current.orderIds.filter((id) => !linesChanged || newOrderIds.includes(id));
    const now = FieldValue.serverTimestamp();
    tx.update(ref, { ...next, searchTokens: [trackingNumber.toLowerCase(), current.shipmentId.toLowerCase()], updatedAt: now });
    tx.set(db().doc(`shipmentPrivate/${current.shipmentId}`), { shipmentId: current.shipmentId, internalNotes: input.internalNotes ?? "", updatedAt: now, updatedBy: actor.uid });
    if (trackingNumber !== current.trackingNumber) {
      tx.delete(trackingRef(current.trackingNumber));
      tx.set(trackingRef(trackingNumber), { shipmentId: current.shipmentId, createdAt: now });
    }
    shipments.set(current.shipmentId, next);
    for (const o of orders.values()) {
      tx.update(db().doc(`orders/${o.orderId}`), { ...deriveOrder(o, shipments.values()), updatedAt: now });
    }
    if (Object.keys(changes).length) {
      writeEvent(tx, actor, {
        kind: "dates",
        targetType: "shipment",
        shipmentId: current.shipmentId,
        orderId: next.orderIds[0] ?? null,
        clientUid: current.clientUid,
        dateChanges: changes,
        publicNote: input.dateChangeMessage,
      });
      const estimateChanged = Object.keys(changes).filter((k) => (ESTIMATE_FIELDS as readonly string[]).includes(k) || k === "availableAt");
      if (estimateChanged.length) {
        const parts = estimateChanged.map((k) => `${DATE_FIELD_LABELS[k as keyof ShipmentDates]} : ${formatIsoDate(changes[k]![1])}`);
        notifications.push({
          recipientUid: current.clientUid,
          type: "eta_changed",
          title: `Nouvelle estimation — colis ${trackingNumber}`,
          body: `${parts.join(" ; ")} (estimation, non garantie).${input.dateChangeMessage ? ` ${input.dateChangeMessage}` : ""}`,
          shipmentId: current.shipmentId,
          orderId: next.orderIds[0] ?? null,
          discriminator: estimateChanged.map((k) => `${k}-${changes[k]![1] ?? "none"}`).join("_"),
        });
      }
    }
    audit(tx, actor, "shipment.update", "shipment", current.shipmentId, `Colis ${current.shipmentId} modifié`, {
      linesChanged,
      dateChanges: changes,
      trackingChanged: trackingNumber !== current.trackingNumber,
    });
    writeTrackingGuard(tx, guard);
  });
  await dispatchNotifications(notifications);
  return { ok: true };
});

/**
 * Enregistrement ou correction du poids réel d'un colis à l'entrepôt de Miami.
 * - Vérifie l'autorisation (shipments.write)
 * - Vérifie que le colis existe et que la réception à Miami est confirmée
 * - Calcule côté serveur : frais = poids réel (lb) × 6,00 USD/lb (sans jamais arrondir le poids)
 * - Conserve l'historique des pesées/corrections et protège l'historique des paiements.
 */
export const recordShipmentWeighing = onCall(callableOptions(), async (req) => {
  const actor = requirePermission(req, "shipments.write");
  const input = parse(recordShipmentWeighingSchema, req.data);
  const notifications: PendingNotification[] = [];

  const result = await db().runTransaction(async (tx) => {
    const ref = db().doc(`shipments/${input.shipmentId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) fail("not-found", "Colis introuvable.");
    const current = snap.data() as ShipmentData & {
      actualWeightLb?: number | null;
      ratePerLbCents?: number | null;
      shippingFeeCents?: number | null;
      shippingPaymentStatus?: ShippingPaymentStatus | null;
      paidAmountCents?: number | null;
      miamiReceivedAt?: string | null;
      weightHistory?: WeightCorrectionEntry[];
    };
    if (current.status === "cancelled") {
      fail("failed-precondition", "Impossible de peser un colis annulé.");
    }

    const { orders, shipments } = await loadOrdersWithShipments(tx, current.orderIds);
    for (const order of orders.values()) {
      if (order.clientUid !== current.clientUid) fail("failed-precondition", "Le colis et la commande n'appartiennent pas au même client.");
    }
    const nowIso = new Date().toISOString();
    let miamiReceivedAt = current.miamiReceivedAt ?? null;
    let nextStatus = current.status;
    const dates = { ...(current.dates ?? {}) };

    if (!hasConfirmedMiamiReception({ status: current.status, miamiReceivedAt })) {
      if (!input.confirmMiamiReceipt) {
        fail("failed-precondition", "La réception physique à Miami doit être confirmée avant la pesée.");
      }
      miamiReceivedAt = nowIso;
      nextStatus = "received";
      if (!dates.warehouseReceivedAt) dates.warehouseReceivedAt = todayIso();
    } else if (!miamiReceivedAt) {
      miamiReceivedAt = nowIso;
    }

    const ratePerLbCents = current.ratePerLbCents ?? COMMERCIAL_RATE_CENTS_PER_LB;
    const shippingFeeCents = calculateShippingFeeCents(input.weightLb, ratePerLbCents);
    const prevWeight = current.actualWeightLb ?? null;
    const prevFee = current.shippingFeeCents ?? null;
    const isCorrection = prevWeight !== null;

    if (isCorrection && !input.reason?.trim()) {
      fail("invalid-argument", "Un motif est obligatoire pour corriger une pesée existante.");
    }

    const entry: WeightCorrectionEntry = {
      previousWeightLb: prevWeight,
      newWeightLb: input.weightLb,
      previousFeeCents: prevFee,
      newFeeCents: shippingFeeCents,
      ratePerLbCents,
      reason: input.reason?.trim() || "Pesée initiale à l'entrepôt de Miami",
      recordedAt: nowIso,
      recordedByUid: actor.uid,
      recordedByEmail: (req.auth?.token?.email as string | undefined) ?? null,
    };
    const weightHistory = [...(current.weightHistory ?? []), entry];

    const paidAmountCents = current.paidAmountCents ?? 0;
    let shippingPaymentStatus: ShippingPaymentStatus = current.shippingPaymentStatus ?? "unpaid";
    if (shippingPaymentStatus === "paid" && isCorrection && shippingFeeCents !== paidAmountCents) {
      shippingPaymentStatus = "adjustment_required";
    } else if (!current.shippingPaymentStatus) {
      shippingPaymentStatus = "unpaid";
    }

    const now = FieldValue.serverTimestamp();
    tx.update(ref, {
      status: nextStatus,
      lastStep: nextStatus === "received" ? Math.max(current.lastStep ?? 1, 1) : current.lastStep,
      dates,
      miamiReceivedAt,
      actualWeightLb: input.weightLb,
      ratePerLbCents,
      shippingFeeCents,
      shippingCurrency: "USD",
      shippingPaymentStatus,
      paidAmountCents,
      weighedAt: nowIso,
      weighedByUid: actor.uid,
      weightHistory,
      updatedAt: now,
    });

    shipments.set(current.shipmentId, { ...current, status: nextStatus });
    for (const order of orders.values()) {
      const items = order.items.map(item => ({ ...item, quantityReceived: Math.max(item.quantityReceived,
        current.lines.filter(line => line.orderId === order.orderId && line.lineId === item.lineId).reduce((sum, line) => sum + line.quantity, 0)) }));
      tx.update(db().doc(`orders/${order.orderId}`), {
        items, stats: computeOrderStats(order.orderId, items, [...shipments.values()]),
        ...(order.shipmentIds.length === 1 && order.status !== "cancelled" ? { status: nextStatus } : {}), updatedAt: now,
      });
    }

    const note = isCorrection
      ? `Poids corrigé : ${formatWeightLb(input.weightLb)} — Frais recalculés : ${formatMoney(shippingFeeCents, "USD")}.`
      : `Colis pesé à Miami : ${formatWeightLb(input.weightLb)} — Frais de livraison : ${formatMoney(shippingFeeCents, "USD")} (6,00 USD/lb).`;

    writeEvent(tx, actor, {
      kind: "status",
      targetType: "shipment",
      shipmentId: current.shipmentId,
      orderId: current.orderIds[0] ?? null,
      clientUid: current.clientUid,
      fromStatus: current.status,
      toStatus: nextStatus,
      publicNote: note,
      internalNote: input.reason ?? null,
    });

    audit(
      tx,
      actor,
      isCorrection ? "shipment.weigh_correct" : "shipment.weigh",
      "shipment",
      current.shipmentId,
      note,
      {
        previousWeightLb: prevWeight,
        newWeightLb: input.weightLb,
        previousFeeCents: prevFee,
        newFeeCents: shippingFeeCents,
        ratePerLbCents,
      },
    );

    notifications.push({
      recipientUid: current.clientUid,
      type: "shipment_received",
      title: `Pesée enregistrée — colis ${current.trackingNumber}`,
      body: note,
      shipmentId: current.shipmentId,
      orderId: current.orderIds[0] ?? null,
      discriminator: `weigh-${input.weightLb}-${shippingFeeCents}`,
    });

    return {
      actualWeightLb: input.weightLb,
      ratePerLbCents,
      shippingFeeCents,
      shippingPaymentStatus,
    };
  });

  await dispatchNotifications(notifications);
  return result;
});

/** Mise à jour administrative du statut de paiement des frais de livraison d'un colis. */
export const updateShippingPayment = onCall(callableOptions(), async (req) => {
  const actor = requirePermission(req, "finance.write");
  const input = parse(updateShippingPaymentSchema, req.data);

  await db().runTransaction(async (tx) => {
    const ref = db().doc(`shipments/${input.shipmentId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) fail("not-found", "Colis introuvable.");
    const current = snap.data() as ShipmentData & {
      shippingFeeCents?: number | null;
      paidAmountCents?: number | null;
      shippingPaymentStatus?: ShippingPaymentStatus | null;
    };
    if (current.shippingFeeCents == null || current.shippingFeeCents <= 0) {
      fail("failed-precondition", "Le colis doit d'abord être pesé à Miami avant d'enregistrer un paiement.");
    }
    const paidAmountCents =
      input.paidAmountCents !== null && input.paidAmountCents !== undefined
        ? input.paidAmountCents
        : input.shippingPaymentStatus === "paid"
          ? current.shippingFeeCents
          : (current.paidAmountCents ?? 0);

    tx.update(ref, {
      shippingPaymentStatus: input.shippingPaymentStatus,
      paidAmountCents,
      updatedAt: FieldValue.serverTimestamp(),
    });

    audit(
      tx,
      actor,
      "shipment.payment_status",
      "shipment",
      current.shipmentId,
      `Statut de paiement du colis ${current.trackingNumber} : ${input.shippingPaymentStatus}`,
      {
        previousStatus: current.shippingPaymentStatus ?? null,
        nextStatus: input.shippingPaymentStatus,
        paidAmountCents,
        note: input.note ?? null,
      },
    );
  });

  return { ok: true };
});
