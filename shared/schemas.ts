import { z } from "zod";
import { STATUS_CODES } from "./statuses.js";
import { PERMISSIONS } from "./permissions.js";
import { isIsoDate } from "./dates.js";
import { CLIENT_ID_RE, ORDER_ID_RE, SHIPMENT_ID_RE } from "./ids.js";

/**
 * Schémas de validation partagés : utilisés par les formulaires (retour immédiat)
 * et, de façon AUTORITAIRE, par les Cloud Functions avant toute écriture.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const trimmed = (max: number) => z.string().trim().max(max, { message: `${max} caractères maximum.` });
const required = (max: number, label: string) =>
  z.string().trim().min(1, { message: `${label} est obligatoire.` }).max(max, { message: `${max} caractères maximum.` });
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: `${max} caractères maximum.` })
    .nullish()
    .transform((v) => (v ? v : null));

export const isoDate = z.string().refine(isIsoDate, { message: "Date invalide (AAAA-MM-JJ)." });
const optionalDate = z
  .union([isoDate, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

export const phoneSchema = z
  .string()
  .trim()
  .min(1, { message: "Le téléphone est obligatoire." })
  .refine((v) => /^\+?[\d\s().-]{7,20}$/.test(v), { message: "Numéro de téléphone invalide." });

const optionalPhone = z
  .string()
  .trim()
  .nullish()
  .refine((v) => !v || /^\+?[\d\s().-]{7,20}$/.test(v), { message: "Numéro invalide." })
  .transform((v) => (v ? v : null));

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .nullish()
  .refine((v) => !v || (EMAIL_RE.test(v) && v.length <= 254), { message: "Adresse e-mail invalide." })
  .transform((v) => (v ? v : null));

export const clientIdSchema = z.string().regex(CLIENT_ID_RE, { message: "Identifiant client invalide." });
export const orderIdSchema = z.string().regex(ORDER_ID_RE, { message: "Numéro de commande invalide." });
export const shipmentIdSchema = z.string().regex(SHIPMENT_ID_RE, { message: "Identifiant de colis invalide." });
export const statusSchema = z.enum(STATUS_CODES);
export const transportSchema = z.enum(["air", "sea"]);
export const currencySchema = z.enum(["USD", "HTG"]);
const qty = z.number().int({ message: "Quantité entière requise." }).min(0).max(100000);
const money = z.number().int({ message: "Montant invalide." }).min(0).max(1_000_000_000);

/* ---------------------------------------------------------------- auth */
export const clientSignInSchema = z.object({
  identifier: required(80, "L'identifiant"),
  password: z.string().min(1, { message: "Le mot de passe est obligatoire." }).max(256),
});
export const passwordResetSchema = z.object({ identifier: required(254, "L'identifiant ou l'e-mail") });

export const verifySetupTokenSchema = z.object({
  oobCode: required(512, "Le code de sécurité"),
});

export const completePasswordSetupSchema = z.object({
  oobCode: required(512, "Le code de sécurité"),
  newPassword: z
    .string()
    .min(8, { message: "Le mot de passe doit contenir au moins 8 caractères." })
    .max(256, { message: "256 caractères maximum." })
    .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), {
      message: "Le mot de passe doit contenir au moins une lettre et un chiffre.",
    }),
});

/* ------------------------------------------------------------- clients */
const optionalCustomClientId = z
  .string()
  .trim()
  .toUpperCase()
  .nullish()
  .refine((v) => !v || CLIENT_ID_RE.test(v), {
    message: "Identifiant client invalide (ex. SHE-CLIENT-001 ou SHENA-0001).",
  })
  .transform((v) => (v ? v : null));

export const clientProfileSchema = z.object({
  fullName: required(120, "Le nom complet"),
  phone: phoneSchema,
  whatsapp: optionalPhone,
  email: optionalEmail,
  address: optionalText(300),
  city: optionalText(80),
});
export type ClientProfileInput = z.input<typeof clientProfileSchema>;

export const createClientSchema = clientProfileSchema.extend({
  clientId: optionalCustomClientId,
  notes: optionalText(4000),
  sendInvite: z.boolean().default(true),
});
export const updateClientSchema = clientProfileSchema.extend({ clientId: clientIdSchema });
export const clientRefSchema = z.object({ clientId: clientIdSchema });
export const setClientStatusSchema = z.object({ clientId: clientIdSchema, active: z.boolean() });
export const clientNotesSchema = z.object({ clientId: clientIdSchema, notes: trimmed(4000) });

