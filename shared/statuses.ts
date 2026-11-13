/**
 * Statuts logistiques SHENA Express.
 * Les codes historiques restent lisibles ; le parcours quotidien contient six étapes
 * de la commande placée jusqu’à la disponibilité pour le retrait.
 */
export const STATUS_CODES = [
  "registered",
  "awaiting_receipt",
  "partially_received",
  "received",
  "preparing",
  "shipped",
  "in_transit",
  "arrived_dr",
  "bus_to_haiti",
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
  /** Index dans le parcours simplifié (1 à 6) ; null si annulé. */
  shenaStep: 1 | 2 | 3 | 4 | 5 | 6 | null;
  /** Statut terminal : aucune progression attendue ensuite. */
  terminal?: boolean;
}

export const STATUS_DEFINITIONS: Record<StatusCode, StatusDefinition> = {
  registered: {
    code: "registered",
    label: "Commande placée",
    description: "Votre commande a bien été placée et enregistrée chez SHENA Express.",
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
    timelineStep: 2,
    shenaStep: 2,
  },
  received: {
    code: "received",
    label: "Arrivé à l'entrepôt de Miami",
    description: "Votre colis est arrivé physiquement à notre entrepôt de Miami.",
    locationLabel: "Entrepôt de Miami",
    tone: "received",
    step: 1,
    timelineStep: 2,
    shenaStep: 2,
  },
  preparing: {
    code: "preparing",
    label: "En cours de préparation",
    description: "Votre commande est en cours de préparation chez le fournisseur.",
    locationLabel: "Préparation chez le fournisseur",
    tone: "neutral",
    step: 1,
    timelineStep: 1,
    shenaStep: 1,
  },
  shipped: {
    code: "shipped",
    label: "En avion — Départ des USA",
    description: "Votre colis a quitté les USA en avion vers la République dominicaine.",
    locationLabel: "En avion — Départ des USA",
    tone: "transit",
    step: 2,
    timelineStep: 3,
    shenaStep: 3,
  },
  in_transit: {
    code: "in_transit",
    label: "En avion — Départ des USA",
    description: "Votre colis a quitté les USA en avion vers la République dominicaine.",
    locationLabel: "En avion — Départ des USA",
    tone: "transit",
    step: 2,
    timelineStep: 3,
    shenaStep: 3,
  },
  arrived_dr: {
    code: "arrived_dr", label: "Entrepôt en République dominicaine",
    description: "Votre colis est arrivé dans notre entrepôt en République dominicaine.",
    locationLabel: "Entrepôt SHENA Express en République dominicaine",
    tone: "arrived", step: 3, timelineStep: 4, shenaStep: 4,
  },
  bus_to_haiti: {
    code: "bus_to_haiti", label: "En bus vers Haïti",
    description: "Votre colis est en bus vers sa destination finale en Haïti.",
    locationLabel: "Transport en bus vers Haïti",
    tone: "transit", step: 3, timelineStep: 5, shenaStep: 5,
  },
  arrived_haiti: {
    code: "arrived_haiti",
    label: "Arrivé en Haïti",
    description: "Votre colis est arrivé en Haïti et est en cours de traitement.",
    locationLabel: "Local SHENA Express en Haïti",
    tone: "arrived",
    step: 3,
    timelineStep: 5,
    shenaStep: 5,
  },
  customs: {
    code: "customs",
    label: "Arrivé en Haïti",
    description: "Votre colis est arrivé en Haïti et est en cours de vérification douanière.",
    locationLabel: "Haïti — Traitement",
    tone: "arrived",
    step: 3,
    timelineStep: 5,
    shenaStep: 5,
  },
  available: {
    code: "available",
    label: "Disponible pour le retrait",
    description: "Votre colis est prêt pour le retrait ou la livraison finale en Haïti.",
    locationLabel: "Local SHENA Express en Haïti — Disponible pour le retrait",
    tone: "delivered",
    step: 4,
    timelineStep: 6,
    shenaStep: 6,
  },
  out_for_delivery: {
    code: "out_for_delivery",
    label: "Disponible pour le retrait",
    description: "Votre colis est prêt et en cours d'acheminement pour la livraison finale.",
    locationLabel: "En cours de livraison en Haïti",
    tone: "delivered",
    step: 4,
    timelineStep: 6,
    shenaStep: 6,
  },
  delivered: {
    code: "delivered",
    label: "Livré",
    description: "Votre colis a été remis avec succès.",
    locationLabel: "Livré au client",
    tone: "delivered",
    step: 5,
    timelineStep: 7,
    shenaStep: 6,
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
 * Étapes de la commande placée à la disponibilité pour le retrait.
 */
export interface ShenaLogisticsStep {
  shenaStep: 1 | 2 | 3 | 4 | 5 | 6;
  code: StatusCode;
  stepTitle: string;
  clientLabel: string;
  description: string;
  locationLabel: string;
  isAvailabilityState?: boolean;
}

/** Parcours quotidien : six étapes, puis remise facultative au client. */
export const SHENA_PRIMARY_STATUSES: readonly StatusCode[] = [
  "registered", "received", "in_transit", "arrived_dr", "bus_to_haiti", "available",
];
export const TIMELINE_7_STEPS = [
  { step: 1 as const, code: "registered" as StatusCode, label: "Commande placée", dateField: "orderConfirmedAt" as const },
  { step: 2 as const, code: "received" as StatusCode, label: "Arrivé à l'entrepôt de Miami", dateField: "miamiReceivedAt" as const },
  { step: 3 as const, code: "in_transit" as StatusCode, label: "En avion — Départ des USA", dateField: "inTransitAt" as const },
  { step: 4 as const, code: "arrived_dr" as StatusCode, label: "Entrepôt en République dominicaine", dateField: "arrivedDominicanAt" as const },
  { step: 5 as const, code: "bus_to_haiti" as StatusCode, label: "En bus vers Haïti", dateField: "busToHaitiAt" as const },
  { step: 6 as const, code: "available" as StatusCode, label: "Disponible pour le retrait", dateField: "readyForDeliveryAt" as const },
  { step: 7 as const, code: "delivered" as StatusCode, label: "Livré", dateField: "deliveredAt" as const },
] as const;
export const SHENA_LOGISTICS_STEPS: readonly ShenaLogisticsStep[] = TIMELINE_7_STEPS.slice(0, 6).map(item => ({
  shenaStep: item.step as 1 | 2 | 3 | 4 | 5 | 6,
  code: item.code, stepTitle: item.label, clientLabel: item.label,
  description: STATUS_DEFINITIONS[item.code].description,
  locationLabel: STATUS_DEFINITIONS[item.code].locationLabel,
  isAvailabilityState: item.code === "available",
}));

export function timelineStepNumber(code: StatusCode, lastKnownStep = 1): 1 | 2 | 3 | 4 | 5 | 6 | 7 | null {
  if (code === "cancelled") return null;
  const s = STATUS_DEFINITIONS[code]?.timelineStep;
  if (s) return s;
  if (lastKnownStep >= 7) return 7;
  if (lastKnownStep >= 1 && lastKnownStep <= 7) return lastKnownStep as 1 | 2 | 3 | 4 | 5 | 6 | 7;
  return 1;
}

/** Étapes affichées dans l'indicateur de progression client. */
export const PROGRESS_STEPS = SHENA_LOGISTICS_STEPS.map(item => ({ step: item.shenaStep, label: item.clientLabel }));

/** Statuts considérés comme « expédiés » (articles ayant quitté l'entrepôt de Miami). */
export const SHIPPED_STATUSES: readonly StatusCode[] = [
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

export const TRANSIT_STATUSES: readonly StatusCode[] = ["shipped", "in_transit", "bus_to_haiti"];
export const ARRIVED_STATUSES: readonly StatusCode[] = ["arrived_dr", "arrived_haiti", "customs"];
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

export function shenaStepNumber(code: StatusCode, lastKnownStep = 1): 1 | 2 | 3 | 4 | 5 | 6 | null {
  if (code === "cancelled") return null;
  const s = STATUS_DEFINITIONS[code]?.shenaStep;
  if (s) return s;
  return Math.min(6, Math.max(1, lastKnownStep)) as 1 | 2 | 3 | 4 | 5 | 6;
}

export function isAvailableForPickup(code: StatusCode): boolean {
  return code === "available" || code === "out_for_delivery" || code === "delivered";
}

export function nextLogisticsStatus(code: StatusCode): StatusCode | null {
  const step = timelineStepNumber(code);
  if (step === 1) return "received";
  if (step === 2) return "in_transit";
  if (step === 3) return "arrived_dr";
  if (step === 4) return "bus_to_haiti";
  if (step === 5) return "available";
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
