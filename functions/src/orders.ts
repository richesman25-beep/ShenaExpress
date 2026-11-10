import { onCall } from "firebase-functions/v2/https";
import {
  createOrderSchema,
  updateOrderSchema,
  recordReceiptSchema,
  formatOrderId,
  allocatedByLine,
  lineKey,
  computeOrderStats,
  todayIso,
  type ClientDoc,
  type OrderItem,
  type OrderFinanceDoc,
  type StatusCode,
} from "../../shared/index.js";
import { db, parse, audit, nextSequence, FieldValue, fail, requirePermission } from "./lib/core.js";
import { loadOrdersWithShipments, deriveOrder, orderSearchTokens, type OrderData } from "./lib/logistics.js";
import { writeEvent } from "./lib/events.js";
import { dispatchNotifications, type PendingNotification } from "./lib/notify.js";
import { callableOptions } from "./lib/options.js";

function nextLineId(existing: Set<string>): string {
  let n = existing.size + 1;
  while (existing.has(`L${n}`)) n += 1;
  existing.add(`L${n}`);
  return `L${n}`;
}

/** Création d'une commande pour un client existant et actif. Statut initial : « Commande enregistrée ». */
export const createOrder = onCall(callableOptions(), async (req) => {
  const actor = requirePermission(req, "orders.write");
  const input = parse(createOrderSchema, req.data);
  const year = Number(todayIso().slice(0, 4));
  const notifications: PendingNotification[] = [];

  const orderId = await db().runTransaction(async (tx) => {
    const clientSnap = await tx.get(db().doc(`clients/${input.clientId}`));
    if (!clientSnap.exists) fail("not-found", "Client introuvable.");
    const client = clientSnap.data() as ClientDoc;
    if (client.status !== "active") fail("failed-precondition", "Le compte de ce client est désactivé.");
    const seq = await nextSequence(tx, `orders-${year}`);
    const id = formatOrderId(year, seq);
    const used = new Set<string>();
    // Aucune quantité n'est considérée reçue à la création.
    const items: OrderItem[] = input.items.map((i) => ({
      lineId: nextLineId(used),
      description: i.description,
      merchantRef: i.merchantRef,
      quantityOrdered: i.quantityOrdered,
      quantityReceived: 0,
      declaredUnitValue: i.declaredUnitValue,
    }));
    const base: OrderData = {
      orderId: id,
      clientId: client.clientId,
      clientUid: client.clientUid,
      clientName: client.fullName,
      merchant: input.merchant,
      merchantOrderRef: input.merchantOrderRef,
      orderDate: input.orderDate,
      items,
      currency: input.currency,
      status: "registered",
      transportMode: input.transportMode,
      stats: computeOrderStats(id, items, []),
      shipmentIds: [],
      searchTokens: [],
      publicNote: input.publicNote,
    };
    base.searchTokens = orderSearchTokens(base, []);
    const now = FieldValue.serverTimestamp();
    tx.set(db().doc(`orders/${id}`), { ...base, createdAt: now, updatedAt: now });
    tx.set(db().doc(`orderPrivate/${id}`), { orderId: id, internalNotes: input.internalNotes ?? "", updatedAt: now, updatedBy: actor.uid });
    const finance: Omit<OrderFinanceDoc, "updatedAt"> = {
      orderId: id,
      clientUid: client.clientUid,
      clientId: client.clientId,
      currency: input.currency,
      charges: [],
      totalDue: 0,
      totalPaid: 0,
      balance: 0,
      paymentStatus: "none",
    };
    tx.set(db().doc(`orderFinance/${id}`), { ...finance, updatedAt: now });
    writeEvent(tx, actor, {
      kind: "created",
      targetType: "order",
      orderId: id,
      clientUid: client.clientUid,
      toStatus: "registered",
      publicNote: input.publicNote,
    });
    audit(tx, actor, "order.create", "order", id, `Commande ${id} créée pour ${client.clientId}`, { items: items.length });
    notifications.push({
      recipientUid: client.clientUid,
      type: "order_created",
      title: `Commande ${id} enregistrée`,
      body: `Votre commande ${id} a été enregistrée par SHENA Express. Vous serez informé à chaque étape.`,
      orderId: id,
      discriminator: "created",
    });
    return id;
  });
  await dispatchNotifications(notifications);
  return { orderId };
});

/**
 * Modification d'une commande. Les quantités reçues sont conservées ; une ligne ne peut pas
 * descendre sous ce qui a déjà été reçu ou emballé, ni être supprimée si elle a été reçue.
 */
