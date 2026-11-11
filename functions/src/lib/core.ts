import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp, type Transaction, type WriteBatch } from "firebase-admin/firestore";
import type { ZodType } from "zod";
import {
  hasPermission,
  zodMessages,
  type AuthClaims,
  type Permission,
  type Role,
  type PublicSettingsDoc,
  type PrivateSettingsDoc,
} from "../../../shared/index.js";

export const db = () => getFirestore();
export { FieldValue, Timestamp };

export interface Actor {
  uid: string;
  role: Role;
  claims: AuthClaims;
}

/** Exige une session authentifiée. */
export function requireAuth(req: CallableRequest<unknown>): Actor {
  if (!req.auth) throw new HttpsError("unauthenticated", "Vous devez être connecté.");
  const token = req.auth.token as Record<string, unknown>;
  const role = token.role as Role | undefined;
  if (!role) throw new HttpsError("permission-denied", "Aucun rôle n'est associé à ce compte.");
  return { uid: req.auth.uid, role, claims: { role, perms: token.perms as Permission[] | undefined, clientId: token.clientId as string | undefined } };
}

/** Vérification serveur des permissions (le SDK Admin contourne les règles Firestore). */
export function requirePermission(req: CallableRequest<unknown>, perm: Permission): Actor {
  const actor = requireAuth(req);
  if (!hasPermission(actor.claims, perm)) {
    throw new HttpsError("permission-denied", "Vous n'avez pas l'autorisation d'effectuer cette action.");
  }
  return actor;
}

export function requireAdmin(req: CallableRequest<unknown>): Actor {
  const actor = requireAuth(req);
  if (actor.role !== "admin") throw new HttpsError("permission-denied", "Action réservée aux administrateurs.");
  return actor;
}

/** Valide la charge utile avec le schéma partagé ; refuse toute donnée invalide. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  if (data === null || typeof data !== "object") throw new HttpsError("invalid-argument", "Requête invalide.");
  if (JSON.stringify(data).length > 200_000) throw new HttpsError("invalid-argument", "Requête trop volumineuse.");
  const result = schema.safeParse(data);
  if (!result.success) {
    const messages = zodMessages(result.error);
    throw new HttpsError("invalid-argument", messages.slice(0, 5).join(" "), { messages });
  }
  return result.data;
}

export function fail(code: "not-found" | "failed-precondition" | "already-exists" | "invalid-argument", message: string): never {
  throw new HttpsError(code, message);
}

/** Journal d'audit des actions administratives importantes. */
export function audit(
  writer: Transaction | WriteBatch,
  actor: Actor,
  action: string,
  targetType: string,
  targetId: string,
  summary: string,
  details?: Record<string, unknown>,
) {
  const ref = db().collection("auditLogs").doc();
  const payload = {
    action,
    actorUid: actor.uid,
    actorRole: actor.role,
    targetType,
    targetId,
    summary,
    details: details ? JSON.parse(JSON.stringify(details)) : null,
    at: FieldValue.serverTimestamp(),
  };
  (writer as Transaction).set(ref, payload);
}

/** Alloue le prochain numéro d'une séquence (jamais réutilisé, même après suppression). */
export async function nextSequence(tx: Transaction, name: string): Promise<number> {
  const ref = db().collection("counters").doc(name);
  const snap = await tx.get(ref);
  const next = ((snap.exists ? (snap.data()?.value as number) : 0) || 0) + 1;
  tx.set(ref, { value: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return next;
}

export const DEFAULT_PUBLIC_SETTINGS: PublicSettingsDoc = {
  companyName: "SHENA Express",
  logoUrl: null,
  whatsappNumber: null,
  contactEmail: null,
  address: null,
  serviceArea: null,
  currency: "USD",
  openingHours: null,
  serviceMessage: null,
  pickupInstructions: null,
  modules: { finance: true },
  statusLabels: {},
  disabledStatuses: [],
};

export const DEFAULT_PRIVATE_SETTINGS: PrivateSettingsDoc = {
  notifications: { inApp: true, email: false, events: {} },
};

export async function loadSettings(tx?: Transaction): Promise<{ pub: PublicSettingsDoc; priv: PrivateSettingsDoc }> {
  const pubRef = db().doc("settings/public");
  const privRef = db().doc("settings/private");
  const [pub, priv] = tx ? await Promise.all([tx.get(pubRef), tx.get(privRef)]) : await Promise.all([pubRef.get(), privRef.get()]);
  return {
    pub: { ...DEFAULT_PUBLIC_SETTINGS, ...(pub.data() as Partial<PublicSettingsDoc> | undefined) },
    priv: { ...DEFAULT_PRIVATE_SETTINGS, ...(priv.data() as Partial<PrivateSettingsDoc> | undefined) },
  };
}

export function appUrl(): string {
  if (isEmulator()) {
    return (process.env.LOCAL_APP_URL || "http://localhost:5173").replace(/\/$/, "");
  }
  return (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
}

export function isEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true";
}

/** Supprime les clés undefined (Firestore les refuse). */
export function clean<T extends Record<string, unknown>>(obj: T): T {
  return JSON.parse(JSON.stringify(obj, (_k, v) => (v === undefined ? null : v))) as T;
}
