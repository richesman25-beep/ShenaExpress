import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  computeOrderStats,
  validateAllocation,
  countShipmentsByBucket,
  totalDue,
  totalPaid,
  balance,
  paymentStatus,
  parseMoney,
  formatMoney,
  relevantDates,
  isLate,
  diffDates,
  validateDateOrder,
  buildWhatsappMessage,
  buildWhatsappUrl,
  normalizeWhatsappNumber,
  hasPermission,
  STATUS_CODES,
  progressStep,
  createClientSchema,
  createOrderSchema,
  updateStatusSchema,
  completePasswordSetupSchema,
  getClientAccessState,
  CLIENT_ACCESS_LABELS,
  parseValidWeightLb,
  calculateShippingFeeCents,
  getShipmentFeeVisibility,
  COMMERCIAL_RATE_CENTS_PER_LB,
  TIMELINE_7_STEPS,
  type OrderItem,
  type ChargeLine,
} from "@shared/index";
import { formatError } from "@/lib/api";
import { validateFirebaseEnv } from "@/lib/firebase";
import { SettingsProvider } from "@/contexts/SettingsContext";
import {
  StatusBadge,
  ShipmentProgress,
  WeightAndFeeCard,
  TrackingTimeline,
  WhatsappContactButton,
} from "@/components/ui";
import { Timestamp } from "firebase/firestore";

