import type { NotificationType } from "./types.js";
import type { StatusCode } from "./statuses.js";

/** Événements notifiables et correspondance avec les statuts. */
export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  order_created: "Création d'une commande",
  shipment_received: "Réception d'un colis / d'articles",
  shipment_shipped: "Expédition",
  eta_changed: "Modification de la date estimée",
  arrived_haiti: "Arrivée en Haïti",
  available: "Disponibilité pour retrait",
  delivered: "Livraison effectuée",
  status_changed: "Autres changements de statut",
};

export function notificationTypeForStatus(status: StatusCode): NotificationType {
  switch (status) {
    case "received":
    case "partially_received":
      return "shipment_received";
    case "shipped":
      return "shipment_shipped";
    case "arrived_haiti":
      return "arrived_haiti";
    case "available":
      return "available";
    case "delivered":
      return "delivered";
    default:
      return "status_changed";
  }
}

/**
 * Identifiant déterministe de notification : un même événement ne produit jamais deux
 * notifications (écriture idempotente par identifiant de document).
 */
export function notificationDocId(recipientUid: string, type: NotificationType, targetId: string, discriminator: string): string {
  const raw = `${recipientUid}_${type}_${targetId}_${discriminator}`;
  return raw.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 400);
}
