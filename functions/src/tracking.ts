import { onCall } from "firebase-functions/v2/https";
import {
  updateStatusSchema,
  STATUS_DEFINITIONS,
  statusLabel,
  notificationTypeForStatus,
  todayIso,
  type StatusCode,
} from "../../shared/index.js";
import { db, parse, audit, FieldValue, fail, requirePermission, loadSettings } from "./lib/core.js";
import { loadOrdersWithShipments, deriveOrder, type OrderData, type ShipmentData } from "./lib/logistics.js";
import { writeEvent } from "./lib/events.js";
import { dispatchNotifications, type PendingNotification } from "./lib/notify.js";
import { callableOptions } from "./lib/options.js";

/**
 * Mise à jour du statut d'un colis ou d'une commande.
 * - Enregistre systématiquement : ancien statut, nouveau statut, date/heure, auteur, note publique.
 * - Sépare la note interne dans `shipmentEventsPrivate`.
 * - Met à jour les dates effectives pertinentes (ex. réception, expédition, disponibilité, livraison) si non renseignées.
 * - Déclenche les notifications configurées.
 */
export const updateStatus = onCall(callableOptions(), async (req) => {
  const input = parse(updateStatusSchema, req.data);
  const perm = input.targetType === "shipment" ? "shipments.write" : "orders.write";
  const actor = requirePermission(req, perm);
  const notifications: PendingNotification[] = [];
  const { pub, priv } = await loadSettings();

  if (pub.disabledStatuses?.includes(input.status)) {
    fail("failed-precondition", "Ce statut est désactivé dans les paramètres de l'entreprise.");
  }

  const today = todayIso();

  await db().runTransaction(async (tx) => {
    if (input.targetType === "shipment") {
      const ref = db().doc(`shipments/${input.targetId}`);
      const snap = await tx.get(ref);
      if (!snap.exists) fail("not-found", "Colis introuvable.");
      const sh = snap.data() as ShipmentData;
      const fromStatus = sh.status;
      if (fromStatus === input.status && !input.publicNote && !input.internalNote) {
        return;
      }

      const { orders, shipments } = await loadOrdersWithShipments(tx, sh.orderIds);
      const step = STATUS_DEFINITIONS[input.status].step;
      const lastStep = step !== null ? step : sh.lastStep ?? 0;
      const dates = { ...(sh.dates ?? {}) };
      if (input.status === "received" && !dates.warehouseReceivedAt) dates.warehouseReceivedAt = today;
      if (input.status === "shipped" && !dates.shippedAt) dates.shippedAt = today;
      if (input.status === "available" && !dates.availableAt) dates.availableAt = today;
      if (input.status === "delivered" && !dates.deliveredAt) dates.deliveredAt = today;

      const timestampField = ({ registered: "orderConfirmedAt", received: "miamiReceivedAt", in_transit: "inTransitAt", shipped: "inTransitAt",
        arrived_dr: "arrivedDominicanAt", bus_to_haiti: "busToHaitiAt", available: "readyForDeliveryAt", delivered: "deliveredAt" } as const)[input.status as "registered" | "received" | "in_transit" | "shipped" | "arrived_dr" | "bus_to_haiti" | "available" | "delivered"];
      const stageDates = timestampField && !sh[timestampField] ? { [timestampField]: new Date().toISOString() } : {};
      const updated: ShipmentData = {
        ...sh,
        ...stageDates,
        status: input.status,
        lastStep,
        dates,
      };
      const now = FieldValue.serverTimestamp();
      tx.update(ref, { status: input.status, lastStep, dates, ...stageDates, updatedAt: now });
      shipments.set(sh.shipmentId, updated);

      for (const o of orders.values()) {
        const derived = deriveOrder(o, shipments.values());
        // Synchronise le statut général de la commande lorsque tous ses articles sont livrés / disponibles / en transit.
        let orderStatus: StatusCode = o.status;
        if (o.status !== "cancelled") {
          const active = [...shipments.values()].filter((s) => s.orderIds.includes(o.orderId) && s.status !== "cancelled");
          if (derived.stats.delivered >= derived.stats.ordered && derived.stats.ordered > 0) {
            orderStatus = "delivered";
          } else if (active.length > 0 && active.every((s) => s.status === "available" || s.status === "out_for_delivery" || s.status === "delivered")) {
            orderStatus = "available";
          } else if (active.length === 1) {
            orderStatus = input.status;
          } else if (active.some((s) => s.status === "bus_to_haiti")) {
            orderStatus = "bus_to_haiti";
          } else if (active.some((s) => s.status === "arrived_dr")) {
            orderStatus = "arrived_dr";
          } else if (active.some((s) => s.status === "arrived_haiti" || s.status === "customs")) {
            orderStatus = "arrived_haiti";
          } else if (active.some((s) => s.status === "in_transit" || s.status === "shipped")) {
            orderStatus = "in_transit";
          }
        }
        tx.update(db().doc(`orders/${o.orderId}`), { ...derived, status: orderStatus, updatedAt: now });
      }

      writeEvent(tx, actor, {
        kind: "status",
        targetType: "shipment",
        shipmentId: sh.shipmentId,
        orderId: sh.orderIds[0] ?? null,
        clientUid: sh.clientUid,
        fromStatus,
        toStatus: input.status,
        publicNote: input.publicNote,
        internalNote: input.internalNote,
      });

      const label = statusLabel(input.status, pub.statusLabels);
      audit(
        tx,
        actor,
        "shipment.status",
        "shipment",
        sh.shipmentId,
        `Colis ${sh.trackingNumber} : ${statusLabel(fromStatus, pub.statusLabels)} -> ${label}`,
        { fromStatus, toStatus: input.status },
      );

      if (fromStatus !== input.status) {
        notifications.push({
          recipientUid: sh.clientUid,
          type: notificationTypeForStatus(input.status),
          title: `Colis ${sh.trackingNumber} — ${label}`,
          body: input.publicNote ? `${label}. ${input.publicNote}` : `Le statut de votre colis ${sh.trackingNumber} est désormais : ${label}.`,
          shipmentId: sh.shipmentId,
          orderId: sh.orderIds[0] ?? null,
          discriminator: `${input.status}-${Date.now()}`,
        });
      }
    } else {
      const ref = db().doc(`orders/${input.targetId}`);
      const snap = await tx.get(ref);
      if (!snap.exists) fail("not-found", "Commande introuvable.");
      const order = snap.data() as OrderData;
      const fromStatus = order.status;
      if (fromStatus === input.status && !input.publicNote && !input.internalNote) return;

      tx.update(ref, {
        status: input.status,
        ...(input.publicNote ? { publicNote: input.publicNote } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
      writeEvent(tx, actor, {
        kind: "status",
        targetType: "order",
        orderId: order.orderId,
        clientUid: order.clientUid,
        fromStatus,
        toStatus: input.status,
        publicNote: input.publicNote,
        internalNote: input.internalNote,
      });
      const label = statusLabel(input.status, pub.statusLabels);
      audit(tx, actor, "order.status", "order", order.orderId, `Commande ${order.orderId} : ${statusLabel(fromStatus, pub.statusLabels)} -> ${label}`, {
        fromStatus,
        toStatus: input.status,
      });
      if (fromStatus !== input.status) {
        notifications.push({
          recipientUid: order.clientUid,
          type: notificationTypeForStatus(input.status),
          title: `Commande ${order.orderId} — ${label}`,
          body: input.publicNote ? `${label}. ${input.publicNote}` : `Le statut de votre commande ${order.orderId} est désormais : ${label}.`,
          orderId: order.orderId,
          discriminator: `${input.status}-${Date.now()}`,
        });
      }
    }
  });

  await dispatchNotifications(notifications, priv);
  return { ok: true };
});
