#!/usr/bin/env node
/**
 * SHENA Express — Export / Import JSON chiffrable des collections Firestore
 * (complément aux sauvegardes gérées `gcloud firestore export gs://...`).
 *
 * Usage :
 *   node scripts/backup-firestore.mjs export ./backups/snapshot.json
 *   node scripts/backup-firestore.mjs restore ./backups/snapshot.json
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const [, , mode, filePath] = process.argv;
if (!mode || !filePath || !["export", "restore"].includes(mode)) {
  console.error("Usage : node scripts/backup-firestore.mjs <export|restore> <fichier.json>");
  process.exit(1);
}

initializeApp({
  projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "demo-shena",
});
const db = getFirestore();

const COLLECTIONS = [
  "users",
  "clients",
  "clientNotes",
  "orders",
  "orderPrivate",
  "shipments",
  "shipmentPrivate",
  "shipmentEvents",
  "shipmentEventsPrivate",
  "orderFinance",
  "paymentRecords",
  "notifications",
  "settings",
  "auditLogs",
  "counters",
  "trackingNumbers",
];

function serialize(val) {
  if (val && typeof val.toMillis === "function") {
    return { __ts: val.toMillis() };
  }
  if (Array.isArray(val)) return val.map(serialize);
  if (val && typeof val === "object") {
    return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, serialize(v)]));
  }
  return val;
}

function deserialize(val) {
  if (val && typeof val === "object" && "__ts" in val && Object.keys(val).length === 1) {
    return Timestamp.fromMillis(Number(val.__ts));
  }
  if (Array.isArray(val)) return val.map(deserialize);
  if (val && typeof val === "object") {
    return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, deserialize(v)]));
  }
  return val;
}

if (mode === "export") {
  const dump = { exportedAt: new Date().toISOString(), collections: {} };
  for (const col of COLLECTIONS) {
    const snap = await db.collection(col).get();
    dump.collections[col] = Object.fromEntries(snap.docs.map((d) => [d.id, serialize(d.data())]));
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(dump, null, 2), "utf8");
  console.log(`Sauvegarde écrite dans ${filePath}`);
} else {
  const dump = JSON.parse(readFileSync(filePath, "utf8"));
  for (const [col, docs] of Object.entries(dump.collections || {})) {
    const entries = Object.entries(docs);
    for (let i = 0; i < entries.length; i += 400) {
      const batch = db.batch();
      for (const [id, data] of entries.slice(i, i + 400)) {
        batch.set(db.collection(col).doc(id), deserialize(data));
      }
      await batch.commit();
    }
  }
  console.log(`Restauration terminée depuis ${filePath}`);
}
