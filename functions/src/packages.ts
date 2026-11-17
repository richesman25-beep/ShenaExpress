import { onCall } from "firebase-functions/v2/https";
import {
  addOrderPackageSchema,
  packageTrackingSchema,
  buildSearchTokens,
  buildEmptyOrderPackage,
  formatPackageId,
} from "../../shared/index.js";
import {
  db,
  parse,
  fail,
  requirePermission,
  readTrackingGuard,
  writeTrackingGuard,
  readCreationCounter,
  writeCreationCounter,
  audit,
  FieldValue,
} from "./lib/core.js";
import { loadOrdersWithShipments, deriveOrder } from "./lib/logistics.js";
import { writeEvent } from "./lib/events.js";
import { callableOptions } from "./lib/options.js";

async function assertExternalAvailable(
  tx: FirebaseFirestore.Transaction,
  tracking: string | null,
  exclude?: string,
) {
  if (!tracking) return;
  for (const field of ["externalTrackingNumber", "trackingNumber"]) {
    const matches = await tx.get(
      db().collection("shipments").where(field, "==", tracking),
    );
    if (matches.docs.some((d) => d.id !== exclude))
      fail(
        "already-exists",
        "Ce tracking externe est déjà utilisé par un autre colis.",
      );
  }
}

export const addOrderPackage = onCall(callableOptions(), async (req) => {
  const actor = requirePermission(req, "shipments.write");
  const input = parse(addOrderPackageSchema, req.data);
  return db().runTransaction(async (tx) => {
    const guard = await readTrackingGuard(tx);
    const { orders, shipments } = await loadOrdersWithShipments(tx, [
      input.orderId,
    ]);
    const order = orders.get(input.orderId)!;
    if (order.status === "cancelled")
      fail(
        "failed-precondition",
        "Impossible d’ajouter un colis à une commande annulée.",
      );
    const client = await tx.get(db().doc(`clients/${order.clientId}`));
    if (
      !client.exists ||
      client.data()!.clientUid !== order.clientUid ||
      client.data()!.status !== "active"
    )
      fail(
        "failed-precondition",
        "Association client/commande invalide ou compte désactivé.",
      );
    const counter = await readCreationCounter(tx, "shipments", 0);
    const id = formatPackageId(counter.next);
    const target = await tx.get(db().doc(`shipments/${id}`));
    if (target.exists)
      fail(
        "already-exists",
        "Cet identifiant est déjà utilisé. Aucun colis n’a été remplacé.",
      );
    await assertExternalAvailable(tx, input.externalTrackingNumber);
    const now = FieldValue.serverTimestamp();
    const shipment = buildEmptyOrderPackage(
      order,
      id,
      input.externalTrackingNumber,
      new Date().toISOString(),
    );
    writeCreationCounter(tx, counter);
    tx.create(target.ref, {
      ...shipment,
      searchTokens: [
        id.toLowerCase(),
        ...(input.externalTrackingNumber
          ? [input.externalTrackingNumber.toLowerCase()]
          : []),
      ],
      createdAt: now,
      updatedAt: now,
    });
    shipments.set(id, shipment);
    tx.update(db().doc(`orders/${order.orderId}`), {
      ...deriveOrder(order, shipments.values()),
      updatedAt: now,
    });
    writeEvent(tx, actor, {
      kind: "created",
      targetType: "shipment",
      orderId: order.orderId,
      shipmentId: id,
      clientUid: order.clientUid,
      toStatus: "registered",
      publicNote: `Colis ${id} ajouté à votre commande.`,
    });
    audit(
      tx,
      actor,
      "shipment.add",
      "shipment",
      id,
      `Colis ${id} ajouté à ${order.orderId}`,
      {
        orderId: order.orderId,
        externalTrackingNumber: input.externalTrackingNumber,
      },
    );
    writeTrackingGuard(tx, guard);
    return { shipmentId: id };
  });
});

export const updatePackageTracking = onCall(callableOptions(), async (req) => {
  const actor = requirePermission(req, "shipments.write");
  const input = parse(packageTrackingSchema, req.data);
  await db().runTransaction(async (tx) => {
    const guard = await readTrackingGuard(tx);
    const snap = await tx.get(db().doc(`shipments/${input.shipmentId}`));
    if (!snap.exists) fail("not-found", "Colis introuvable.");
    await assertExternalAvailable(
      tx,
      input.externalTrackingNumber,
      input.shipmentId,
    );
    tx.update(snap.ref, {
      externalTrackingNumber: input.externalTrackingNumber,
      searchTokens: buildSearchTokens(input.shipmentId,input.externalTrackingNumber),
      updatedAt: FieldValue.serverTimestamp(),
    });
    audit(
      tx,
      actor,
      "shipment.external_tracking",
      "shipment",
      snap.id,
      "Tracking externe modifié ; numéro SHENA conservé.",
      {
        before: snap.data()!.externalTrackingNumber ?? null,
        after: input.externalTrackingNumber,
      },
    );
    writeTrackingGuard(tx, guard);
  });
  return { ok: true };
});
