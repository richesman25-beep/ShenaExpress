import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "./firebase";
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

/** Traduit toute erreur Firebase (Auth ou Functions) en message français clair pour l'utilisateur. */
export function formatError(err: unknown): string {
  if (!err) return "Une erreur inattendue est survenue.";
  const code = (err as { code?: string }).code ?? "";
  const message = (err as { message?: string }).message ?? "";

  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "Identifiant ou mot de passe incorrect.";
  }
  if (code.includes("user-disabled")) {
    return "Ce compte est désactivé. Contactez SHENA Express.";
  }
  if (code.includes("too-many-requests") || code.includes("resource-exhausted")) {
    return message && !message.startsWith("Firebase") ? message : "Trop de tentatives. Veuillez patienter quelques minutes avant de réessayer.";
  }
  if (code.includes("network-request-failed") || code.includes("unavailable")) {
    return "Connexion au serveur impossible. Vérifiez votre accès Internet (ou que les émulateurs sont démarrés en mode démo).";
  }
  if (code.includes("permission-denied")) {
    return message && !message.startsWith("Firebase") && !message.includes("Missing or insufficient")
      ? message
      : "Accès refusé : vous n'avez pas les permissions requises.";
  }
  if (code.includes("unauthenticated")) {
    return message && !message.startsWith("Firebase") ? message : "Identifiant ou mot de passe incorrect.";
  }
  if (message && !message.startsWith("Firebase:")) {
    return message;
  }
  return "Opération impossible. Vérifiez les informations saisies et réessayez.";
}

function call<Req, Res>(name: string) {
  return async (payload: Req): Promise<Res> => {
    const fn = httpsCallable<Req, Res>(getFirebaseFunctions(), name);
    const res = await fn(payload);
    return res.data;
  };
}

export const api = {
  clientSignIn: call<{ identifier: string; password: string }, { token: string }>("clientSignIn"),
  requestPasswordReset: call<{ identifier: string }, { ok: boolean }>("requestPasswordReset"),
  verifyPasswordSetupToken: call<{ oobCode: string }, { valid: boolean; clientId: string; fullName: string }>(
    "verifyPasswordSetupToken",
  ),
  completePasswordSetup: call<{ oobCode: string; newPassword: string }, { ok: boolean; clientId: string }>(
    "completePasswordSetup",
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
  >("createClient"),

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
  >("updateClient"),

  setClientStatus: call<{ clientId: string; active: boolean }, { ok: boolean }>("setClientStatus"),
  sendClientInvite: call<{ clientId: string }, { sent: boolean; emulated?: boolean; link?: string }>("sendClientInvite"),
  generateClientAccessLink: call<{ clientId: string }, { link: string }>("generateClientAccessLink"),
  resetClientPassword: call<{ clientId: string }, { link: string }>("resetClientPassword"),
  saveClientNotes: call<{ clientId: string; notes: string }, { ok: boolean }>("saveClientNotes"),

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
  >("createOrder"),

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
  >("updateOrder"),

  recordReceipt: call<
    {
      orderId: string;
      lines: { lineId: string; quantityReceived: number }[];
      publicNote?: string | null;
    },
    { ok: boolean }
  >("recordReceipt"),

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
  >("createShipment"),

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
  >("updateShipment"),

  updateStatus: call<
    {
      targetType: "order" | "shipment";
      targetId: string;
      status: StatusCode;
      publicNote?: string | null;
      internalNote?: string | null;
    },
    { ok: boolean }
  >("updateStatus"),

  setOrderCharges: call<{ orderId: string; charges: ChargeLine[] }, { ok: boolean }>("setOrderCharges"),
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
  >("recordPayment"),
  voidPayment: call<{ paymentId: string; reason: string }, { ok: boolean }>("voidPayment"),

  updateSettings: call<
    {
      publicSettings: Omit<PublicSettingsDoc, "isExample" | "updatedAt">;
      privateSettings: Omit<PrivateSettingsDoc, "updatedAt">;
    },
    { ok: boolean }
  >("updateSettings"),

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
