import type { createOrderSchema } from "./schemas.js";
import type { ClientDoc, OrderDoc, OrderItem, ShipmentDoc, ShipmentLine } from "./types.js";
import { buildSearchTokens } from "./ids.js";
import { computeOrderStats } from "./counting.js";
import type { StatusCode } from "./statuses.js";
import { progressStep } from "./statuses.js";

type NewShipment = Omit<ShipmentDoc, "createdAt" | "updatedAt">;

/** Même contenu métier pour l'API directe et la Cloud Function, sans accès Firebase. */
export function buildOrderCreation(
  input: ReturnType<typeof createOrderSchema.parse>,
  client: ClientDoc,
  orderId: string,
  shipmentId: string | null,
  nowIso: string,
): { order: Omit<OrderDoc, "createdAt" | "updatedAt">; shipment: NewShipment | null } {
  const rawItems =
    input.items.length > 0
      ? input.items
      : [
          {
            lineId: "L1",
            description: input.description ?? `Colis ${input.trackingNumber ?? orderId}`,
            merchantRef: input.merchantOrderRef ?? null,
            quantityOrdered: 1,
            declaredUnitValue: null,
          },
        ];

  const initialStatus: StatusCode = input.initialStatus ?? "registered";
  const items: OrderItem[] = rawItems.map((it, idx) => ({
    lineId: it.lineId ?? `L${idx + 1}`,
    description: it.description,
    merchantRef: it.merchantRef ?? null,
    quantityOrdered: it.quantityOrdered,
    quantityReceived: input.trackingNumber && !["registered", "awaiting_receipt", "preparing"].includes(initialStatus) ? it.quantityOrdered : 0,
    declaredUnitValue: it.declaredUnitValue ?? null,
  }));

  let shipment: NewShipment | null = null;
  if (input.trackingNumber && shipmentId) {
    const lines: ShipmentLine[] = items.map((it) => ({
      orderId,
      lineId: it.lineId,
      description: it.description,
      quantity: it.quantityOrdered,
    }));
    shipment = {
      shipmentId,
      trackingNumber: input.trackingNumber,
      clientId: client.clientId,
      clientUid: client.clientUid,
      orderIds: [orderId],
      lines,
      itemCount: lines.reduce((s, l) => s + l.quantity, 0),
      weightKg: null,
      actualWeightLb: null,
      ratePerLbCents: null,
      shippingFeeCents: null,
      shippingCurrency: "USD",
      shippingPaymentStatus: null,
      paidAmountCents: 0,
      miamiReceivedAt: initialStatus === "received" ? nowIso : null,
      weighedAt: null,
      weighedByUid: null,
      weightHistory: [],
      orderConfirmedAt: nowIso,
      preparingAt: initialStatus === "preparing" ? nowIso : null,
      inTransitAt: null,
      arrivedHaitiAt: null,
      readyForDeliveryAt: null,
      deliveredAt: null,
      dimensionsCm: null,
      transportMode: input.transportMode ?? "air",
      status: initialStatus,
      lastStep: progressStep(initialStatus) ?? 1,
      dates: {
        warehouseReceivedAt: initialStatus === "received" ? nowIso : null,
        estimatedDeparture: null,
        shippedAt: null,
        estimatedArrival: null,
        deliveryWindowStart: null,
        deliveryWindowEnd: null,
        availableAt: null,
        deliveredAt: null,
      },
      dateChangeMessage: null,
      pickupInstructions: input.publicNote ?? null,
    };
  }
  const stats = computeOrderStats(orderId, items, shipment ? [shipment] : []);
  return {
    shipment,
    order: {
      orderId,
      clientId: client.clientId,
      clientUid: client.clientUid,
      clientName: client.fullName,
      merchant: input.merchant,
      merchantOrderRef: input.merchantOrderRef,
      orderDate: input.orderDate,
      items,
      currency: input.currency,
      status: initialStatus,
      transportMode: input.transportMode ?? (input.trackingNumber ? "air" : null),
      stats,
      shipmentIds: shipmentId ? [shipmentId] : [],
      searchTokens: buildSearchTokens(
        orderId,
        client.clientId,
        client.fullName,
        input.trackingNumber,
        input.merchant,
        input.merchantOrderRef,
        ...items.map((i) => i.description),
      ),
      publicNote: input.publicNote,
    },
  };
}
