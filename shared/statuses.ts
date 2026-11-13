/**
 * Statuts logistiques SHENA Express.
 * Les codes sont stables (stockés en base) ; les libellés suivent les trois étapes
 * officielles de transport de SHENA Express + l'état final de disponibilité pour retrait.
 */
export const STATUS_CODES = [
  "registered",
  "awaiting_receipt",
  "partially_received",
  "received",
  "preparing",
  "shipped",
  "in_transit",
  "arrived_haiti",
  "customs",
  "available",
  "out_for_delivery",
  "delivered",
  "delayed",
  "info_required",
  "cancelled",
] as const;

export type StatusCode = (typeof STATUS_CODES)[number];

export type StatusTone = "neutral" | "received" | "transit" | "arrived" | "delivered" | "warning" | "danger";

export interface StatusDefinition {
  code: StatusCode;
  /** Libellé français par défaut. */
  label: string;
  /** Description courte rassurante destinée au client. */
  description: string;
  /** Emplacement ou étape logistique actuelle. */
  locationLabel: string;
  tone: StatusTone;
  /** Étape de progression (0-5) pour compatibilité technique ; null = statut hors parcours. */
  step: number | null;
  /** Étape dans la chronologie à 7 étapes (1-7) ; null si hors parcours. */
  timelineStep: 1 | 2 | 3 | 4 | 5 | 6 | 7 | null;
  /** Index dans le parcours simplifié (1 à 4) ; null si annulé. */
  shenaStep: 1 | 2 | 3 | 4 | null;
  /** Statut terminal : aucune progression attendue ensuite. */
  terminal?: boolean;
}

export const STATUS_DEFINITIONS: Record<StatusCode, StatusDefinition> = {
  registered: {
    code: "registered",
    label: "Commande confirmée",
    description: "Votre commande est confirmée et enregistrée dans notre système.",
    locationLabel: "Commande enregistrée",
    tone: "neutral",
    step: 0,
    timelineStep: 1,
    shenaStep: 1,
  },
  awaiting_receipt: {
    code: "awaiting_receipt",
    label: "Commande confirmée",
    description: "Votre commande est confirmée et en attente de préparation.",
    locationLabel: "En attente de préparation",
    tone: "neutral",
    step: 0,
    timelineStep: 1,
    shenaStep: 1,
  },
  partially_received: {
    code: "partially_received",
    label: "Arrivé à l'entrepôt de Miami",
    description: "Une partie de votre colis a été réceptionnée à notre entrepôt de Miami.",
    locationLabel: "Entrepôt de Miami",
    tone: "received",
    step: 1,
    timelineStep: 3,
    shenaStep: 1,
  },
  received: {
    code: "received",
    label: "Arrivé à l'entrepôt de Miami",
    description: "Votre colis est arrivé physiquement à notre entrepôt de Miami.",
    locationLabel: "Entrepôt de Miami",
    tone: "received",
    step: 1,
    timelineStep: 3,
    shenaStep: 1,
  },
  preparing: {
    code: "preparing",
    label: "En cours de préparation",
    description: "Votre commande est en cours de préparation chez le fournisseur.",
    locationLabel: "Préparation chez le fournisseur",
    tone: "neutral",
    step: 1,
    timelineStep: 2,
    shenaStep: 1,
  },
  shipped: {
    code: "shipped",
    label: "En transit vers Haïti",
    description: "Votre colis a quitté Miami et est en transit vers Haïti.",
    locationLabel: "En transit vers Haïti",
    tone: "transit",
    step: 2,
    timelineStep: 4,
    shenaStep: 2,
  },
  in_transit: {
    code: "in_transit",
    label: "En transit vers Haïti",
    description: "Votre colis a quitté l'entrepôt de Miami et est en transit vers Haïti.",
    locationLabel: "En transit vers Haïti",
    tone: "transit",
    step: 2,
    timelineStep: 4,
    shenaStep: 2,
  },
  arrived_haiti: {
    code: "arrived_haiti",
    label: "Arrivé en Haïti",
    description: "Votre colis est arrivé en Haïti et est en cours de traitement.",
    locationLabel: "Local SHENA Express en Haïti",
    tone: "arrived",
    step: 3,
    timelineStep: 5,
    shenaStep: 3,
  },
  customs: {
    code: "customs",
    label: "Arrivé en Haïti",
    description: "Votre colis est arrivé en Haïti et est en cours de vérification douanière.",
    locationLabel: "Haïti — Traitement",
    tone: "arrived",
    step: 3,
    timelineStep: 5,
    shenaStep: 3,
  },
  available: {
    code: "available",
    label: "Prêt pour livraison",
    description: "Votre colis est prêt pour le retrait ou la livraison finale en Haïti.",
    locationLabel: "Local SHENA Express en Haïti — Prêt pour livraison",
    tone: "delivered",
    step: 4,
    timelineStep: 6,
    shenaStep: 4,
  },
  out_for_delivery: {
    code: "out_for_delivery",
    label: "Prêt pour livraison",
    description: "Votre colis est prêt et en cours d'acheminement pour la livraison finale.",
    locationLabel: "En cours de livraison en Haïti",
    tone: "delivered",
    step: 4,
    timelineStep: 6,
    shenaStep: 4,
  },
  delivered: {
    code: "delivered",
    label: "Livré",
    description: "Votre colis a été remis avec succès.",
    locationLabel: "Livré au client",
    tone: "delivered",
    step: 5,
    timelineStep: 7,
    shenaStep: 4,
    terminal: true,
  },
  delayed: {
    code: "delayed",
    label: "Retardé",
    description: "Un incident ou délai logistique est en cours de traitement par notre équipe.",
    locationLabel: "Suivi opérationnel SHENA Express",
    tone: "warning",
    step: null,
    timelineStep: null,
    shenaStep: null,
  },
  info_required: {
    code: "info_required",
    label: "En attente d'informations",
    description: "Veuillez contacter SHENA Express concernant ce colis.",
    locationLabel: "Suivi opérationnel SHENA Express",
    tone: "warning",
    step: null,
    timelineStep: null,
    shenaStep: null,
  },
  cancelled: {
    code: "cancelled",
    label: "Annulé",
    description: "Cet envoi a été annulé.",
    locationLabel: "Annulé",
    tone: "danger",
    step: null,
    timelineStep: null,
    shenaStep: null,
    terminal: true,
  },
};

