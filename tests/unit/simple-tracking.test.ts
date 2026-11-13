import { describe, expect, it, vi } from "vitest";
import { SHENA_PRIMARY_STATUSES, nextLogisticsStatus, timelineStepNumber, statusLocation } from "../../shared/index";

vi.mock("@/lib/firebase", () => ({ firebaseState: { mode: "production" } }));
import { api } from "../../src/lib/api";
import { directBackend } from "../../src/lib/directBackend";

describe("Parcours simple de SHENA Express", () => {
  it("suit les six étapes et termine à la disponibilité pour le retrait", () => {
    expect(SHENA_PRIMARY_STATUSES).toEqual(["registered", "received", "in_transit", "arrived_dr", "bus_to_haiti", "available"]);
    for (const [index, status] of SHENA_PRIMARY_STATUSES.entries()) {
      expect(timelineStepNumber(status)).toBe(index + 1);
      expect(nextLogisticsStatus(status)).toBe(SHENA_PRIMARY_STATUSES[index + 1] ?? null);
    }
    expect(statusLocation("arrived_haiti")).toContain("Haïti");
    expect(statusLocation("arrived_dr")).toContain("République dominicaine");
  });
  it("transmet les champs de pesée attendus par Firebase depuis le formulaire", async () => {
    const spy = vi.spyOn(directBackend, "recordShipmentWeighing").mockResolvedValue({ actualWeightLb: 4.75, ratePerLbCents: 600, shippingFeeCents: 2850, shippingPaymentStatus: "unpaid" });
    try {
      await api.recordShipmentWeighing({ shipmentId: "SHE-COLIS-2026-00001", actualWeightLb: 4.75, confirmMiamiReception: true });
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ weightLb: 4.75, confirmMiamiReceipt: true }));
    } finally { spy.mockRestore(); }
  });
});
