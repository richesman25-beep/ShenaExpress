import { describe, it, expect } from "vitest";
import {
  formatPackageId,
  SHIPMENT_ID_RE,
  externalTracking,
  orderShippingTotal,
  orderPackageStatus,
  buildEmptyOrderPackage,
  type ShipmentDoc,
  calculateShippingFeeCents,
} from "../../shared/index";
const parent = {
  orderId: "SHE-CMD-2026-00001",
  clientId: "SHE-CLIENT-001",
  clientUid: "client",
  transportMode: "air" as const,
};
const make = (n: number) =>
  buildEmptyOrderPackage(
    parent,
    formatPackageId(n),
    null,
    "2026-11-17T12:00:00Z",
  ) as ShipmentDoc;
describe("Colis globaux et prix confirmés", () => {
  it("formate une séquence indépendante de l’année et accepte les anciens identifiants", () => {
    expect(formatPackageId(1)).toBe("SHE-PKG-000001");
    expect(formatPackageId(1000000)).toBe("SHE-PKG-1000000");
    expect(SHIPMENT_ID_RE.test("SHE-COLIS-2024-00001")).toBe(true);
    expect(SHIPMENT_ID_RE.test(formatPackageId(2))).toBe(true);
    expect(() => formatPackageId(0)).toThrow();
  });
  it("reste en attente jusqu’à réception, pesée et confirmation du tarif", () => {
    const a = make(1),
      b = make(2);
    Object.assign(a, {
      status: "received",
      miamiReceivedAt: "2026-11-17",
      actualWeightLb: 1.5,
      weighedAt: "2026-11-17",
      ratePerLbCents: 600,
      shippingFeeCents: 900,
    });
    expect(orderShippingTotal([a, b])).toMatchObject({
      amountCents: 0,
      pendingCount: 2,
      provisional: true,
    });
    a.rateConfirmedAt = "2026-11-17";
    expect(orderShippingTotal([a, b])).toMatchObject({
      amountCents: 900,
      confirmedCount: 1,
      pendingCount: 1,
      provisional: true,
    });
    Object.assign(b, {
      status: "received",
      miamiReceivedAt: "2026-11-17",
      actualWeightLb: 2.25,
      weighedAt: "2026-11-17",
      rateConfirmedAt: "2026-11-17",
      ratePerLbCents: 600,
      shippingFeeCents: 1350,
    });
    expect(orderShippingTotal([a, b])).toMatchObject({
      amountCents: 2250,
      confirmedCount: 2,
      pendingCount: 0,
      provisional: false,
    });
    b.status = "cancelled";
    expect(orderShippingTotal([a, b])).toMatchObject({
      amountCents: 900,
      confirmedCount: 1,
      pendingCount: 0,
    });
    expect(calculateShippingFeeCents(1.5, 600)).toBe(900);
  });
  it("conserve la lecture des anciennes pesées sans inventer de nouvelles confirmations", () => {
    const legacy = {
      ...make(1),
      shipmentId: "SHE-COLIS-2024-00001",
      trackingNumber: "AMAZON-OLD",
      status: "received",
      actualWeightLb: 1.5,
      weighedAt: "2024-01-01",
      ratePerLbCents: 600,
      shippingFeeCents: 900,
    } as ShipmentDoc;
    delete legacy.rateConfirmedAt;
    delete legacy.externalTrackingNumber;
    delete legacy.packageSequence;
    expect(externalTracking(legacy)).toBe("AMAZON-OLD");
    expect(orderShippingTotal([legacy]).amountCents).toBe(900);
  });
  it("n’invente aucun article lors de l’ajout d’un contenant et garde le statut le moins avancé", () => {
    const a = make(1),
      b = make(2);
    a.status = "available";
    a.lastStep = 6;
    expect(b.lines).toEqual([]);
    expect(b.orderIds).toEqual([parent.orderId]);
    expect(orderPackageStatus([a, b], "available")).toBe("registered");
    b.status = "available";
    expect(orderPackageStatus([a, b], "registered")).toBe("available");
  });
});
