import type { OrderItem, OrderStats, ShipmentDoc, ShipmentLine } from "./types.js";
import {
  ARRIVED_STATUSES,
  AVAILABLE_STATUSES,
  SHIPPED_STATUSES,
  TRANSIT_STATUSES,
  type StatusCode,
} from "./statuses.js";

type ShipmentLike = Pick<ShipmentDoc, "shipmentId" | "status" | "lines">;

const lineKey = (orderId: string, lineId: string) => `${orderId}::${lineId}`;

/**
 * Statistiques d'une commande.
 * - ordered : somme des quantités commandées
 * - received : somme des quantités explicitement reçues (jamais déduite de l'enregistrement)
 * - packed / shipped / delivered : calculés à partir des lignes de colis (chaque ligne de
 *   commande n'est comptée qu'une fois par colis, et les colis annulés sont exclus).
 */
export function computeOrderStats(orderId: string, items: OrderItem[], shipments: ShipmentLike[]): OrderStats {
  const ordered = items.reduce((s, i) => s + i.quantityOrdered, 0);
  const received = items.reduce((s, i) => s + Math.min(i.quantityReceived, i.quantityOrdered), 0);
  const validLines = new Set(items.map((i) => i.lineId));
  let packed = 0;
  let shipped = 0;
  let delivered = 0;
  let shipmentCount = 0;
  for (const sh of shipments) {
    if (sh.status === "cancelled") continue;
    const own = sh.lines.filter((l) => l.orderId === orderId && validLines.has(l.lineId));
    if (own.length === 0) continue;
    shipmentCount += 1;
    const qty = own.reduce((s, l) => s + l.quantity, 0);
    packed += qty;
    if (SHIPPED_STATUSES.includes(sh.status)) shipped += qty;
    if (sh.status === "delivered") delivered += qty;
  }
  return { ordered, received, packed, shipped, delivered, shipmentCount };
}

export interface AllocationIssue {
  orderId: string;
  lineId: string;
  message: string;
}

/**
 * Vérifie qu'une nouvelle répartition de lignes dans un colis ne dépasse pas les quantités
 * reçues, en tenant compte des autres colis non annulés (évite le double comptage).
 */
export function validateAllocation(params: {
  newLines: ShipmentLine[];
  /** Commandes concernées : orderId -> lignes. */
  orders: Record<string, OrderItem[]>;
  /** Autres colis existants (le colis en cours d'édition doit être exclu). */
  otherShipments: ShipmentLike[];
}): AllocationIssue[] {
  const issues: AllocationIssue[] = [];
  const already = new Map<string, number>();
  for (const sh of params.otherShipments) {
    if (sh.status === "cancelled") continue;
    for (const l of sh.lines) already.set(lineKey(l.orderId, l.lineId), (already.get(lineKey(l.orderId, l.lineId)) ?? 0) + l.quantity);
  }
  const requested = new Map<string, number>();
  for (const l of params.newLines) {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) {
      issues.push({ orderId: l.orderId, lineId: l.lineId, message: "La quantité doit être un entier positif." });
      continue;
    }
    const k = lineKey(l.orderId, l.lineId);
    requested.set(k, (requested.get(k) ?? 0) + l.quantity);
  }
  for (const [k, qty] of requested) {
    const [orderId, lineId] = k.split("::") as [string, string];
    const item = params.orders[orderId]?.find((i) => i.lineId === lineId);
    if (!item) {
      issues.push({ orderId, lineId, message: "Article introuvable dans la commande." });
      continue;
    }
    const available = item.quantityReceived - (already.get(k) ?? 0);
    if (qty > available) {
      issues.push({
        orderId,
        lineId,
        message: `« ${item.description} » : ${qty} demandé(s) mais seulement ${Math.max(available, 0)} reçu(s) et non encore emballé(s).`,
      });
    }
  }
  return issues;
}

/** Quantité déjà placée en colis pour chaque ligne (colis annulés exclus). */
export function allocatedByLine(shipments: ShipmentLike[], excludeShipmentId?: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const sh of shipments) {
    if (sh.status === "cancelled" || sh.shipmentId === excludeShipmentId) continue;
    for (const l of sh.lines) m.set(lineKey(l.orderId, l.lineId), (m.get(lineKey(l.orderId, l.lineId)) ?? 0) + l.quantity);
  }
  return m;
}
export { lineKey };

export type ShipmentBucket = "pending" | "transit" | "arrived" | "available" | "delivered" | "other";

/** Catégorie d'affichage d'un colis (chaque colis est compté une seule fois). */
export function shipmentBucket(status: StatusCode): ShipmentBucket {
  if (status === "delivered") return "delivered";
  if (AVAILABLE_STATUSES.includes(status)) return "available";
  if (ARRIVED_STATUSES.includes(status)) return "arrived";
  if (TRANSIT_STATUSES.includes(status)) return "transit";
  if (["registered", "awaiting_receipt", "partially_received", "received", "preparing"].includes(status)) return "pending";
  return "other";
}

export function countShipmentsByBucket(shipments: Pick<ShipmentDoc, "status">[]): Record<ShipmentBucket, number> {
  const out: Record<ShipmentBucket, number> = { pending: 0, transit: 0, arrived: 0, available: 0, delivered: 0, other: 0 };
  for (const s of shipments) out[shipmentBucket(s.status)] += 1;
  return out;
}

/** Totaux d'articles sur un ensemble de commandes. */
export function sumOrderStats(stats: OrderStats[]): OrderStats {
  return stats.reduce<OrderStats>(
    (acc, s) => ({
      ordered: acc.ordered + s.ordered,
      received: acc.received + s.received,
      packed: acc.packed + s.packed,
      shipped: acc.shipped + s.shipped,
      delivered: acc.delivered + s.delivered,
      shipmentCount: acc.shipmentCount + s.shipmentCount,
    }),
    { ordered: 0, received: 0, packed: 0, shipped: 0, delivered: 0, shipmentCount: 0 },
  );
}
