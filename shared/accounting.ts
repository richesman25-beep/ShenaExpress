import { z } from "zod";
export const ACCOUNTING_CATEGORIES = [
  "shipping",
  "local_transport",
  "internet",
  "supplies",
  "payment_fees",
  "bank_fees",
  "marketing",
  "other",
] as const;
const cents = z.number().int().positive().max(1_000_000_000);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Date invalide.",
  );
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const accountingCommandSchema = z.object({
  requestId: id,
  kind: z.enum([
    "invoice",
    "confirm_cost",
    "payment",
    "refund",
    "void",
    "expense",
    "supplier_payment",
    "expense_payment",
    "savings",
    "rates",
    "goal",
  ]),
  targetId: id.optional(),
  orderId: id.optional(),
  amount: cents.optional(),
  currency: z.enum(["USD", "HTG"]).default("USD"),
  rateMicros: cents.optional(),
  rateDate: date.optional(),
  date,
  method: z
    .enum(["cash", "natcash", "moncash", "transfer", "other"])
    .default("cash"),
  reference: z.string().trim().max(200).default(""),
  description: z.string().trim().max(1000).default(""),
  category: z.enum(ACCOUNTING_CATEGORIES).default("other"),
  paid: z.boolean().default(true),
  clientRateCents: cents.optional(),
  carrierRateCents: cents.optional(),
  metric: z.enum(["revenue", "gross", "net", "savings"]).optional(),
  dailyTargetCents: cents.optional(),
  end: date.optional(),
});
export type AccountingCommand = z.input<typeof accountingCommandSchema>;
export interface BookInvoice {
  id: string;
  orderId: string;
  shipmentId: string;
  clientId: string;
  date: string;
  weightMilli: number;
  clientRateCents: number;
  carrierRateCents: number;
  revenue: number;
  cost: number;
  paid: number;
  supplierPaid: number;
  costConfirmed?: boolean;
  costConfirmedOn?: string;
  estimatedCost?: number;
}
export interface BookEntry {
  id: string;
  kind: string;
  date: string;
  usd: number;
  amount: number;
  currency: string;
  rateMicros: number;
  rateDate: string;
  targetId: string;
  orderId: string;
  description: string;
  reference: string;
  category: string;
  method: string;
  recordedBy: string;
  paid: boolean;
  costAdjustment?: number;
}
/** Entiers et division BigInt, arrondi positif au centime : demi supérieur. */
export function divideRounded(n: bigint, d: bigint) {
  if (d <= 0n || n < 0n) throw Error("Montant ou taux invalide.");
  const v = Number((n + d / 2n) / d);
  if (!Number.isSafeInteger(v)) throw Error("Montant trop important.");
  return v;
}
export function shippingAmount(weightMilli: number, rateCents: number) {
  if (
    !Number.isSafeInteger(weightMilli) ||
    weightMilli <= 0 ||
    !Number.isSafeInteger(rateCents) ||
    rateCents <= 0
  )
    throw Error("Poids ou tarif invalide.");
  return divideRounded(BigInt(weightMilli) * BigInt(rateCents), 1000n);
}
/** Taux = nombre de HTG pour 1 USD × 1 000 000 ; montant original en centimes. */
export function toUsd(amount: number, currency: string, rateMicros?: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw Error("Montant invalide.");
  if (currency === "USD") return amount;
  if (
    currency !== "HTG" ||
    !Number.isSafeInteger(rateMicros) ||
    !rateMicros ||
    rateMicros <= 0
  )
    throw Error("Indiquez le taux HTG/USD historique.");
  return divideRounded(BigInt(amount) * 1000000n, BigInt(rateMicros));
}
export function bookTotals(
  invoices: BookInvoice[],
  entries: BookEntry[],
  start: string,
  end: string,
) {
  const within = (v: { date: string }) => v.date >= start && v.date <= end;
  const inv = invoices.filter(within),
    ops = entries.filter(within);
  const revenue = inv.reduce((s, v) => s + v.revenue, 0),
    cost =
      inv.reduce((s, v) => s + (v.estimatedCost ?? v.cost), 0) +
      ops
        .filter((e) => e.kind === "confirm_cost")
        .reduce((s, e) => s + (e.costAdjustment ?? 0), 0);
  const cash = ops
    .filter((e) => ["payment", "refund", "void"].includes(e.kind))
    .reduce((s, v) => s + v.usd, 0);
  const expenses = ops
    .filter((e) => e.kind === "expense")
    .reduce((s, v) => s + v.usd, 0);
  const receivables = invoices
    .filter((i) => i.date <= end)
    .reduce(
      (s, i) =>
        s +
        i.revenue -
        entries
          .filter(
            (e) =>
              e.targetId === i.id &&
              e.date <= end &&
              ["payment", "refund", "void"].includes(e.kind),
          )
          .reduce((a, e) => a + e.usd, 0),
      0,
    );
  const suppliers =
    invoices
      .filter(
        (i) =>
          i.date <= end &&
          i.costConfirmed &&
          (!i.costConfirmedOn || i.costConfirmedOn <= end),
      )
      .reduce(
        (s, i) =>
          s +
          i.cost -
          entries
            .filter(
              (e) =>
                e.targetId === i.id &&
                e.date <= end &&
                e.kind === "supplier_payment",
            )
            .reduce((a, e) => a + e.usd, 0),
        0,
      ) +
    entries
      .filter((e) => e.date <= end && e.kind === "expense" && !e.paid)
      .reduce(
        (s, e) =>
          s +
          e.usd -
          entries
            .filter(
              (v) =>
                v.targetId === e.id &&
                v.kind === "expense_payment" &&
                v.date <= end,
            )
            .reduce((a, v) => a + v.usd, 0),
        0,
      );
  return {
    receipts: ops
      .filter((e) => e.kind === "payment" || e.kind === "void")
      .reduce((s, e) => s + e.usd, 0),
    refunds: Math.abs(
      ops.filter((e) => e.kind === "refund").reduce((s, e) => s + e.usd, 0),
    ),
    transportCash: ops
      .filter((e) => e.kind === "supplier_payment")
      .reduce((s, e) => s + e.usd, 0),
    estimatedCost: inv
      .filter(
        (i) =>
          !i.costConfirmed || (!!i.costConfirmedOn && i.costConfirmedOn > end),
      )
      .reduce((s, i) => s + (i.estimatedCost ?? i.cost), 0),
    committedCost: inv
      .filter(
        (i) =>
          i.costConfirmed && (!i.costConfirmedOn || i.costConfirmedOn <= end),
      )
      .reduce((s, i) => s + i.cost, 0),
    revenue,
    cash,
    receivables,
    cost,
    expenses,
    gross: revenue - cost,
    net: revenue - cost - expenses,
    suppliers,
    count: inv.length,
    weightMilli: inv.reduce((s, i) => s + i.weightMilli, 0),
    savings: ops
      .filter((e) => e.kind === "savings")
      .reduce((s, e) => s + e.usd, 0),
    expenseCash: ops
      .filter(
        (e) => (e.kind === "expense" && e.paid) || e.kind === "expense_payment",
      )
      .reduce((s, e) => s + e.usd, 0),
  };
}
