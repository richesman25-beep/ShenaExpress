/**
 * Statuts logistiques SHENA Express.
 * Les codes sont stables (stockés en base) ; les libellés sont traduisibles
 * et personnalisables via settings/public.statusLabels.
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
  tone: StatusTone;
  /** Étape de progression (0-5) pour l'indicateur visuel ; null = statut hors parcours. */
  step: number | null;
  /** Statut terminal : aucune progression attendue ensuite. */
  terminal?: boolean;
}

export const STATUS_DEFINITIONS: Record<StatusCode, StatusDefinition> = {
  registered: { code: "registered", label: "Commande enregistrée", tone: "neutral", step: 0 },
  awaiting_receipt: { code: "awaiting_receipt", label: "En attente de réception", tone: "neutral", step: 0 },
  partially_received: { code: "partially_received", label: "Partiellement reçu", tone: "received", step: 1 },
  received: { code: "received", label: "Reçu à l'entrepôt", tone: "received", step: 1 },
  preparing: { code: "preparing", label: "En préparation", tone: "received", step: 1 },
  shipped: { code: "shipped", label: "Expédié", tone: "transit", step: 2 },
  in_transit: { code: "in_transit", label: "En transit", tone: "transit", step: 2 },
  arrived_haiti: { code: "arrived_haiti", label: "Arrivé en Haïti", tone: "arrived", step: 3 },
  customs: { code: "customs", label: "En traitement douanier", tone: "arrived", step: 3 },
  available: { code: "available", label: "Disponible pour retrait ou livraison", tone: "arrived", step: 4 },
  out_for_delivery: { code: "out_for_delivery", label: "En cours de livraison", tone: "arrived", step: 4 },
  delivered: { code: "delivered", label: "Livré", tone: "delivered", step: 5, terminal: true },
  delayed: { code: "delayed", label: "Retardé", tone: "warning", step: null },
  info_required: { code: "info_required", label: "En attente d'informations", tone: "warning", step: null },
  cancelled: { code: "cancelled", label: "Annulé", tone: "danger", step: null, terminal: true },
};

/** Étapes affichées dans l'indicateur de progression client. */
export const PROGRESS_STEPS = [
  { step: 0, label: "Enregistré" },
  { step: 1, label: "Reçu" },
  { step: 2, label: "En transit" },
  { step: 3, label: "Arrivé en Haïti" },
  { step: 4, label: "Disponible" },
  { step: 5, label: "Livré" },
] as const;

/** Statuts considérés comme « expédiés » (articles ayant quitté l'entrepôt). */
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
  return overrides?.[code]?.trim() || STATUS_DEFINITIONS[code].label;
}

/**
 * Étape de progression à afficher. Pour un statut hors parcours (retard, info requise),
 * on conserve la dernière étape connue fournie par l'appelant.
 */
export function progressStep(code: StatusCode, lastKnownStep = 0): number | null {
  if (code === "cancelled") return null;
  const step = STATUS_DEFINITIONS[code].step;
  return step ?? lastKnownStep;
}

/** Statuts pour lesquels un colis est encore attendu (utile pour le calcul de retard). */
export function isOpenStatus(code: StatusCode): boolean {
  return !STATUS_DEFINITIONS[code].terminal;
}
