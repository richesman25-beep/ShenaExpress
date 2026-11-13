import type { StatusCode } from "./statuses.js";
import type { Permission, Role } from "./permissions.js";

/** Compatible avec Timestamp du SDK web et du SDK Admin. */
export interface FireTime {
  toMillis(): number;
  toDate(): Date;
}

/** Date métier au format ISO AAAA-MM-JJ (estimations, sans fuseau horaire). */
export type IsoDate = string;

export type TransportMode = "air" | "sea";
export const TRANSPORT_LABELS: Record<TransportMode, string> = { air: "Aérien", sea: "Maritime" };

export type Currency = "USD" | "HTG";
export const CURRENCIES: readonly Currency[] = ["USD", "HTG"];

/* ------------------------------------------------------------------ users */
/** users/{uid} — écrit uniquement par le serveur. */
export interface UserDoc {
  uid: string;
  role: Role;
  permissions?: Permission[];
  clientId?: string | null;
  displayName: string;
  email?: string | null;
  disabled: boolean;
  createdAt: FireTime;
  updatedAt: FireTime;
}

/* ---------------------------------------------------------------- clients */
export type AccountStatus = "active" | "disabled";
export type ClientAccessState = "pending_setup" | "active" | "disabled";

/** clients/{clientId} — lisible par le client propriétaire et le personnel autorisé. */
export interface ClientDoc {
  clientId: string; // ex. SHE-CLIENT-001 ou SHENA-0001
  clientUid: string; // uid Firebase Auth du propriétaire
  fullName: string;
  phone: string;
  whatsapp?: string | null;
  email?: string | null;
  /** true si l'adresse e-mail appartient réellement au client (pas une adresse technique). */
  hasRealEmail: boolean;
  address?: string | null;
  city?: string | null;
  status: AccountStatus;
  /** true dès que le client a défini son mot de passe personnel. */
  passwordConfigured?: boolean;
  /** Mots-clés normalisés pour la recherche (identifiant, nom, téléphone). */
  searchTokens: string[];
  createdAt: FireTime;
  updatedAt: FireTime;
}

export function getClientAccessState(client: Pick<ClientDoc, "status" | "passwordConfigured">): ClientAccessState {
  if (client.status === "disabled") return "disabled";
  if (client.passwordConfigured === false) return "pending_setup";
  return "active";
}

export const CLIENT_ACCESS_LABELS: Record<ClientAccessState, string> = {
  pending_setup: "En attente de configuration",
  active: "Actif",
  disabled: "Désactivé",
};

/** clientNotes/{clientId} — notes privées, jamais lisibles par le client. */
export interface ClientNotesDoc {
  clientId: string;
  notes: string;
  updatedAt: FireTime;
  updatedBy: string;
}

/* ----------------------------------------------------------------- orders */
export interface OrderItem {
  lineId: string;
  description: string;
  merchantRef?: string | null;
  quantityOrdered: number;
  /** Quantité réellement reçue à l'entrepôt (saisie explicite, jamais déduite). */
  quantityReceived: number;
  /** Valeur déclarée unitaire en unités mineures (centimes), optionnelle. */
  declaredUnitValue?: number | null;
}

export interface OrderStats {
  ordered: number;
  received: number;
  /** Quantité placée dans des colis non annulés. */
  packed: number;
  /** Quantité dans des colis ayant quitté l'entrepôt. */
  shipped: number;
  delivered: number;
  shipmentCount: number;
}

/** orders/{orderId} — visible par le client propriétaire (sans notes privées). */
export interface OrderDoc {
  orderId: string; // ex. SHE-CMD-2026-00001
  clientId: string;
  clientUid: string;
  clientName: string;
  merchant?: string | null;
  merchantOrderRef?: string | null;
  orderDate: IsoDate;
  items: OrderItem[];
  currency: Currency;
  status: StatusCode;
  transportMode?: TransportMode | null;
  stats: OrderStats;
  shipmentIds: string[];
  /** Mots-clés de recherche : référence, client, numéros de suivi. */
  searchTokens: string[];
  publicNote?: string | null;
  createdAt: FireTime;
  updatedAt: FireTime;
}

/** orderPrivate/{orderId} — notes internes (personnel uniquement). */
export interface OrderPrivateDoc {
  orderId: string;
  internalNotes: string;
  updatedAt: FireTime;
  updatedBy: string;
}

/* -------------------------------------------------------------- shipments */
export interface ShipmentLine {
  orderId: string;
  lineId: string;
  description: string;
  quantity: number;
}

export interface ShipmentDates {
  warehouseReceivedAt?: IsoDate | null;
  estimatedDeparture?: IsoDate | null;
  shippedAt?: IsoDate | null;
  estimatedArrival?: IsoDate | null;
  deliveryWindowStart?: IsoDate | null;
  deliveryWindowEnd?: IsoDate | null;
  availableAt?: IsoDate | null;
  deliveredAt?: IsoDate | null;
}

