/**
 * Rôles et permissions. Les rôles sont portés par des custom claims Firebase Auth
 * attribués EXCLUSIVEMENT côté serveur (Cloud Functions / script d'amorçage).
 */
export const ROLES = ["admin", "staff", "client"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "clients.read",
  "clients.write",
  "orders.read",
  "orders.write",
  "shipments.read",
  "shipments.write",
  "finance.read",
  "finance.write",
  "settings.write",
  "audit.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "clients.read": "Consulter les clients",
  "clients.write": "Créer et modifier les clients",
  "orders.read": "Consulter les commandes",
  "orders.write": "Créer et modifier les commandes",
  "shipments.read": "Consulter les colis",
  "shipments.write": "Créer et modifier les colis et statuts",
  "finance.read": "Consulter les frais et paiements",
  "finance.write": "Enregistrer frais et paiements",
  "settings.write": "Modifier les paramètres",
  "audit.read": "Consulter le journal d'audit",
};

export interface AuthClaims {
  role?: Role;
  perms?: Permission[];
  clientId?: string;
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (PERMISSIONS as readonly string[]).includes(value);
}

/** Vérification unique utilisée par le frontend (affichage) ET les fonctions serveur (autorité). */
export function hasPermission(claims: AuthClaims | null | undefined, perm: Permission): boolean {
  if (!claims) return false;
  if (claims.role === "admin") return true;
  if (claims.role === "staff") return Array.isArray(claims.perms) && claims.perms.includes(perm);
  return false;
}

export function isBackOffice(claims: AuthClaims | null | undefined): boolean {
  return claims?.role === "admin" || claims?.role === "staff";
}
