import type { OrderDoc, ShipmentDoc } from "./types.js";
import { progressStep, type StatusCode } from "./statuses.js";
import { canViewWeightAndFee } from "./finance.js";

/** Lecture compatible : aucune écriture ni renumérotation des anciens colis. */
export function externalTracking(
  shipment: Pick<
    ShipmentDoc,
    "shipmentId" | "trackingNumber" | "externalTrackingNumber"
  >,
): string | null {
  return shipment.externalTrackingNumber !== undefined
    ? shipment.externalTrackingNumber
    : shipment.trackingNumber !== shipment.shipmentId
      ? shipment.trackingNumber
      : null;
}

export function orderShippingTotal(shipments: ShipmentDoc[]) {
  const active = shipments.filter((s) => s.status !== "cancelled");
  const confirmed = active.filter(canViewWeightAndFee);
  return {
    amountCents: confirmed.reduce((sum, s) => sum + s.shippingFeeCents!, 0),
    confirmedCount: confirmed.length,
    pendingCount: active.length - confirmed.length,
    provisional: confirmed.length !== active.length,
  };
}

/** Un contenant supplémentaire ne crée pas d’articles supplémentaires. */
export function buildEmptyOrderPackage(
  order: Pick<OrderDoc, "orderId" | "clientId" | "clientUid" | "transportMode">,
  id: string,
  tracking: string | null,
  now: string,
): Omit<ShipmentDoc, "createdAt" | "updatedAt"> {
  return {
    shipmentId: id,
    trackingNumber: id,
    externalTrackingNumber: tracking,
    packageSequence: Number(id.slice(8)),
    primaryOrderId: order.orderId,
    clientId: order.clientId,
    clientUid: order.clientUid,
    orderIds: [order.orderId],
    lines: [],
    itemCount: 0,
    transportMode: order.transportMode ?? "air",
    status: "registered",
    lastStep: 1,
    dates: {},
    actualWeightLb: null,
    ratePerLbCents: null,
    rateConfirmedAt: null,
    shippingFeeCents: null,
    shippingCurrency: "USD",
    shippingPaymentStatus: null,
    paidAmountCents: 0,
    miamiReceivedAt: null,
    weighedAt: null,
    weightHistory: [],
    orderConfirmedAt: now,
  };
}

/** L’étape globale suit le colis actif le moins avancé, jamais le premier affiché. */
export function orderPackageStatus(
  shipments: Pick<ShipmentDoc, "status" | "packageSequence" | "lastStep">[],
  fallback: StatusCode,
): StatusCode {
  if (
    fallback === "cancelled" ||
    !shipments.some((s) => s.packageSequence !== undefined)
  )
    return fallback;
  const active = shipments.filter((s) => s.status !== "cancelled");
  if (!active.length) return fallback;
  return [...active].sort(
    (a, b) =>
      (progressStep(a.status, a.lastStep) ?? 0) -
      (progressStep(b.status, b.lastStep) ?? 0),
  )[0].status;
}