/* -------------------------------------------------------------- orders */
export const orderItemInputSchema = z.object({
  lineId: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/).optional(),
  description: required(200, "La description de l'article"),
  merchantRef: optionalText(80),
  quantityOrdered: qty.min(1, { message: "Au moins 1 article." }),
  declaredUnitValue: money.nullish().transform((v) => v ?? null),
});

export const orderBaseSchema = z.object({
  trackingNumber: z
    .string()
    .trim()
    .max(60)
    .refine((v) => v === "" || /^[A-Za-z0-9_-]{3,60}$/.test(v), {
      message: "Numéro de suivi : 3 à 60 caractères (lettres, chiffres, tirets).",
    })
    .nullish()
    .transform((v) => (v ? v.toUpperCase() : null)),
  initialStatus: statusSchema.nullish().transform((v) => v ?? null),
  description: optionalText(300),
  merchant: optionalText(120),
  merchantOrderRef: optionalText(80),
  orderDate: isoDate.optional().default(() => new Date().toISOString().slice(0, 10)),
  currency: currencySchema.optional().default("USD"),
  transportMode: transportSchema.nullish().transform((v) => v ?? null),
  publicNote: optionalText(1000),
  internalNotes: optionalText(4000),
  items: z.array(orderItemInputSchema).max(200).optional().default([]),
});
export const createOrderSchema = orderBaseSchema
  .extend({ clientId: clientIdSchema })
  .refine((d) => d.items.length > 0 || Boolean(d.trackingNumber) || Boolean(d.description), {
    message: "Indiquez un numéro de suivi ou au moins un article.",
  });
export const updateOrderSchema = orderBaseSchema.extend({ orderId: orderIdSchema });

export const recordReceiptSchema = z.object({
  orderId: orderIdSchema,
  lines: z.array(z.object({ lineId: z.string().min(1).max(40), quantityReceived: qty })).min(1).max(200),
  publicNote: optionalText(1000),
});

/* ----------------------------------------------------------- shipments */
export const shipmentDatesSchema = z
  .object({
    warehouseReceivedAt: optionalDate,
    estimatedDeparture: optionalDate,
    shippedAt: optionalDate,
    estimatedArrival: optionalDate,
    deliveryWindowStart: optionalDate,
    deliveryWindowEnd: optionalDate,
    availableAt: optionalDate,
    deliveredAt: optionalDate,
  })
  .optional()
  .default({
    warehouseReceivedAt: null,
    estimatedDeparture: null,
    shippedAt: null,
    estimatedArrival: null,
    deliveryWindowStart: null,
    deliveryWindowEnd: null,
    availableAt: null,
    deliveredAt: null,
  });

const shipmentLineInput = z.object({
  orderId: orderIdSchema,
  lineId: z.string().min(1).max(40),
  quantity: qty.min(1),
});

const dimensions = z
  .object({ length: z.number().positive().max(1000), width: z.number().positive().max(1000), height: z.number().positive().max(1000) })
  .nullish()
  .transform((v) => v ?? null);

export const shipmentBaseSchema = z.object({
  trackingNumber: z
    .string()
    .trim()
    .max(60)
    .refine((v) => v === "" || /^[A-Za-z0-9_-]{3,60}$/.test(v), { message: "Numéro de suivi : lettres, chiffres et tirets." })
    .nullish()
    .transform((v) => (v ? v.toUpperCase() : null)),
  initialStatus: statusSchema.nullish().transform((v) => v ?? null),
  orderRef: optionalText(80),
  description: optionalText(300),
  transportMode: transportSchema.optional().default("air"),
  weightKg: z.number().positive().max(100000).nullish().transform((v) => v ?? null),
  dimensionsCm: dimensions,
  lines: z.array(shipmentLineInput).max(200).optional().default([]),
  dates: shipmentDatesSchema,
  dateChangeMessage: optionalText(500),
  pickupInstructions: optionalText(1000),
  internalNotes: optionalText(4000),
});
export const createShipmentSchema = shipmentBaseSchema.extend({ clientId: clientIdSchema });
export const updateShipmentSchema = shipmentBaseSchema.extend({ shipmentId: shipmentIdSchema });