describe("8. Comptage exact des articles & 7. Association de plusieurs colis", () => {
  const items: OrderItem[] = [
    { lineId: "L1", description: "Chaussures de sport", quantityOrdered: 4, quantityReceived: 3 },
    { lineId: "L2", description: "Sac à dos", quantityOrdered: 2, quantityReceived: 2 },
  ];

  it("ne considère jamais une commande nouvellement enregistrée comme reçue ou expédiée", () => {
    const initialItems: OrderItem[] = items.map((i) => ({ ...i, quantityReceived: 0 }));
    const stats = computeOrderStats("SHE-CMD-2026-00001", initialItems, []);
    expect(stats).toEqual({
      ordered: 6,
      received: 0,
      packed: 0,
      shipped: 0,
      delivered: 0,
      shipmentCount: 0,
    });
  });

  it("répartit une commande sur plusieurs colis sans compter deux fois les articles et ignore les colis annulés", () => {
    const shipments = [
      {
        shipmentId: "SHE-COLIS-2026-00001",
        status: "in_transit" as const,
        lines: [
          { orderId: "SHE-CMD-2026-00001", lineId: "L1", description: "Chaussures de sport", quantity: 2 },
          { orderId: "SHE-CMD-2026-00001", lineId: "L2", description: "Sac à dos", quantity: 1 },
        ],
      },
      {
        shipmentId: "SHE-COLIS-2026-00002",
        status: "delivered" as const,
        lines: [
          { orderId: "SHE-CMD-2026-00001", lineId: "L1", description: "Chaussures de sport", quantity: 1 },
          { orderId: "SHE-CMD-2026-00001", lineId: "L2", description: "Sac à dos", quantity: 1 },
        ],
      },
      {
        shipmentId: "SHE-COLIS-2026-00003",
        status: "cancelled" as const,
        lines: [{ orderId: "SHE-CMD-2026-00001", lineId: "L1", description: "Chaussures de sport", quantity: 2 }],
      },
    ];

    const stats = computeOrderStats("SHE-CMD-2026-00001", items, shipments);
    expect(stats.ordered).toBe(6);
    expect(stats.received).toBe(5);
    expect(stats.packed).toBe(5);
    expect(stats.shipped).toBe(5);
    expect(stats.delivered).toBe(2);
    expect(stats.shipmentCount).toBe(2);
  });

  it("refuse d'emballer plus d'articles que la quantité effectivement reçue disponible", () => {
    const existingShipments = [
      {
        shipmentId: "SHE-COLIS-2026-00001",
        status: "preparing" as const,
        lines: [{ orderId: "SHE-CMD-2026-00001", lineId: "L1", description: "Chaussures de sport", quantity: 2 }],
      },
    ];
    const issues = validateAllocation({
      newLines: [{ orderId: "SHE-CMD-2026-00001", lineId: "L1", description: "Chaussures de sport", quantity: 2 }],
      orders: { "SHE-CMD-2026-00001": items },
      otherShipments: existingShipments,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("seulement 1 reçu(s) et non encore emballé(s)");
  });

  it("classe chaque colis dans un seul compartiment statistique", () => {
    const buckets = countShipmentsByBucket([
      { status: "received" },
      { status: "in_transit" },
      { status: "arrived_haiti" },
      { status: "available" },
      { status: "delivered" },
    ]);
    expect(buckets).toEqual({
      pending: 1,
      transit: 1,
      arrived: 1,
      available: 1,
      delivered: 1,
      other: 0,
    });
  });
});

describe("10. Calcul du solde restant & devises", () => {
  const charges: ChargeLine[] = [
    { id: "C1", kind: "transport", label: "Fret aérien Miami -> PAP", amount: 4500 },
    { id: "C2", kind: "extra", label: "Manutention", amount: 1000 },
    { id: "C3", kind: "discount", label: "Remise fidélité", amount: 500 },
  ];

  it("calcule exactement le montant dû, le payé, le solde et l'état du paiement", () => {
    const due = totalDue(charges);
    expect(due).toBe(5000);

    const paid = totalPaid(
      [
        { amount: 2000, currency: "USD" },
        { amount: 1500, currency: "USD" },
        { amount: 9999, currency: "USD", voided: true },
      ],
      "USD",
    );
    expect(paid).toBe(3500);
    expect(balance(due, paid)).toBe(1500);
    expect(paymentStatus(due, paid)).toBe("partial");
    expect(paymentStatus(due, 5000)).toBe("paid");
    expect(formatMoney(1500, "USD", "fr-FR")).toContain("15");
    expect(formatMoney(250000, "HTG", "fr-FR")).toContain("HTG");
    expect(parseMoney("45,50")).toBe(4550);
  });

  it("interdit de mélanger automatiquement USD et HTG", () => {
    expect(() =>
      totalPaid([{ amount: 1000, currency: "HTG" }], "USD"),
    ).toThrow(/Devise incohérente/);
  });
});

describe("11. Modification des dates estimées & détection des retards", () => {
  it("sélectionne les dates pertinentes selon l'étape et détecte les retards", () => {
    const dates = {
      warehouseReceivedAt: "2026-11-01",
      estimatedDeparture: "2026-11-03",
      shippedAt: "2026-11-03",
      estimatedArrival: "2026-11-08",
    };
    const rel = relevantDates("in_transit", dates);
    expect(rel.map((r) => r.field)).toEqual(["shippedAt", "estimatedArrival"]);
    expect(rel.find((r) => r.field === "estimatedArrival")?.estimate).toBe(true);

    expect(isLate("in_transit", dates, "2026-11-10")).toBe(true);
    expect(isLate("delivered", dates, "2026-11-10")).toBe(false);

    const changes = diffDates(dates, { ...dates, estimatedArrival: "2026-11-12" });
    expect(changes).toEqual({ estimatedArrival: ["2026-11-08", "2026-11-12"] });
  });

  it("rejette les dates chronologiquement incohérentes", () => {
    const errs = validateDateOrder({
      estimatedDeparture: "2026-11-10",
      estimatedArrival: "2026-11-05",
    });
    expect(errs.length).toBeGreaterThan(0);
  });
});

describe("12. Construction et encodage du lien WhatsApp", () => {
  it("construit un message prérempli propre sans données sensibles et l'encode pour wa.me", () => {
    expect(normalizeWhatsappNumber("+509 34 56 78 90")).toBe("50934567890");
    expect(normalizeWhatsappNumber("0123")).toBeNull();

    const msg = buildWhatsappMessage({
      orderId: "SHE-CMD-2026-00001",
      trackingNumber: "SHX26000001",
      clientId: "SHE-CLIENT-001",
    });
    expect(msg).toBe(
      "Bonjour SHENA Express, je souhaite obtenir des informations sur ma commande SHE-CMD-2026-00001, concernant le colis SHX26000001. Mon identifiant client est SHE-CLIENT-001.",
    );

    const url = buildWhatsappUrl("+509 34 56 78 90", msg);
    expect(url).toBe(`https://wa.me/50934567890?text=${encodeURIComponent(msg)}`);
  });
});

describe("13. Vérification des permissions administratives & rôles employés", () => {
  it("accorde toutes les permissions à admin, uniquement celles listées à staff, et aucune à client", () => {
    expect(hasPermission({ role: "admin" }, "finance.write")).toBe(true);
    expect(hasPermission({ role: "staff", perms: ["orders.read", "shipments.write"] }, "shipments.write")).toBe(true);
    expect(hasPermission({ role: "staff", perms: ["orders.read"] }, "finance.write")).toBe(false);
    expect(hasPermission({ role: "client", clientId: "SHE-CLIENT-001" }, "orders.read")).toBe(false);
    expect(hasPermission(null, "orders.read")).toBe(false);
  });
});

describe("14. Gestion des erreurs et des données manquantes", () => {
  it("rejette les formulaires incomplets et traduit les erreurs en français", () => {
    expect(createClientSchema.safeParse({ fullName: "", phone: "12" }).success).toBe(false);
    expect(
      createOrderSchema.safeParse({
        clientId: "INVALIDE",
        orderDate: "2026-11-10",
        currency: "USD",
        items: [],
      }).success,
    ).toBe(false);
    expect(
      updateStatusSchema.safeParse({
        targetType: "shipment",
        targetId: "SHE-COLIS-2026-00001",
        status: "unknown_status",
      }).success,
    ).toBe(false);

    expect(formatError({ code: "auth/invalid-credential" })).toBe("Identifiant ou mot de passe incorrect.");
    expect(formatError({ code: "auth/user-disabled" })).toContain("désactivé");
    expect(formatError({ code: "functions/permission-denied" })).toContain("Accès refusé");

    // Identifiants clients supportés (SHE-CLIENT-001, SHENA-0001, SHENA-001) et statuts d'accès
    expect(createClientSchema.safeParse({ fullName: "Client Test", phone: "+509 34 00 00 00", clientId: "SHENA-001" }).success).toBe(true);
    expect(createClientSchema.safeParse({ fullName: "Client Test", phone: "+509 34 00 00 00", clientId: "SHENA-0001" }).success).toBe(true);
    expect(createClientSchema.safeParse({ fullName: "Client Test", phone: "+509 34 00 00 00", clientId: "SHE-CLIENT-001" }).success).toBe(true);
    expect(createClientSchema.safeParse({ fullName: "Client Test", phone: "+509 34 00 00 00", clientId: "BAD ID" }).success).toBe(false);
    expect(formatError({ code: "functions/internal", message: "internal [0]" })).not.toContain("internal [0]");

    expect(getClientAccessState({ status: "active", passwordConfigured: false })).toBe("pending_setup");
    expect(CLIENT_ACCESS_LABELS[getClientAccessState({ status: "active", passwordConfigured: false })]).toBe("En attente de configuration");
    expect(getClientAccessState({ status: "active", passwordConfigured: true })).toBe("active");
    expect(getClientAccessState({ status: "disabled", passwordConfigured: true })).toBe("disabled");

    expect(completePasswordSetupSchema.safeParse({ oobCode: "code123", newPassword: "short" }).success).toBe(false);
    expect(completePasswordSetupSchema.safeParse({ oobCode: "code123", newPassword: "StrongPassword123" }).success).toBe(true);

    // Validation de la configuration Firebase : distinction claire entre variables absentes et mal formées sans exposer de secret
    const missingRes = validateFirebaseEnv({});
    expect(missingRes.valid).toBe(false);
    expect(missingRes.missingVars).toEqual([
      "VITE_FIREBASE_API_KEY",
      "VITE_FIREBASE_AUTH_DOMAIN",
      "VITE_FIREBASE_PROJECT_ID",
      "VITE_FIREBASE_APP_ID",
    ]);
    expect(missingRes.errorMessage).toContain("Variable(s) absente(s) lors du build");

    const malformedRes = validateFirebaseEnv({
      VITE_FIREBASE_API_KEY: "cle-invalide-secrète-ne-pas-afficher",
      VITE_FIREBASE_AUTH_DOMAIN: "https://shenaexpress-13924.firebaseapp.com/",
      VITE_FIREBASE_PROJECT_ID: "UPPERCASE_INVALID",
      VITE_FIREBASE_APP_ID: "bad-app-id",
    });
    expect(malformedRes.valid).toBe(false);
    expect(malformedRes.missingVars).toHaveLength(0);
    expect(malformedRes.malformedVars).toHaveLength(4);
    expect(malformedRes.errorMessage).toContain("Variable(s) mal formée(s)");
    expect(malformedRes.errorMessage).not.toContain("cle-invalide-secrète-ne-pas-afficher");

    // Tolère les guillemets et virgules copiés par erreur depuis un extrait JS dans Netlify
    const quotedRes = validateFirebaseEnv({
      VITE_FIREBASE_API_KEY: '"AIzaSyDzb42MNgabaOKe3brkWp7S3uXMa8WhLxE",',
      VITE_FIREBASE_AUTH_DOMAIN: '"shenaexpress-13924.firebaseapp.com",',
      VITE_FIREBASE_PROJECT_ID: '"shenaexpress-13924",',
      VITE_FIREBASE_APP_ID: '"1:447281041430:web:ce2292f951c29f9fc86537"',
    });
    expect(quotedRes.valid).toBe(true);
    expect(quotedRes.config?.projectId).toBe("shenaexpress-13924");
  });
});

describe("9 & 15. Chronologie, progression des 15 statuts et composants responsives", () => {
  it("couvre les 15 statuts logistiques et affiche la chronologie dans l'ordre chronologique", async () => {
    expect(STATUS_CODES).toHaveLength(15);
    expect(progressStep("registered")).toBe(0);
    expect(progressStep("delivered")).toBe(5);
    expect(progressStep("delayed", 2)).toBe(2);
    expect(progressStep("cancelled")).toBeNull();

    render(
      <SettingsProvider staticSettings={{ whatsappNumber: "50934567890" }}>
        <div>
          <StatusBadge status="in_transit" />
          <ShipmentProgress status="arrived_haiti" lastStep={3} />
          <TrackingTimeline
            events={[
              {
                id: "ev2",
                kind: "status",
                targetType: "shipment",
                shipmentId: "SHE-COLIS-2026-00001",
                clientUid: "u1",
                fromStatus: "received",
                toStatus: "in_transit",
                publicNote: "Départ du vol cargo",
                actorUid: "admin1",
                actorRole: "admin",
                at: Timestamp.fromMillis(2000),
              },
              {
                id: "ev1",
                kind: "created",
                targetType: "shipment",
                shipmentId: "SHE-COLIS-2026-00001",
                clientUid: "u1",
                toStatus: "received",
                publicNote: "Colis réceptionné à Miami",
                actorUid: "admin1",
                actorRole: "admin",
                at: Timestamp.fromMillis(1000),
              },
            ]}
          />
          <WhatsappContactButton orderId="SHE-CMD-2026-00001" trackingNumber="SHX26000001" clientId="SHE-CLIENT-001" />
        </div>
      </SettingsProvider>,
    );

    expect(screen.getAllByText("En transit vers Haïti").length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: /Progression/i })).toBeInTheDocument();

    const items = screen.getAllByRole("listitem");
    const texts = items.map((el) => el.textContent ?? "");
    const idxFirst = texts.findIndex((t) => t.includes("Colis réceptionné à Miami"));
    const idxSecond = texts.findIndex((t) => t.includes("Départ du vol cargo"));
    expect(idxFirst).toBeLessThan(idxSecond);

    // Vérification mobile / accessibilité : ouverture de l'éditeur de message WhatsApp
    const waBtn = screen.getByRole("button", { name: /Contacter SHENA Express sur WhatsApp/i });
    expect(waBtn).toBeEnabled();
    await userEvent.click(waBtn);
    expect(screen.getByRole("dialog", { name: /Contacter SHENA Express sur WhatsApp/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ouvrir dans WhatsApp/i })).toHaveAttribute(
      "href",
      expect.stringContaining("https://wa.me/50934567890?text="),
    );
  });
});

