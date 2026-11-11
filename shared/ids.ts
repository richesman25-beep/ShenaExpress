/** Formats d'identifiants. Les numéros sont attribués côté serveur via un compteur transactionnel (ou saisis de façon unique) et ne sont jamais réutilisés. */
export const CLIENT_ID_RE = /^(?:SHE-CLIENT-\d{3,}|SHENA-\d{3,}|SHE-[A-Z0-9]{2,}(?:-[A-Z0-9]{1,20})*)$/;
export const ORDER_ID_RE = /^SHE-CMD-\d{4}-\d{5,}$/;
export const SHIPMENT_ID_RE = /^SHE-COLIS-\d{4}-\d{5,}$/;

export function formatClientId(n: number): string {
  return `SHE-CLIENT-${String(n).padStart(3, "0")}`;
}
export function formatOrderId(year: number, n: number): string {
  return `SHE-CMD-${year}-${String(n).padStart(5, "0")}`;
}
export function formatShipmentId(year: number, n: number): string {
  return `SHE-COLIS-${year}-${String(n).padStart(5, "0")}`;
}
/** Numéro de suivi interne par défaut (si aucun numéro transporteur n'est saisi). */
export function defaultTrackingNumber(year: number, n: number): string {
  return `SHX${String(year).slice(2)}${String(n).padStart(6, "0")}`;
}

export function normalizeClientIdentifier(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

/** Normalisation pour la recherche : minuscules, sans accents, alphanumérique. */
export function normalizeSearch(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.+-]+/g, " ")
    .trim();
}

/**
 * Jetons de recherche stockés avec le document (requête Firestore array-contains).
 * Inclut les mots complets et les préfixes (≥ 3 caractères) pour une recherche rapide.
 */
export function buildSearchTokens(...values: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    if (!v) continue;
    const norm = normalizeSearch(v);
    const compact = norm.replace(/\s+/g, "");
    if (compact.length >= 2) out.add(compact);
    const digits = v.replace(/\D/g, "");
    if (digits.length >= 4) {
      out.add(digits);
      if (digits.length > 8) out.add(digits.slice(-8));
    }
    for (const word of norm.split(" ")) {
      if (word.length < 2) continue;
      out.add(word);
      for (let i = 3; i < Math.min(word.length, 12); i++) out.add(word.slice(0, i));
    }
  }
  return [...out].slice(0, 120);
}

export function searchKey(query: string): string {
  const norm = normalizeSearch(query).replace(/\s+/g, "");
  return norm.slice(0, 40);
}
