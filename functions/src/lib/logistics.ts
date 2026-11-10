import type { Transaction } from "firebase-admin/firestore";
import {
  computeOrderStats,
  buildSearchTokens,
  type OrderDoc,
  type ShipmentDoc,
} from "../../../shared/index.js";
import { db, fail } from "./core.js";

export type OrderData = Omit<OrderDoc, "createdAt" | "updatedAt">;
export type ShipmentData = Omit<ShipmentDoc, "createdAt" | "updatedAt">;

/** Lit (dans la transaction) les commandes et TOUS les colis qui les référencent. */
export async function loadOrdersWithShipments(tx: Transaction, orderIds: string[]) {
  const unique = [...new Set(orderIds)];
  const orders = new Map<string, OrderData>();
  const refs = unique.map((id) => db().doc(`orders/${id}`));
  const snaps = refs.length ? await tx.getAll(...refs) : [];
  for (const s of snaps) {
    if (!s.exists) fail("not-found", `Commande ${s.id} introuvable.`);
    orders.set(s.id, s.data() as OrderData);
  }
  const shipments = new Map<string, ShipmentData>();
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    const q = await tx.get(db().collection("shipments").where("orderIds", "array-contains-any", chunk));
    for (const d of q.docs) shipments.set(d.id, d.data() as ShipmentData);
  }
  return { orders, shipments };
}

export function orderSearchTokens(order: Pick<OrderData, "orderId" | "clientId" | "clientName" | "merchant" | "merchantOrderRef">, trackingNumbers: string[]) {
  return buildSearchTokens(order.orderId, order.clientId, order.clientName, order.merchant, order.merchantOrderRef, ...trackingNumbers);
}

/** Recalcule les champs dérivés d'une commande à partir de l'état final des colis. */
export function deriveOrder(order: OrderData, allShipments: Iterable<ShipmentData>) {
  const related = [...allShipments].filter((s) => s.orderIds.includes(order.orderId));
  const stats = computeOrderStats(order.orderId, order.items, related);
  const active = related.filter((s) => s.status !== "cancelled");
  return {
    stats,
    shipmentIds: related.map((s) => s.shipmentId).sort(),
    searchTokens: orderSearchTokens(order, active.map((s) => s.trackingNumber)),
  };
}
