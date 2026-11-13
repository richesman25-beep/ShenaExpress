import type { ChargeLine, Currency, PaymentStatus, ShipmentDoc, ShippingPaymentStatus } from "./types.js";
import type { StatusCode } from "./statuses.js";

const MIAMI_RECEIVED_OR_LATER_STATUSES: readonly StatusCode[] = [
  "received",
  "partially_received",
  "shipped",
  "in_transit",
  "arrived_dr",
  "bus_to_haiti",
  "arrived_haiti",
  "customs",
  "available",
  "out_for_delivery",
  "delivered",
];

export function hasConfirmedMiamiReception(
  shipment: Pick<ShipmentDoc, "status" | "miamiReceivedAt">,
): boolean {
  if (shipment.status === "cancelled") return false;
  if (shipment.miamiReceivedAt) return true;
  return MIAMI_RECEIVED_OR_LATER_STATUSES.includes(shipment.status);
}

export function canViewWeightAndFee(
  shipment: Pick<ShipmentDoc, "status" | "miamiReceivedAt" | "actualWeightLb" | "shippingFeeCents" | "weighedAt">,
): boolean {
  if (!hasConfirmedMiamiReception(shipment)) return false;
  return (
    typeof shipment.actualWeightLb === "number" &&
    shipment.actualWeightLb > 0 &&
    typeof shipment.shippingFeeCents === "number" &&
    shipment.shippingFeeCents > 0 &&
    Boolean(shipment.weighedAt)
  );
}

export type FeeVisibilityState = "hidden" | "awaiting_weighing" | "ready";

export function getShipmentFeeVisibility(
  shipment: Pick<ShipmentDoc, "status" | "miamiReceivedAt" | "actualWeightLb" | "shippingFeeCents" | "weighedAt">,
): FeeVisibilityState {
  if (!hasConfirmedMiamiReception(shipment)) return "hidden";
  if (canViewWeightAndFee(shipment)) return "ready";
  return "awaiting_weighing";
}

/** Tous les montants sont des entiers en unités mineures (centimes) pour éviter les erreurs d'arrondi. */
export function totalDue(charges: ChargeLine[]): number {
  return charges.reduce((sum, c) => (c.kind === "discount" ? sum - c.amount : sum + c.amount), 0);
}

export function totalPaid(payments: { amount: number; currency: Currency; voided?: boolean }[], currency: Currency): number {
  let sum = 0;
  for (const p of payments) {
    if (p.voided) continue;
    if (p.currency !== currency) {
      // Pas de conversion automatique USD/HTG : un paiement dans une autre devise est une erreur de données.
      throw new Error(`Devise incohérente : paiement en ${p.currency} pour une commande en ${currency}.`);
    }
    sum += p.amount;
  }
  return sum;
}

export function balance(due: number, paid: number): number {
  return due - paid;
}

export function paymentStatus(due: number, paid: number): PaymentStatus {
  if (due <= 0 && paid <= 0) return "none";
  if (paid <= 0) return "unpaid";
  if (paid < due) return "partial";
  if (paid === due) return "paid";
  return "overpaid";
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  none: "Aucun frais",
  unpaid: "Non payé",
  partial: "Partiellement payé",
  paid: "Payé",
  overpaid: "Trop-perçu",
};

export const SHIPPING_PAYMENT_STATUS_LABELS: Record<ShippingPaymentStatus, string> = {
  unpaid: "À payer",
  pending_verification: "Paiement en attente de vérification",
  paid: "Payé",
  refunded: "Remboursé",
  adjustment_required: "Régularisation requise",
};

export const PAYMENT_METHOD_LABELS = {
  cash: "Espèces",
  transfer: "Virement",
  moncash: "MonCash",
  natcash: "NatCash",
  card: "Carte (terminal)",
  other: "Autre",
} as const;

export const COMMERCIAL_RATE_USD_PER_LB = 6;
export const COMMERCIAL_RATE_CENTS_PER_LB = 600;
export const MAX_PACKAGE_WEIGHT_LB = 10000;

/**
 * Valide un poids réel en livres (lb) : strictement positif, ≤ 10 000 lb,
 * au maximum 3 décimales (ex. 0.50, 1.25, 4.75). Retourne null si invalide.
 */
export function parseValidWeightLb(raw: unknown): number | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0 || raw > MAX_PACKAGE_WEIGHT_LB) return null;
    const thousandths = Math.round(raw * 1000);
    if (Math.abs(raw * 1000 - thousandths) > 1e-6) return null;
    return thousandths / 1000;
  }
  if (typeof raw === "string") {
    const s = raw.trim().replace(/\s/g, "").replace(",", ".");
    if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
    const val = Number(s);
    if (!Number.isFinite(val) || val <= 0 || val > MAX_PACKAGE_WEIGHT_LB) return null;
    return Math.round(val * 1000) / 1000;
  }
  return null;
}

/**
 * Calcule exactement les frais de livraison en centimes USD :
 * frais = poids réel (lb) × tarif par livre (centimes), sans jamais arrondir le poids à la livre supérieure.
 */
export function calculateShippingFeeCents(
  weightLb: number,
  ratePerLbCents = COMMERCIAL_RATE_CENTS_PER_LB,
): number {
  const validWeight = parseValidWeightLb(weightLb);
  if (validWeight === null) {
    throw new Error("Poids réel invalide : saisissez un nombre positif avec au maximum 3 décimales.");
  }
  if (!Number.isInteger(ratePerLbCents) || ratePerLbCents <= 0) {
    throw new Error("Tarif par livre invalide.");
  }
  const weightThousandths = Math.round(validWeight * 1000);
  return Math.round((weightThousandths * ratePerLbCents) / 1000);
}

export function formatWeightLb(weightLb: number, locale = "fr-FR"): string {
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(weightLb)} lb`;
}

/** Convertit une saisie « 12,50 » ou « 12.50 » en unités mineures (1250). Retourne null si invalide. */
export function parseMoney(input: string): number | null {
  const s = input.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [ent, dec = ""] = s.split(".");
  return Number(ent) * 100 + Number(dec.padEnd(2, "0"));
}

export function formatMoney(minor: number, currency: Currency, locale = "fr-FR"): string {
  const value = minor / 100;
  if (currency === "HTG") {
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} HTG`;
  }
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
}
