import { describe, it, expect } from "vitest";
import {
  shippingAmount,
  toUsd,
  bookTotals,
  accountingCommandSchema,
  type BookInvoice,
  type BookEntry,
} from "../../shared/accounting";
describe("Calculs comptables exacts", () => {
  it("poids millièmes, centimes et demi supérieur", () => {
    expect(shippingAmount(4750, 600)).toBe(2850);
    expect(shippingAmount(4750, 450)).toBe(2138);
    expect(() => shippingAmount(0, 600)).toThrow();
  });
  it("HTG au taux historique sans flottants monétaires", () => {
    expect(toUsd(130000, "HTG", 130000000)).toBe(1000);
    expect(toUsd(130000, "HTG", 100000000)).toBe(1300);
    expect(() => toUsd(100, "HTG")).toThrow();
  });
  it("facturation distincte du cash, remboursement et paiement fournisseur sans double coût", () => {
    const i = {
      id: "a",
      date: "2026-11-01",
      revenue: 6000,
      cost: 4500,
      paid: 2000,
      supplierPaid: 1000,
      costConfirmed: true,
      weightMilli: 10000,
    } as BookInvoice;
    const e = [
      { targetId: "a", kind: "payment", date: i.date, usd: 3000 },
      { targetId: "a", kind: "refund", date: i.date, usd: -1000 },
      { targetId: "a", kind: "supplier_payment", date: i.date, usd: 1000 },
    ] as BookEntry[];
    const t = bookTotals([i], e, i.date, i.date);
    expect(t).toMatchObject({
      revenue: 6000,
      cash: 2000,
      receivables: 4000,
      suppliers: 3500,
      cost: 4500,
      gross: 1500,
      net: 1500,
      savings: 0,
    });
  });
  it("valide les dates et refuse les montants non entiers", () => {
    expect(
      accountingCommandSchema.safeParse({
        kind: "payment",
        requestId: "a",
        date: "2026-02-30",
        amount: 1.5,
      }).success,
    ).toBe(false);
  });
});
it("garde une dette transporteur hors du passé avant sa confirmation", () => {
  const invoice = {
    id: "a",
    date: "2026-11-01",
    revenue: 6000,
    cost: 4600,
    estimatedCost: 4500,
    costConfirmed: true,
    costConfirmedOn: "2026-11-03",
    weightMilli: 10000,
  } as BookInvoice;
  const entries = [
    {
      kind: "confirm_cost",
      date: "2026-11-03",
      costAdjustment: 100,
      targetId: "a",
      usd: 4600,
    },
  ] as BookEntry[];
  expect(
    bookTotals([invoice], entries, "2026-11-01", "2026-11-02").refunds,
  ).toBe(0);
  expect(
    bookTotals([invoice], entries, "2026-11-01", "2026-11-02"),
  ).toMatchObject({
    cost: 4500,
    suppliers: 0,
    estimatedCost: 4500,
    committedCost: 0,
  });
  expect(
    bookTotals([invoice], entries, "2026-11-01", "2026-11-03"),
  ).toMatchObject({ cost: 4600, suppliers: 4600 });
});
