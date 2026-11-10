import { onCall } from "firebase-functions/v2/https";
import {
  createShipmentSchema,
  updateShipmentSchema,
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
  type ClientDoc,
  type ShipmentDates,
  type ShipmentLine,
  type OrderItem,
} from "../../shared/index.js";
import type { Transaction } from "firebase-admin/firestore";
import { db, parse, audit, nextSequence, FieldValue, fail, requirePermission } from "./lib/core.js";
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
  const snap = await tx.get(trackingRef(tn));
  if (snap.exists && snap.data()?.shipmentId !== shipmentId) fail("already-exists", `Le numéro de suivi ${tn} est déjà utilisé.`);
}

/** Création d'un colis pour un client, avec répartition optionnelle d'articles reçus. */
export const createShipment = onCall(callableOptions(), async (req) => {
  const actor = requirePermission(req, "shipments.write");
  const input = parse(createShipmentSchema, req.data);
  assertDates(input.dates);
  const year = Number(todayIso().slice(0, 4));
  const shipmentId = await db().runTransaction(async (tx) => {
    const clientSnap = await tx.get(db().doc(`clients/${input.clientId}`));
    if (!clientSnap.exists) fail("not-found", "Client introuvable.");
    const client = clientSnap.data() as ClientDoc;
    if (client.status !== "active") fail("failed-precondition", "Le compte de ce client est désactivé.");
    const orderIds = [...new Set(input.lines.map((l) => l.orderId))];
    const { orders, shipments } = await loadOrdersWithShipments(tx, orderIds);
    if (input.trackingNumber) await reserveTracking(tx, input.trackingNumber, "__new__");
    const lines = buildLines(input.lines, orders, [...shipments.values()], client.clientUid);
    const seq = await nextSequence(tx, `shipments-${year}`);
    const id = formatShipmentId(year, seq);
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
    tx.set(db().doc(`shipments/${id}`), { ...data, searchTokens: [trackingNumber.toLowerCase(), id.toLowerCase()], createdAt: now, updatedAt: now });
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
  });
  await dispatchNotifications(notifications);
  return { ok: true };
});
