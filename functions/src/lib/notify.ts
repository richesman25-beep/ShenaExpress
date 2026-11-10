import { getAuth } from "firebase-admin/auth";
import { notificationDocId, type NotificationType, type PrivateSettingsDoc } from "../../../shared/index.js";
import { db, FieldValue, loadSettings } from "./core.js";

export interface PendingNotification {
  recipientUid: string;
  type: NotificationType;
  title: string;
  body: string;
  orderId?: string | null;
  shipmentId?: string | null;
  /** Discriminant de dédoublonnage (ex. nouveau statut ou nouvelle date). */
  discriminator: string;
}

/**
 * Envoie les notifications APRÈS la validation des écritures métier.
 * - In-app : document notifications/{id déterministe} créé une seule fois (pas de doublon).
 * - E-mail : uniquement si activé dans les paramètres, si l'extension d'envoi est installée
 *   (MAIL_COLLECTION) et si l'adresse du destinataire est réelle ET vérifiée.
 * Aucun envoi WhatsApp automatique : il nécessiterait une intégration officielle (API WhatsApp Business).
 */
export async function dispatchNotifications(items: PendingNotification[], settings?: PrivateSettingsDoc): Promise<void> {
  if (items.length === 0) return;
  const priv = settings ?? (await loadSettings()).priv;
  if (!priv.notifications.inApp && !priv.notifications.email) return;
  for (const n of items) {
    if (priv.notifications.events?.[n.type] === false) continue;
    const id = notificationDocId(n.recipientUid, n.type, n.shipmentId ?? n.orderId ?? "global", n.discriminator);
    const channels: ("in_app" | "email")[] = [];
    let emailTo: string | null = null;
    if (priv.notifications.email && process.env.MAIL_COLLECTION) {
      try {
        const user = await getAuth().getUser(n.recipientUid);
        const clientSnap = await db().collection("clients").where("clientUid", "==", n.recipientUid).limit(1).get();
        const hasRealEmail = clientSnap.empty ? true : clientSnap.docs[0]!.data().hasRealEmail === true;
        if (user.email && user.emailVerified && hasRealEmail && !user.disabled) emailTo = user.email;
      } catch (e) {
        console.error("Notification e-mail : utilisateur introuvable", n.recipientUid, e);
      }
    }
    if (priv.notifications.inApp) channels.push("in_app");
    if (emailTo) channels.push("email");
    if (channels.length === 0) continue;
    try {
      await db()
        .collection("notifications")
        .doc(id)
        .create({
          recipientUid: n.recipientUid,
          type: n.type,
          title: n.title,
          body: n.body,
          orderId: n.orderId ?? null,
          shipmentId: n.shipmentId ?? null,
          createdAt: FieldValue.serverTimestamp(),
          readAt: null,
          channels,
        });
    } catch (e: unknown) {
      // ALREADY_EXISTS (code 6) : notification déjà émise pour cet événement.
      if ((e as { code?: number }).code === 6) continue;
      console.error("Échec de création de notification", e);
      continue;
    }
    if (emailTo) {
      await db()
        .collection(process.env.MAIL_COLLECTION as string)
        .add({
          to: emailTo,
          message: {
            subject: n.title,
            text: `${n.body}\n\nConnectez-vous à votre espace client pour voir le détail.\n`,
          },
          createdAt: FieldValue.serverTimestamp(),
        });
    }
  }
}
