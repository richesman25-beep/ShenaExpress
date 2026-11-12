import { httpsCallable } from "firebase/functions";
import { firebaseState, getFirebaseFunctions } from "./firebase";
import { directBackend, decodeSetupToken } from "./directBackend";
import type {
  StatusCode,
  TransportMode,
  Currency,
  Permission,
  ShipmentDates,
  ChargeLine,
  PublicSettingsDoc,
  PrivateSettingsDoc,
} from "@shared/index";

/** Traduit toute erreur Firebase (Auth, Firestore ou Functions) en message français clair pour l'utilisateur. */
export function formatError(err: unknown): string {
  if (!err) return "Une erreur inattendue est survenue.";
  const code = (err as { code?: string }).code ?? "";
  const message = ((err as { message?: string }).message ?? "").trim();

  if (code.includes("configuration-not-found") || message.includes("CONFIGURATION_NOT_FOUND")) {
    return "Firebase Authentication (Adresse e-mail / Mot de passe) n'est pas encore activé dans la Console Firebase de votre projet (creo-store). Activez-le dans Console Firebase > Authentication > Sign-in method.";
  }
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "Identifiant ou mot de passe incorrect.";
  }
  if (code.includes("user-disabled")) {
    return "Ce compte est désactivé. Contactez SHENA Express.";
  }
  if (code.includes("too-many-requests") || code.includes("resource-exhausted")) {
    return message && !message.startsWith("Firebase") ? message : "Trop de tentatives. Veuillez patienter quelques minutes avant de réessayer.";
  }
  if (/^internal(\s*\[\d+\])?$/i.test(message) || code === "functions/internal") {
    return "Le service Cloud Functions n'est pas joignable ou la base Cloud Firestore n'est pas encore activée dans la Console Firebase (creo-store).";
  }
  if (code.includes("network-request-failed") || code.includes("unavailable")) {
    return "Connexion au serveur impossible. Vérifiez votre accès Internet.";
  }
  if (code.includes("permission-denied")) {
    return message && !message.startsWith("Firebase") && !message.includes("Missing or insufficient")
      ? message
      : "Accès refusé : vous n'avez pas les permissions requises (ou les règles Firestore doivent être publiées dans la Console Firebase).";
  }
  if (code.includes("unauthenticated")) {
    return message && !message.startsWith("Firebase") ? message : "Identifiant ou mot de passe incorrect.";
  }
  if (message && !message.startsWith("Firebase:") && !/^internal(\s*\[\d+\])?$/i.test(message)) {
    return message;
  }
  return "Opération impossible. Vérifiez les informations saisies et réessayez.";
}

function call<Req, Res>(name: string, directFn?: (payload: Req) => Promise<Res>) {
  return async (payload: Req): Promise<Res> => {
    // En production (sans émulateur), utilise directement le backend Firebase (Auth REST + Firestore)
    // si disponible pour éviter les erreurs CORS / "internal [0]" lorsque Cloud Functions n'est pas déployé.
    if (firebaseState.mode === "production" && directFn) {
      return directFn(payload);
    }
    try {
      const fn = httpsCallable<Req, Res>(getFirebaseFunctions(), name);
      const res = await fn(payload);
      return res.data;
    } catch (err) {
      const msg = ((err as { message?: string })?.message ?? "").trim();
      const code = (err as { code?: string })?.code ?? "";
      if (directFn && (/^internal(\s*\[\d+\])?$/i.test(msg) || code === "functions/internal" || code === "functions/not-found")) {
        return directFn(payload);
      }
      throw err;
    }
  };
}