export interface ShipmentDoc {
  shipmentId: string; // ex. SHE-COLIS-2026-00001
  trackingNumber: string;
  clientId: string;
  clientUid: string;
  orderIds: string[];
  lines: ShipmentLine[];
  itemCount: number;
  weightKg?: number | null;
  /** Poids réel en livres (lb) enregistré après pesée physique à Miami ; null avant pesée. */
  actualWeightLb?: number | null;
  /** Tarif par livre en centimes USD appliqué au moment de la pesée (ex. 600 = 6,00 USD/lb). */
  ratePerLbCents?: number | null;
  /** Frais de livraison calculés côté serveur en centimes USD ; null avant pesée. */
  shippingFeeCents?: number | null;
  shippingCurrency?: "USD";
  /** Statut du paiement des frais de livraison (indépendant du statut logistique). */
  shippingPaymentStatus?: ShippingPaymentStatus | null;
  /** Montant effectivement payé en centimes USD (conservé même en cas de correction de poids). */
  paidAmountCents?: number | null;
  miamiReceivedAt?: string | null;
  weighedAt?: string | null;
  weighedByUid?: string | null;
  weightHistory?: WeightCorrectionEntry[];
  orderConfirmedAt?: string | null;
  preparingAt?: string | null;
  inTransitAt?: string | null;
  arrivedHaitiAt?: string | null;
  readyForDeliveryAt?: string | null;
  deliveredAt?: string | null;
  dimensionsCm?: { length: number; width: number; height: number } | null;
  transportMode: TransportMode;
  status: StatusCode;
  /** Dernière étape de progression atteinte (pour les statuts hors parcours). */
  lastStep: number;
  dates: ShipmentDates;
  /** Message public lié à la dernière modification de date (ex. retard). */
  dateChangeMessage?: string | null;
  /** Instructions de retrait / livraison visibles par le client. */
  pickupInstructions?: string | null;
  createdAt: FireTime;
  updatedAt: FireTime;
}

export interface ShipmentPrivateDoc {
  shipmentId: string;
  internalNotes: string;
  updatedAt: FireTime;
  updatedBy: string;
}

/* ---------------------------------------------------------------- events */
export type EventKind = "status" | "dates" | "created" | "receipt";

/** shipmentEvents/{id} — chronologie visible par le client (aucune note interne). */
export interface TrackingEventDoc {
  kind: EventKind;
  targetType: "order" | "shipment";
  orderId?: string | null;
  shipmentId?: string | null;
  clientUid: string;
  fromStatus?: StatusCode | null;
  toStatus?: StatusCode | null;
  publicNote?: string | null;
  /** Champs de dates modifiés : { champ: [ancienne, nouvelle] }. */
  dateChanges?: Record<string, [IsoDate | null, IsoDate | null]> | null;
  actorUid: string;
  actorRole: Role;
  at: FireTime;
}

/* ---------------------------------------------------------- notifications */
export type NotificationType =
  | "order_created"
  | "shipment_received"
  | "shipment_shipped"
  | "eta_changed"
  | "arrived_haiti"
  | "available"
  | "delivered"
  | "status_changed";

export interface NotificationDoc {
  recipientUid: string;
  type: NotificationType;
  title: string;
  body: string;
  orderId?: string | null;
  shipmentId?: string | null;
  createdAt: FireTime;
  readAt?: FireTime | null;
  /** Canaux réellement utilisés (in_app toujours ; email si envoyé à une adresse vérifiée). */
  channels: ("in_app" | "email")[];
}

/* ---------------------------------------------------------------- finance */
export type ChargeKind = "transport" | "extra" | "discount";
export interface ChargeLine {
  id: string;
  kind: ChargeKind;
  label: string;
  /** Montant positif en unités mineures ; les réductions sont soustraites. */
  amount: number;
}

export type PaymentStatus = "none" | "unpaid" | "partial" | "paid" | "overpaid";

export type ShippingPaymentStatus =
  | "unpaid"
  | "pending_verification"
  | "paid"
  | "refunded"
  | "adjustment_required";

export interface WeightCorrectionEntry {
  previousWeightLb: number | null;
  newWeightLb: number;
  previousFeeCents: number | null;
  newFeeCents: number;
  ratePerLbCents: number;
  reason: string;
  recordedAt: string;
  recordedByUid: string;
  recordedByEmail?: string | null;
}

/** orderFinance/{orderId} — lisible par le client seulement si le module financier est activé. */
export interface OrderFinanceDoc {
  orderId: string;
  clientUid: string;
  clientId: string;
  currency: Currency;
  charges: ChargeLine[];
  totalDue: number;
  totalPaid: number;
  balance: number;
  paymentStatus: PaymentStatus;
  updatedAt: FireTime;
}

/** paymentRecords/{id} — paiements enregistrés manuellement (aucun paiement en ligne). */
export interface PaymentRecordDoc {
  orderId: string;
  clientUid: string;
  clientId: string;
  amount: number;
  currency: Currency;
  method: "cash" | "transfer" | "moncash" | "natcash" | "card" | "other";
  reference?: string | null;
  receivedOn: IsoDate;
  voided: boolean;
  voidReason?: string | null;
  recordedBy: string;
  createdAt: FireTime;
}

/* --------------------------------------------------------------- settings */
/** settings/public — informations d'entreprise lisibles par tous (page de connexion, WhatsApp). */
export interface PublicSettingsDoc {
  companyName: string;
  logoUrl?: string | null;
  whatsappNumber?: string | null; // format international, chiffres uniquement
  contactEmail?: string | null;
  address?: string | null;
  serviceArea?: string | null;
  currency: Currency;
  openingHours?: string | null;
  serviceMessage?: string | null;
  pickupInstructions?: string | null;
  modules: { finance: boolean };
  statusLabels?: Partial<Record<StatusCode, string>>;
  disabledStatuses?: StatusCode[];
  /** true si les valeurs sont des exemples de démonstration. */
  isExample?: boolean;
  updatedAt?: FireTime;
}

/** settings/private — paramètres réservés au personnel autorisé. */
export interface PrivateSettingsDoc {
  notifications: {
    inApp: boolean;
    email: boolean;
    events: Partial<Record<NotificationType, boolean>>;
  };
  updatedAt?: FireTime;
}

/* -------------------------------------------------------------------- audit */
export interface AuditLogDoc {
  action: string;
  actorUid: string;
  actorRole: Role;
  targetType: string;
  targetId: string;
  summary: string;
  details?: Record<string, unknown>;
  at: FireTime;
}