describe("Calcul des frais à 6,00 USD/lb & visibilité", () => {
  it("calcule exactement 6,00 USD/lb sans arrondi à la livre supérieure", () => {
    const cases: Array<[number, number]> = [
      [0.5, 300],
      [1.25, 750],
      [2.3, 1380],
      [4.75, 2850],
      [10.0, 6000],
    ];
    for (const [weight, expectedCents] of cases) {
      const valid = parseValidWeightLb(weight);
      expect(valid).toBe(weight);
      expect(calculateShippingFeeCents(valid!, COMMERCIAL_RATE_CENTS_PER_LB)).toBe(expectedCents);
    }
  });

  it("rejette les poids invalides, négatifs, nuls ou trop précis", () => {
    expect(parseValidWeightLb(0)).toBeNull();
    expect(parseValidWeightLb(-2.5)).toBeNull();
    expect(parseValidWeightLb(Number.NaN)).toBeNull();
    expect(parseValidWeightLb(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseValidWeightLb("abc")).toBeNull();
    expect(parseValidWeightLb(1.2345)).toBeNull();
  });

  it("applique strictement la visibilité des frais avant/après réception à Miami et pesée", () => {
    expect(
      getShipmentFeeVisibility({
        status: "registered",
        miamiReceivedAt: null,
        actualWeightLb: null,
        shippingFeeCents: null,
      }),
    ).toBe("hidden");

    expect(
      getShipmentFeeVisibility({
        status: "preparing",
        miamiReceivedAt: null,
        actualWeightLb: 2.3,
        shippingFeeCents: 1380,
      }),
    ).toBe("hidden");

    expect(
      getShipmentFeeVisibility({
        status: "received",
        miamiReceivedAt: "2026-11-10T12:00:00.000Z",
        actualWeightLb: null,
        shippingFeeCents: null,
      }),
    ).toBe("awaiting_weighing");

    expect(
      getShipmentFeeVisibility({
        status: "in_transit",
        miamiReceivedAt: "2026-11-10T12:00:00.000Z",
        actualWeightLb: 2.3,
        shippingFeeCents: 1380,
        weighedAt: "2026-11-10T14:00:00.000Z",
      }),
    ).toBe("ready");
  });

  it("affiche WeightAndFeeCard selon l'état (masqué, en attente de pesée, ou complet)", () => {
    const { rerender, container } = render(
      <SettingsProvider>
        <WeightAndFeeCard
          shipment={{
            status: "registered",
            miamiReceivedAt: null,
            actualWeightLb: null,
            ratePerLbCents: null,
            shippingFeeCents: null,
            shippingCurrency: "USD",
            shippingPaymentStatus: null,
            weighedAt: null,
          }}
        />
      </SettingsProvider>,
    );
    expect(container.firstChild).toBeNull();

    rerender(
      <SettingsProvider>
        <WeightAndFeeCard
          shipment={{
            status: "received",
            miamiReceivedAt: "2026-11-10T12:00:00.000Z",
            actualWeightLb: null,
            ratePerLbCents: null,
            shippingFeeCents: null,
            shippingCurrency: "USD",
            shippingPaymentStatus: null,
            weighedAt: null,
          }}
        />
      </SettingsProvider>,
    );
    expect(screen.getByText(/En attente de pesée/i)).toBeInTheDocument();

    rerender(
      <SettingsProvider>
        <WeightAndFeeCard
          shipment={{
            status: "received",
            miamiReceivedAt: "2026-11-10T12:00:00.000Z",
            actualWeightLb: 2.3,
            ratePerLbCents: 600,
            shippingFeeCents: 1380,
            shippingCurrency: "USD",
            shippingPaymentStatus: "unpaid",
            weighedAt: "2026-11-10T14:00:00.000Z",
          }}
        />
      </SettingsProvider>,
    );
    expect(screen.getByText(/2,30\s*lb/i)).toBeInTheDocument();
    expect(screen.getByText(/13,80/)).toBeInTheDocument();
    expect(screen.getByText("À payer")).toBeInTheDocument();
  });

  it("définit exactement les 7 étapes officielles de suivi", () => {
    expect(TIMELINE_7_STEPS.map((s) => s.label)).toEqual([
      "Commande confirmée",
      "En cours de préparation",
      "Arrivé à l'entrepôt de Miami",
      "En transit vers Haïti",
      "Arrivé en Haïti",
      "Prêt pour livraison",
      "Livré",
    ]);
  });
});