/**
 * Les 3 étapes de transport officielles de SHENA Express + l'indication finale de disponibilité pour le retrait.
 */
export interface ShenaLogisticsStep {
  shenaStep: 1 | 2 | 3 | 4;
  code: StatusCode;
  stepTitle: string;
  clientLabel: string;
  description: string;
  locationLabel: string;
  isAvailabilityState?: boolean;
}

export const SHENA_LOGISTICS_STEPS: readonly ShenaLogisticsStep[] = [
  {
    shenaStep: 1,
    code: "received",
    stepTitle: "Réception à l'entrepôt de Miami",
    clientLabel: "Reçu à l'entrepôt de Miami",
    description: "Votre colis a été réceptionné à notre entrepôt de Miami.",
    locationLabel: "Entrepôt de Miami",
  },
  {
    shenaStep: 2,
    code: "in_transit",
    stepTitle: "Transport aérien vers la République dominicaine",
    clientLabel: "En transit aérien vers la République dominicaine",
    description:
      "Votre colis a quitté l'étape de réception à Miami et est en transit aérien vers la République dominicaine.",
    locationLabel: "Transit aérien vers la République dominicaine",
  },
  {
    shenaStep: 3,
    code: "arrived_haiti",
    stepTitle: "Transport en bus vers le local en Haïti",
    clientLabel: "En route vers notre local en Haïti",
    description: "Votre colis poursuit son acheminement en bus vers notre local en Haïti.",
    locationLabel: "En route en bus vers notre local en Haïti",
  },
  {
    shenaStep: 4,
    code: "available",
    stepTitle: "Disponible pour le retrait",
    clientLabel: "Disponible pour le retrait",
    description: "Votre colis est arrivé à notre local SHENA Express en Haïti. Vous pouvez venir le récupérer.",
    locationLabel: "Local SHENA Express en Haïti (Disponible pour retrait)",
    isAvailabilityState: true,
  },
] as const;

export const SHENA_PRIMARY_STATUSES: readonly StatusCode[] = [
  "registered",
  "preparing",
  "received",
  "in_transit",
  "arrived_haiti",
  "available",
  "delivered",
] as const;