export const api = {
  clientSignIn: call<{ identifier: string; password: string }, { token: string }>("clientSignIn"),
  requestPasswordReset: call<{ identifier: string }, { ok: boolean }>("requestPasswordReset", async () => ({ ok: true })),
  verifyPasswordSetupToken: call<{ oobCode: string }, { valid: boolean; clientId: string; fullName: string }>(
    "verifyPasswordSetupToken",
    (p) => {
      if (decodeSetupToken(p.oobCode)) {
        return directBackend.verifyPasswordSetupToken(p.oobCode);
      }
      return httpsCallable<{ oobCode: string }, { valid: boolean; clientId: string; fullName: string }>(
        getFirebaseFunctions(),
        "verifyPasswordSetupToken",
      )(p).then((r) => r.data);
    },
  ),
  completePasswordSetup: call<{ oobCode: string; newPassword: string }, { ok: boolean; clientId: string }>(
    "completePasswordSetup",
    (p) => {
      if (decodeSetupToken(p.oobCode)) {
        return directBackend.completePasswordSetup(p);
      }
      return httpsCallable<{ oobCode: string; newPassword: string }, { ok: boolean; clientId: string }>(
        getFirebaseFunctions(),
        "completePasswordSetup",
      )(p).then((r) => r.data);
    },
  ),

  createClient: call<
    {
      clientId?: string | null;
      fullName: string;
      phone: string;
      whatsapp?: string | null;
      email?: string | null;
      address?: string | null;
      city?: string | null;
      notes?: string | null;
      sendInvite?: boolean;
    },
    { clientId: string; setupLink: string; inviteSent: boolean }
  >("createClient", (p) => directBackend.createClient(p)),

  updateClient: call<
    {
      clientId: string;
      fullName: string;
      phone: string;
      whatsapp?: string | null;
      email?: string | null;
      address?: string | null;
      city?: string | null;
    },
    { ok: boolean }
  >("updateClient", (p) => directBackend.updateClient(p)),

  setClientStatus: call<{ clientId: string; active: boolean }, { ok: boolean }>(
    "setClientStatus",
    (p) => directBackend.setClientStatus(p),
  ),
  sendClientInvite: call<{ clientId: string }, { sent: boolean; emulated?: boolean; link?: string }>(
    "sendClientInvite",
    (p) => directBackend.sendClientInvite(p),
  ),
  generateClientAccessLink: call<{ clientId: string }, { link: string }>(
    "generateClientAccessLink",
    (p) => directBackend.regenerateClientSetupLink(p, false),
  ),
  resetClientPassword: call<{ clientId: string }, { link: string }>(
    "resetClientPassword",
    (p) => directBackend.regenerateClientSetupLink(p, true),
  ),
  saveClientNotes: call<{ clientId: string; notes: string }, { ok: boolean }>(
    "saveClientNotes",
    (p) => directBackend.saveClientNotes(p),
  ),

  createOrder: call<
    {
      clientId: string;
      merchant?: string | null;
      merchantOrderRef?: string | null;
      orderDate: string;
      currency: Currency;
      transportMode?: TransportMode | null;
      publicNote?: string | null;
      internalNotes?: string | null;
      items: {
        lineId?: string;
        description: string;
        merchantRef?: string | null;
        quantityOrdered: number;
        declaredUnitValue?: number | null;
      }[];
    },
    { orderId: string }
  >("createOrder", (p) => directBackend.createOrder(p)),

  updateOrder: call<
    {
      orderId: string;
      merchant?: string | null;
      merchantOrderRef?: string | null;
      orderDate: string;
      currency: Currency;
      transportMode?: TransportMode | null;
      publicNote?: string | null;
      internalNotes?: string | null;
      items: {
        lineId?: string;
        description: string;
        merchantRef?: string | null;
        quantityOrdered: number;
        declaredUnitValue?: number | null;
      }[];
    },
    { ok: boolean }
  >("updateOrder", (p) => directBackend.updateOrder(p)),

  recordReceipt: call<
    {
      orderId: string;
      lines: { lineId: string; quantityReceived: number }[];
      publicNote?: string | null;
    },
    { ok: boolean }
  >("recordReceipt", (p) => directBackend.recordReceipt(p)),

  createShipment: call<
    {
      clientId: string;
      trackingNumber?: string | null;
      transportMode: TransportMode;
      weightKg?: number | null;
      dimensionsCm?: { length: number; width: number; height: number } | null;
      lines: { orderId: string; lineId: string; quantity: number }[];
      dates: ShipmentDates;
      dateChangeMessage?: string | null;
      pickupInstructions?: string | null;
      internalNotes?: string | null;
    },
    { shipmentId: string }
  >("createShipment", (p) => directBackend.createShipment(p)),

  updateShipment: call<
    {
      shipmentId: string;
      trackingNumber?: string | null;
      transportMode: TransportMode;
      weightKg?: number | null;
      dimensionsCm?: { length: number; width: number; height: number } | null;
      lines: { orderId: string; lineId: string; quantity: number }[];
      dates: ShipmentDates;
      dateChangeMessage?: string | null;
      pickupInstructions?: string | null;
      internalNotes?: string | null;
    },
    { ok: boolean }
  >("updateShipment", (p) => directBackend.updateShipment(p)),

  updateStatus: call<
    {
      targetType: "order" | "shipment";
      targetId: string;
      status: StatusCode;
      publicNote?: string | null;
      internalNote?: string | null;
    },
    { ok: boolean }
  >("updateStatus", (p) => directBackend.updateStatus(p)),

  setOrderCharges: call<{ orderId: string; charges: ChargeLine[] }, { ok: boolean }>(
    "setOrderCharges",
    (p) => directBackend.setOrderCharges(p),
  ),
  recordPayment: call<
    {
      orderId: string;
      amount: number;
      currency: Currency;
      method: "cash" | "transfer" | "moncash" | "natcash" | "card" | "other";
      reference?: string | null;
      receivedOn: string;
    },
    { paymentId: string }
  >("recordPayment", (p) => directBackend.recordPayment(p)),
  voidPayment: call<{ paymentId: string; reason: string }, { ok: boolean }>(
    "voidPayment",
    (p) => directBackend.voidPayment(p),
  ),

  updateSettings: call<
    {
      publicSettings: Omit<PublicSettingsDoc, "isExample" | "updatedAt">;
      privateSettings: Omit<PrivateSettingsDoc, "updatedAt">;
    },
    { ok: boolean }
  >("updateSettings", (p) => directBackend.updateSettings(p)),

  setStaffRole: call<
    {
      email: string;
      role: "admin" | "staff" | "none";
      permissions: Permission[];
      displayName?: string | null;
    },
    { uid: string; created: boolean }
  >("setStaffRole"),
};
