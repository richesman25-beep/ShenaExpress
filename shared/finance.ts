import type { ChargeLine, Currency, PaymentStatus } from "./types.js";

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

export const PAYMENT_METHOD_LABELS = {
  cash: "Espèces",
  transfer: "Virement",
  moncash: "MonCash",
  natcash: "NatCash",
  card: "Carte (terminal)",
  other: "Autre",
} as const;

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
