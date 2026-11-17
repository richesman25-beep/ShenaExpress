#!/usr/bin/env node
/** Sans --apply : audit seulement. Ne modifie jamais un colis existant. */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const args = process.argv.slice(2),
  project = args[args.indexOf("--project") + 1],
  apply = args.includes("--apply");
if (!args.includes("--project") || !project || !/^[a-z0-9-]+$/.test(project))
  throw Error(
    "Indiquez --project <identifiant>. Sans --apply, aucune écriture.",
  );
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
if (
  emulator &&
  (!project.startsWith("demo-") ||
    !/^(127\.0\.0\.1|localhost):\d+$/.test(emulator))
)
  throw Error("Émulateur : projet demo-* et adresse locale obligatoires.");
const auth = require("firebase-tools/lib/auth");
const { requireAuth } = require("firebase-tools/lib/requireAuth");
const { Client } = require("firebase-tools/lib/apiv2");
const { firestoreOrigin } = require("firebase-tools/lib/api");
if (!emulator) {
  const account = auth.getGlobalDefaultAccount();
  await requireAuth({
    project,
    ...(account ? { user: account.user, tokens: account.tokens } : {}),
  });
}
const api = new Client({
  urlPrefix: emulator ? "http://" + emulator : firestoreOrigin(),
  apiVersion: "v1",
  auth: !emulator,
});
const base = `projects/${project}/databases/(default)/documents`;
const post = async (path, data) => {
  if (emulator) {
    // Le client CLI n’applique pas NO_PROXY. Les émulateurs locaux utilisent leur jeton propriétaire standard.
    const response = await fetch(`http://${emulator}/v1/${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer owner",
      },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok)
      throw Error(result.error?.message ?? `Émulateur HTTP ${response.status}`);
    return result;
  }
  return (
    await api.post(base + path, data, {
      skipLog: { reqBody: true, resBody: true },
    })
  ).body;
};
const numberOf = (id) =>
  /^SHE-PKG-\d{6,}$/.test(id) ? Number(id.slice(8)) : 0;
function integerField(field) {
  const raw = field?.integerValue ?? field?.doubleValue;
  const value = raw === undefined ? NaN : Number(raw);
  if (!Number.isSafeInteger(value) || value < 0)
    throw Error("Numéro/compteur invalide : arrêt sans écriture.");
  return value;
}
async function inspect(transaction) {
  const options = transaction ? { transaction } : {};
  const counter = (
    await post(":batchGet", {
      documents: [base + "/counters/packages"],
      ...options,
    })
  ).find((r) => r.found)?.found;
  const query = async (collectionId, fields) =>
    (
      await post(":runQuery", {
        structuredQuery: {
          from: [{ collectionId }],
          select: { fields: fields.map((fieldPath) => ({ fieldPath })) },
        },
        ...options,
      })
    )
      .filter((r) => r.document)
      .map((r) => r.document);
  const shipments = await query("shipments", [
    "shipmentId",
    "orderIds",
    "packageSequence",
  ]);
  const reservations = await query("packageNumbers", ["sequence"]);
  const value = counter ? integerField(counter.fields?.value) : 0;
  const values = [
    value,
    ...shipments.map((d) => numberOf(d.name.split("/").at(-1))),
    ...reservations.map((d) => integerField(d.fields?.sequence)),
  ];
  if (values.some((n) => !Number.isSafeInteger(n) || n < 0))
    throw Error("Numéro/compteur invalide : arrêt sans écriture.");
  const highWater = values.reduce((max, n) => Math.max(max, n), 0);
  if (highWater >= Number.MAX_SAFE_INTEGER)
    throw Error("Compteur épuisé : arrêt sans écriture.");
  return {
    counterExists: !!counter,
    current: value,
    highWater,
    next: `SHE-PKG-${String(highWater + 1).padStart(6, "0")}`,
    legacyCount: shipments.filter((d) => !numberOf(d.name.split("/").at(-1)))
      .length,
    newFormatCount: shipments.filter((d) => numberOf(d.name.split("/").at(-1)))
      .length,
    reservedCount: reservations.length,
    orphans: shipments
      .filter((d) => !d.fields?.orderIds?.arrayValue?.values?.length)
      .map((d) => d.name.split("/").at(-1)),
  };
}
try {
  let report;
  if (!apply) report = await inspect();
  else {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { transaction } = await post(":beginTransaction", {
        options: { readWrite: {} },
      });
      try {
        report = await inspect(transaction);
        await post(":commit", {
          transaction,
          writes: [
            {
              update: {
                name: base + "/counters/packages",
                fields: {
                  value: { integerValue: String(report.highWater) },
                  migrationVersion: { integerValue: "1" },
                },
              },
              updateMask: { fieldPaths: ["value", "migrationVersion"] },
              updateTransforms: [
                { fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" },
              ],
            },
          ],
        });
        break;
      } catch (error) {
        await post(":rollback", { transaction }).catch(() => {});
        if (attempt === 4 || !/ABORTED|conflict|409/i.test(error.message))
          throw error;
      }
    }
  }
  console.log(
    JSON.stringify(
      {
        project,
        mode: apply ? "compteur initialisé ou conservé" : "audit sans écriture",
        ...report,
        existingPackagesModified: 0,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
