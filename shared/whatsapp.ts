/** Normalise un numéro WhatsApp international : chiffres uniquement, 8 à 15 chiffres (E.164 sans « + »). */
export function normalizeWhatsappNumber(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/[^\d]/g, "");
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return null;
  return digits;
}

export interface WhatsappContext {
  orderId?: string | null;
  trackingNumber?: string | null;
  clientId?: string | null;
  companyName?: string;
}

/**
 * Message prérempli. Ne contient que des références logistiques (aucune donnée sensible :
 * pas d'adresse, de téléphone, de montant ni d'e-mail).
 */
export function buildWhatsappMessage(ctx: WhatsappContext): string {
  const company = ctx.companyName?.trim() || "SHENA Express";
  let msg = `Bonjour ${company}, je souhaite obtenir des informations`;
  msg += ctx.orderId ? ` sur ma commande ${ctx.orderId}` : " sur mes envois";
  if (ctx.trackingNumber) msg += `, concernant le colis ${ctx.trackingNumber}`;
  msg += ".";
  if (ctx.clientId) msg += ` Mon identifiant client est ${ctx.clientId}.`;
  return msg;
}

/** Lien wa.me officiel. Le client peut modifier le texte dans WhatsApp avant de l'envoyer. */
export function buildWhatsappUrl(number: string | null | undefined, message: string): string | null {
  const n = normalizeWhatsappNumber(number);
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(message)}`;
}