export const updateStatusSchema = z.object({
  targetType: z.enum(["order", "shipment"]),
  targetId: z.string().min(1).max(40),
  status: statusSchema,
  publicNote: optionalText(1000),
  internalNote: optionalText(2000),
});

export const recordShipmentWeighingSchema = z.object({
  shipmentId: shipmentIdSchema,
  weightLb: z
    .number({ message: "Le poids réel doit être un nombre." })
    .finite({ message: "Poids invalide." })
    .positive({ message: "Le poids doit être strictement supérieur à 0 lb." })
    .max(10000, { message: "Le poids ne peut pas dépasser 10 000 lb." })
    .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, {
      message: "Le poids accepte au maximum 3 décimales (ex. 4,75 lb).",
    }),
  confirmMiamiReceipt: z.boolean().optional().default(false),
  reason: optionalText(300),
});

export const shippingPaymentStatusSchema = z.enum([
  "unpaid",
  "pending_verification",
  "paid",
  "refunded",
  "adjustment_required",
]);

export const updateShippingPaymentSchema = z.object({
  shipmentId: shipmentIdSchema,
  shippingPaymentStatus: shippingPaymentStatusSchema,
  paidAmountCents: z.number().int().min(0).max(1_000_000_000).nullish().transform((v) => v ?? null),
  note: optionalText(300),
});

/* ------------------------------------------------------------- finance */
export const chargeLineSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/).optional(),
  kind: z.enum(["transport", "extra", "discount"]),
  label: required(120, "Le libellé"),
  amount: money,
});
export const setChargesSchema = z.object({
  orderId: orderIdSchema,
  charges: z.array(chargeLineSchema).max(50),
});
export const recordPaymentSchema = z.object({
  orderId: orderIdSchema,
  amount: money.min(1, { message: "Le montant doit être positif." }),
  currency: currencySchema,
  method: z.enum(["cash", "transfer", "moncash", "natcash", "card", "other"]),
  reference: optionalText(120),
  receivedOn: isoDate,
});
export const voidPaymentSchema = z.object({ paymentId: z.string().min(1).max(64), reason: required(300, "Le motif") });

/* ------------------------------------------------------------ settings */
export const publicSettingsSchema = z.object({
  companyName: required(80, "Le nom"),
  logoUrl: z
    .string()
    .trim()
    .nullish()
    .refine((v) => !v || /^https:\/\/[^\s]+$/.test(v) || v.startsWith("/"), { message: "URL HTTPS requise." })
    .transform((v) => (v ? v : null)),
  whatsappNumber: z
    .string()
    .trim()
    .nullish()
    .refine((v) => !v || /^\+?[1-9][\d\s]{7,18}$/.test(v), { message: "Format international requis, ex. +509 XXXX XXXX." })
    .transform((v) => (v ? v.replace(/[^\d]/g, "") : null)),
  contactEmail: optionalEmail,
  address: optionalText(300),
  serviceArea: optionalText(300),
  currency: currencySchema,
  openingHours: optionalText(300),
  serviceMessage: optionalText(500),
  pickupInstructions: optionalText(1000),
  modules: z.object({ finance: z.boolean() }),
  statusLabels: z.record(z.string(), z.string().trim().max(60)).optional().default({}),
  disabledStatuses: z.array(statusSchema).max(15).optional().default([]),
});

export const privateSettingsSchema = z.object({
  notifications: z.object({
    inApp: z.boolean(),
    email: z.boolean(),
    events: z.record(z.string(), z.boolean()).optional().default({}),
  }),
});

export const settingsUpdateSchema = z.object({
  publicSettings: publicSettingsSchema,
  privateSettings: privateSettingsSchema,
});

export const setStaffRoleSchema = z.object({
  email: z.string().trim().toLowerCase().refine((v) => EMAIL_RE.test(v), { message: "Adresse e-mail invalide." }),
  role: z.enum(["admin", "staff", "none"]),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length).default([]),
  displayName: optionalText(120),
});

/** Transforme une erreur Zod en messages lisibles. */
export function zodMessages(error: z.ZodError): string[] {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")} : ${i.message}` : i.message));
}
