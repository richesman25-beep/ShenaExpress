import type { Transaction, WriteBatch } from "firebase-admin/firestore";
import type { EventKind, IsoDate, StatusCode } from "../../../shared/index.js";
import { db, FieldValue, type Actor } from "./core.js";

/**
 * Écrit un événement de chronologie (visible par le client propriétaire) et, le cas échéant,
 * la note interne associée dans une collection séparée réservée au personnel.
 */
export function writeEvent(
  writer: Transaction | WriteBatch,
  actor: Actor,
  e: {
    kind: EventKind;
    targetType: "order" | "shipment";
    orderId?: string | null;
    shipmentId?: string | null;
    clientUid: string;
    fromStatus?: StatusCode | null;
    toStatus?: StatusCode | null;
    publicNote?: string | null;
    dateChanges?: Record<string, [IsoDate | null, IsoDate | null]> | null;
    internalNote?: string | null;
  },
): string {
  const ref = db().collection("shipmentEvents").doc();
  (writer as Transaction).set(ref, {
    kind: e.kind,
    targetType: e.targetType,
    orderId: e.orderId ?? null,
    shipmentId: e.shipmentId ?? null,
    clientUid: e.clientUid,
    fromStatus: e.fromStatus ?? null,
    toStatus: e.toStatus ?? null,
    publicNote: e.publicNote ?? null,
    dateChanges: e.dateChanges ?? null,
    actorUid: actor.uid,
    actorRole: actor.role,
    at: FieldValue.serverTimestamp(),
  });
  if (e.internalNote) {
    (writer as Transaction).set(db().collection("shipmentEventsPrivate").doc(ref.id), {
      eventId: ref.id,
      orderId: e.orderId ?? null,
      shipmentId: e.shipmentId ?? null,
      internalNote: e.internalNote,
      actorUid: actor.uid,
      at: FieldValue.serverTimestamp(),
    });
  }
  return ref.id;
}
