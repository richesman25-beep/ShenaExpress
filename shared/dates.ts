import type { IsoDate, ShipmentDates } from "./types.js";
import { STATUS_DEFINITIONS, type StatusCode } from "./statuses.js";

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string" || !ISO_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Date du jour au format ISO dans le fuseau Haïti (America/Port-au-Prince). */
export function todayIso(now: Date = new Date(), timeZone = "America/Port-au-Prince"): IsoDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function formatIsoDate(value: IsoDate | null | undefined, locale = "fr-FR"): string {
  if (!value || !isIsoDate(value)) return "—";
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export const DATE_FIELD_LABELS: Record<keyof ShipmentDates, string> = {
  warehouseReceivedAt: "Réception à l'entrepôt",
  estimatedDeparture: "Départ estimé",
  shippedAt: "Date d'expédition",
  estimatedArrival: "Arrivée estimée",
  deliveryWindowStart: "Début de la plage de livraison prévue",
  deliveryWindowEnd: "Fin de la plage de livraison prévue",
  availableAt: "Disponible pour retrait à partir du",
  deliveredAt: "Livré le",
};

export const ESTIMATE_FIELDS: readonly (keyof ShipmentDates)[] = [
  "estimatedDeparture",
  "estimatedArrival",
  "deliveryWindowStart",
  "deliveryWindowEnd",
];

export interface RelevantDate {
  field: keyof ShipmentDates;
  label: string;
  value: IsoDate;
  /** true = estimation (jamais une garantie). */
  estimate: boolean;
}

/** Dates les plus pertinentes à montrer au client selon l'étape du transport. */
export function relevantDates(status: StatusCode, dates: ShipmentDates): RelevantDate[] {
  const step = STATUS_DEFINITIONS[status].step;
  const pick = (fields: (keyof ShipmentDates)[]): RelevantDate[] =>
    fields
      .filter((f) => dates[f])
      .map((f) => ({ field: f, label: DATE_FIELD_LABELS[f], value: dates[f] as IsoDate, estimate: ESTIMATE_FIELDS.includes(f) }));

  if (status === "delivered") return pick(["deliveredAt"]);
  if (status === "cancelled") return [];
  if (step === 4) return pick(["availableAt", "deliveryWindowStart", "deliveryWindowEnd"]);
  if (step === 3) return pick(["estimatedArrival", "availableAt", "deliveryWindowStart", "deliveryWindowEnd"]);
  if (step === 2) return pick(["shippedAt", "estimatedArrival", "deliveryWindowStart", "deliveryWindowEnd"]);
  // Avant expédition (ou statut hors parcours) : réception et estimations à venir.
  return pick(["warehouseReceivedAt", "estimatedDeparture", "estimatedArrival", "deliveryWindowStart", "deliveryWindowEnd", "availableAt"]);
}

/**
 * Un colis est en retard si son arrivée (ou fin de plage de livraison) estimée est dépassée
 * alors qu'il n'est ni livré, ni annulé, ni déjà disponible.
 */
export function isLate(status: StatusCode, dates: ShipmentDates, today: IsoDate): boolean {
  if (["delivered", "cancelled", "available", "out_for_delivery"].includes(status)) return false;
  const target = dates.deliveryWindowEnd ?? dates.estimatedArrival;
  return !!target && target < today;
}

/** Calcule les champs de date réellement modifiés. */
export function diffDates(before: ShipmentDates, after: ShipmentDates): Record<string, [IsoDate | null, IsoDate | null]> {
  const changes: Record<string, [IsoDate | null, IsoDate | null]> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof ShipmentDates>;
  for (const k of keys) {
    const a = before[k] ?? null;
    const b = after[k] ?? null;
    if (a !== b) changes[k] = [a, b];
  }
  return changes;
}

/** Vérifie la cohérence chronologique des dates saisies. Retourne la liste des erreurs. */
export function validateDateOrder(d: ShipmentDates): string[] {
  const errors: string[] = [];
  const before = (a: keyof ShipmentDates, b: keyof ShipmentDates, msg: string) => {
    if (d[a] && d[b] && (d[a] as string) > (d[b] as string)) errors.push(msg);
  };
  before("estimatedDeparture", "estimatedArrival", "Le départ estimé doit précéder l'arrivée estimée.");
  before("shippedAt", "deliveredAt", "La date d'expédition doit précéder la livraison.");
  before("deliveryWindowStart", "deliveryWindowEnd", "La plage de livraison est inversée.");
  before("warehouseReceivedAt", "shippedAt", "La réception à l'entrepôt doit précéder l'expédition.");
  return errors;
}
