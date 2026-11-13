import { onCall } from "firebase-functions/v2/https";
import {
  createOrderSchema,
  updateOrderSchema,
  recordReceiptSchema,
  formatOrderId,
  allocatedByLine,
  lineKey,
  buildOrderCreation,
  formatShipmentId,
  todayIso,
  type ClientDoc,
  type OrderItem,
  type OrderFinanceDoc,
  type StatusCode,
} from "../../shared/index.js";
import { db, parse, audit, readCreationCounter, writeCreationCounter, readTrackingGuard, writeTrackingGuard, FieldValue, fail, requirePermission } from "./lib/core.js";
import { loadOrdersWithShipments, deriveOrder, type OrderData } from "./lib/logistics.js";
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
  const result = await db().runTransaction(async (tx) => {
    const guard = await readTrackingGuard(tx);
    const clientSnap = await tx.get(db().doc(`clients/${input.clientId}`));
    if (!clientSnap.exists) fail("not-found", "Client introuvable.");
    const client = clientSnap.data() as ClientDoc;
    if (client.status !== "active") fail("failed-precondition", "Le compte de ce client est désactivé.");
    if (client.clientId !== input.clientId || !client.clientUid) fail("failed-precondition", "L'association du client à son compte est invalide. Contactez l'administrateur.");
    const counter = await readCreationCounter(tx, "orders", year);
    const shipmentCounter = input.trackingNumber ? await readCreationCounter(tx, "shipments", year) : null;
    const id = formatOrderId(year, counter.next);
    const shipmentId = shipmentCounter ? formatShipmentId(year, shipmentCounter.next) : null;
    const paths = [`orders/${id}`, `orderPrivate/${id}`, `orderFinance/${id}`,
      ...(shipmentId ? [`shipments/${shipmentId}`, `shipmentPrivate/${shipmentId}`] : [])];
    const existing = await tx.getAll(...paths.map(path => db().doc(path)));
    if (existing.some(snap => snap.exists)) fail("already-exists", "Cet identifiant est déjà utilisé. Aucune donnée n'a été remplacée. Faites vérifier les compteurs par l'administrateur.");
    if (input.trackingNumber) {
      const reservation = await tx.get(db().doc(`trackingNumbers/${input.trackingNumber}`));
      if (reservation.exists) fail("already-exists", "Ce numéro de suivi est déjà utilisé par un autre colis.");
      const duplicates = await tx.get(db().collection("shipments").where("trackingNumber", "==", input.trackingNumber));
      if (!duplicates.empty) fail("already-exists", "Ce numéro de suivi est déjà utilisé par un autre colis.");
    }
    const { order, shipment } = buildOrderCreation(input, client, id, shipmentId, new Date().toISOString());
    // Toutes les lectures sont terminées ; les écritures suivantes sont atomiques.
    const now = FieldValue.serverTimestamp();
    writeCreationCounter(tx, counter);
    if (shipmentCounter) writeCreationCounter(tx, shipmentCounter);
    tx.create(db().doc(`orders/${id}`), { ...order, createdAt: now, updatedAt: now });
    tx.create(db().doc(`orderPrivate/${id}`), { orderId: id, internalNotes: input.internalNotes ?? "", updatedAt: now, updatedBy: actor.uid });
    const finance: Omit<OrderFinanceDoc, "updatedAt"> = {
      orderId: id, clientUid: client.clientUid, clientId: client.clientId,
      currency: input.currency, charges: [], totalDue: 0, totalPaid: 0, balance: 0, paymentStatus: "none",
    };
    tx.create(db().doc(`orderFinance/${id}`), { ...finance, updatedAt: now });
    if (shipment && shipmentId) {
      tx.create(db().doc(`shipments/${shipmentId}`), { ...shipment, searchTokens: [shipment.trackingNumber.toLowerCase(), shipmentId.toLowerCase()], createdAt: now, updatedAt: now });
      tx.create(db().doc(`shipmentPrivate/${shipmentId}`), { shipmentId, internalNotes: input.internalNotes ?? "", updatedAt: now, updatedBy: actor.uid });
      tx.set(db().doc(`trackingNumbers/${shipment.trackingNumber}`), { shipmentId, createdAt: now });
      writeEvent(tx, actor, {
        kind: "created", targetType: "shipment", orderId: id, shipmentId,
        clientUid: client.clientUid, toStatus: order.status,
        publicNote: input.publicNote ?? `Colis ${shipment.trackingNumber} enregistré.`,
      });
    }
    writeEvent(tx, actor, {
      kind: "created", targetType: "order", orderId: id, shipmentId,
      clientUid: client.clientUid, toStatus: order.status, publicNote: input.publicNote,
    });
    audit(tx, actor, "order.create", "order", id, `Commande ${id} créée pour ${client.clientId}`, { items: order.items.length });
    writeTrackingGuard(tx, guard);
    // Aucun effet externe dans le callback : Firestore peut le rejouer.
    return { orderId: id, clientUid: client.clientUid };
  });
  await dispatchNotifications([{
    recipientUid: result.clientUid, type: "order_created",
    title: `Commande ${result.orderId} enregistrée`,
    body: `Votre commande ${result.orderId} a été enregistrée par SHENA Express. Vous serez informé à chaque étape.`,
    orderId: result.orderId, discriminator: "created",
  }]);
  return { orderId: result.orderId };
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