/** Les 7 étapes officielles de la chronologie visuelle SHENA Express. */
export const TIMELINE_7_STEPS = [
  { step: 1 as const, code: "registered" as StatusCode, label: "Commande confirmée", dateField: "orderConfirmedAt" as const },
  { step: 2 as const, code: "preparing" as StatusCode, label: "En cours de préparation", dateField: "preparingAt" as const },
  { step: 3 as const, code: "received" as StatusCode, label: "Arrivé à l'entrepôt de Miami", dateField: "miamiReceivedAt" as const },
  { step: 4 as const, code: "in_transit" as StatusCode, label: "En transit vers Haïti", dateField: "inTransitAt" as const },
  { step: 5 as const, code: "arrived_haiti" as StatusCode, label: "Arrivé en Haïti", dateField: "arrivedHaitiAt" as const },
  { step: 6 as const, code: "available" as StatusCode, label: "Prêt pour livraison", dateField: "readyForDeliveryAt" as const },
  { step: 7 as const, code: "delivered" as StatusCode, label: "Livré", dateField: "deliveredAt" as const },
] as const;

export function timelineStepNumber(code: StatusCode, lastKnownStep = 1): 1 | 2 | 3 | 4 | 5 | 6 | 7 | null {
  if (code === "cancelled") return null;
  const s = STATUS_DEFINITIONS[code]?.timelineStep;
  if (s) return s;
  if (lastKnownStep >= 7) return 7;
  if (lastKnownStep >= 1 && lastKnownStep <= 7) return lastKnownStep as 1 | 2 | 3 | 4 | 5 | 6 | 7;
  return 1;
}

/** Étapes affichées dans l'indicateur de progression client. */
export const PROGRESS_STEPS = [
  { step: 1, label: "Réception à l'entrepôt de Miami" },
  { step: 2, label: "Transport aérien vers la République dominicaine" },
  { step: 3, label: "Transport en bus vers le local en Haïti" },
  { step: 4, label: "Disponible pour le retrait" },
] as const;

/** Statuts considérés comme « expédiés » (articles ayant quitté l'entrepôt de Miami). */
export const SHIPPED_STATUSES: readonly StatusCode[] = [
  "shipped",
  "in_transit",
  "arrived_haiti",
  "customs",
  "available",
  "out_for_delivery",
  "delivered",
];

export const TRANSIT_STATUSES: readonly StatusCode[] = ["shipped", "in_transit"];
export const ARRIVED_STATUSES: readonly StatusCode[] = ["arrived_haiti", "customs"];
export const AVAILABLE_STATUSES: readonly StatusCode[] = ["available", "out_for_delivery"];

export function isStatusCode(value: unknown): value is StatusCode {
  return typeof value === "string" && (STATUS_CODES as readonly string[]).includes(value);
}

export function statusLabel(code: StatusCode, overrides?: Partial<Record<StatusCode, string>>): string {
  return overrides?.[code]?.trim() || STATUS_DEFINITIONS[code]?.label || STATUS_DEFINITIONS.received.label;
}

export function statusDescription(code: StatusCode): string {
  return STATUS_DEFINITIONS[code]?.description || STATUS_DEFINITIONS.received.description;
}

export function statusLocation(code: StatusCode): string {
  return STATUS_DEFINITIONS[code]?.locationLabel || STATUS_DEFINITIONS.received.locationLabel;
}

export function shenaStepNumber(code: StatusCode, lastKnownStep = 1): 1 | 2 | 3 | 4 | null {
  if (code === "cancelled") return null;
  const s = STATUS_DEFINITIONS[code]?.shenaStep;
  if (s) return s;
  if (lastKnownStep >= 4) return 4;
  if (lastKnownStep === 3) return 3;
  if (lastKnownStep === 2) return 2;
  return 1;
}

export function isAvailableForPickup(code: StatusCode): boolean {
  return code === "available" || code === "out_for_delivery" || code === "delivered";
}

export function nextLogisticsStatus(code: StatusCode): StatusCode | null {
  const step = timelineStepNumber(code);
  if (step === 1) return "preparing";
  if (step === 2) return "received";
  if (step === 3) return "in_transit";
  if (step === 4) return "arrived_haiti";
  if (step === 5) return "available";
  if (step === 6) return "delivered";
  return null;
}

/**
 * Étape de progression à afficher (0-5). Pour un statut hors parcours (retard, info requise),
 * on conserve la dernière étape connue fournie par l'appelant.
 */
export function progressStep(code: StatusCode, lastKnownStep = 0): number | null {
  if (code === "cancelled") return null;
  const step = STATUS_DEFINITIONS[code].step;
  return step ?? lastKnownStep;
}

/** Statuts pour lesquels un colis est encore attendu. */
export function isOpenStatus(code: StatusCode): boolean {
  return !STATUS_DEFINITIONS[code].terminal;
}