export const updateOrder = onCall(callableOptions(), async (req) => {
  const actor = requirePermission(req, "orders.write");
  const input = parse(updateOrderSchema, req.data);
  await db().runTransaction(async (tx) => {
    const { orders, shipments } = await loadOrdersWithShipments(tx, [input.orderId]);
    const finSnap = await tx.get(db().doc(`orderFinance/${input.orderId}`));
    const order = orders.get(input.orderId)!;
    if (order.status === "cancelled") fail("failed-precondition", "Une commande annulée ne peut plus être modifiée.");
    const allocated = allocatedByLine([...shipments.values()]);
    const existing = new Map(order.items.map((i) => [i.lineId, i]));
    const used = new Set(order.items.map((i) => i.lineId));
    const kept = new Set<string>();
    const items: OrderItem[] = input.items.map((i) => {
      const prev = i.lineId ? existing.get(i.lineId) : undefined;
      if (i.lineId && !prev) fail("invalid-argument", `Ligne ${i.lineId} inconnue.`);
      if (prev) {
        kept.add(prev.lineId);
        const floor = Math.max(prev.quantityReceived, allocated.get(lineKey(order.orderId, prev.lineId)) ?? 0);
        if (i.quantityOrdered < floor) {
          fail("failed-precondition", `« ${i.description} » : la quantité commandée ne peut pas être inférieure à ${floor} (déjà reçue ou emballée).`);
        }
        return { ...prev, description: i.description, merchantRef: i.merchantRef, quantityOrdered: i.quantityOrdered, declaredUnitValue: i.declaredUnitValue };
      }
      return {
        lineId: nextLineId(used),
        description: i.description,
        merchantRef: i.merchantRef,
        quantityOrdered: i.quantityOrdered,
        quantityReceived: 0,
        declaredUnitValue: i.declaredUnitValue,
      };
    });
    for (const prev of order.items) {
      if (kept.has(prev.lineId)) continue;
      if (prev.quantityReceived > 0 || (allocated.get(lineKey(order.orderId, prev.lineId)) ?? 0) > 0) {
        fail("failed-precondition", `« ${prev.description} » a déjà été reçu ou emballé et ne peut pas être supprimé.`);
      }
    }
    const fin = finSnap.data() as OrderFinanceDoc | undefined;
    if (input.currency !== order.currency && fin && (fin.charges.length > 0 || fin.totalPaid > 0)) {
      fail("failed-precondition", "La devise ne peut plus être changée : des frais ou paiements existent déjà.");
    }
    const next: OrderData = {
      ...order,
      merchant: input.merchant,
      merchantOrderRef: input.merchantOrderRef,
      orderDate: input.orderDate,
      currency: input.currency,
      transportMode: input.transportMode,
      publicNote: input.publicNote,
      items,
    };
    const derived = deriveOrder(next, shipments.values());
    tx.update(db().doc(`orders/${order.orderId}`), { ...next, ...derived, updatedAt: FieldValue.serverTimestamp() });
    tx.set(db().doc(`orderPrivate/${order.orderId}`), { orderId: order.orderId, internalNotes: input.internalNotes ?? "", updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid });
    if (fin && input.currency !== order.currency) tx.update(finSnap.ref, { currency: input.currency, updatedAt: FieldValue.serverTimestamp() });
    audit(tx, actor, "order.update", "order", order.orderId, `Commande ${order.orderId} modifiée`, {
      itemsBefore: order.items.length,
      itemsAfter: items.length,
      orderedBefore: order.stats.ordered,
      orderedAfter: derived.stats.ordered,
    });
  });
  return { ok: true };
});

const RECEIPT_AUTOSTATUS: readonly StatusCode[] = ["registered", "awaiting_receipt", "partially_received", "received", "info_required", "delayed"];

/**
 * Saisie explicite des quantités reçues à l'entrepôt (valeur absolue par ligne).
 * Le statut de la commande passe à « Partiellement reçu » ou « Reçu à l'entrepôt » uniquement
 * à partir de ces quantités réelles, et seulement si la commande n'est pas déjà plus avancée.
 */
export const recordReceipt = onCall(callableOptions(), async (req) => {
  const actor = requirePermission(req, "orders.write");
  const input = parse(recordReceiptSchema, req.data);
  const notifications: PendingNotification[] = [];
  await db().runTransaction(async (tx) => {
    const { orders, shipments } = await loadOrdersWithShipments(tx, [input.orderId]);
    const order = orders.get(input.orderId)!;
    if (order.status === "cancelled") fail("failed-precondition", "Commande annulée.");
    const allocated = allocatedByLine([...shipments.values()]);
    const updates = new Map(input.lines.map((l) => [l.lineId, l.quantityReceived]));
    let delta = 0;
    const items = order.items.map((item) => {
      if (!updates.has(item.lineId)) return item;
      const q = updates.get(item.lineId)!;
      if (q > item.quantityOrdered) fail("invalid-argument", `« ${item.description} » : ${q} reçu(s) pour ${item.quantityOrdered} commandé(s).`);
      const packed = allocated.get(lineKey(order.orderId, item.lineId)) ?? 0;
      if (q < packed) fail("failed-precondition", `« ${item.description} » : ${packed} article(s) sont déjà emballés.`);
      delta += q - item.quantityReceived;
      updates.delete(item.lineId);
      return { ...item, quantityReceived: q };
    });
    if (updates.size > 0) fail("invalid-argument", "Ligne d'article inconnue.");
    const next: OrderData = { ...order, items };
    const derived = deriveOrder(next, shipments.values());
    let status = order.status;
    if (RECEIPT_AUTOSTATUS.includes(order.status) && derived.stats.received > 0) {
      status = derived.stats.received >= derived.stats.ordered ? "received" : "partially_received";
    }
    tx.update(db().doc(`orders/${order.orderId}`), { items, ...derived, status, updatedAt: FieldValue.serverTimestamp() });
    const summary = `${derived.stats.received} article(s) reçu(s) sur ${derived.stats.ordered}.`;
    writeEvent(tx, actor, {
      kind: status !== order.status ? "status" : "receipt",
      targetType: "order",
      orderId: order.orderId,
      clientUid: order.clientUid,
      fromStatus: order.status,
      toStatus: status,
      publicNote: input.publicNote ? `${summary} ${input.publicNote}` : summary,
    });
    audit(tx, actor, "order.receipt", "order", order.orderId, `Réception enregistrée (${order.orderId}) : ${summary}`, { delta });
    if (delta > 0) {
      notifications.push({
        recipientUid: order.clientUid,
        type: "shipment_received",
        title: `Articles reçus — ${order.orderId}`,
        body: `SHENA Express a reçu des articles de votre commande ${order.orderId} : ${summary}`,
        orderId: order.orderId,
        discriminator: `received-${derived.stats.received}`,
      });
    }
  });
  await dispatchNotifications(notifications);
  return { ok: true };
});
