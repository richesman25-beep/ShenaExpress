import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  createClientSchema,
  updateClientSchema,
  setClientStatusSchema,
  clientRefSchema,
  clientNotesSchema,
  createOrderSchema,
  updateOrderSchema,
  recordReceiptSchema,
  createShipmentSchema,
  updateShipmentSchema,
  updateStatusSchema,
  setChargesSchema,
  recordPaymentSchema,
  voidPaymentSchema,
  settingsUpdateSchema,
  completePasswordSetupSchema,
  formatClientId,
  formatOrderId,
  formatShipmentId,
  defaultTrackingNumber,
  buildSearchTokens,
  computeOrderStats,
  validateAllocation,
  progressStep,
  validateDateOrder,
  diffDates,
  totalDue,
  totalPaid,
  balance,
  paymentStatus,
  zodMessages,
  type ClientDoc,
  type OrderDoc,
  type OrderItem,
  type OrderStats,
  type ShipmentDoc,
  type ShipmentLine,
  type ChargeLine,
  type PaymentRecordDoc,
  type StatusCode,
} from "@shared/index";
import { firebaseState, getFirebaseAuth, getFirebaseDb } from "./firebase";

function deriveOrderStatus(current: StatusCode, stats: OrderStats): StatusCode {
  if (["cancelled", "returned", "issue"].includes(current)) return current;
  if (stats.ordered > 0 && stats.delivered >= stats.ordered) return "delivered";
  if (stats.shipped > 0) return current === "registered" || current === "awaiting_receipt" || current === "partially_received" || current === "received" ? "preparing" : current;
  if (stats.received === 0) return current === "registered" ? "registered" : "awaiting_receipt";
  if (stats.received < stats.ordered) return "partially_received";
  return "received";
}

const TECHNICAL_DOMAIN = "clients.shena-express.invalid";
export const technicalClientEmail = (clientId: string, suffix?: string) =>
  `${clientId.toLowerCase()}${suffix ? `.${suffix}` : ""}@${TECHNICAL_DOMAIN}`;

const phoneKey = (phone: string) => phone.replace(/\D/g, "");

function getWebApiKey(): string {
  const appKey = getFirebaseAuth().app.options.apiKey;
  if (appKey) return appKey;
  const key = (import.meta.env?.VITE_FIREBASE_API_KEY as string | undefined)?.trim();
  if (!key) throw new Error("Clé API Firebase manquante (VITE_FIREBASE_API_KEY).");
  return key.replace(/^["']+|["',]+$/g, "");
}

async function identityPost(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${encodeURIComponent(getWebApiKey())}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

function randomSecret(length = 24): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "Shx9";
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

interface DirectSetupPayload {
  c: string; // clientId
  e: string; // authEmail
  k: string; // one-time bootstrap key
  t: number; // timestamp ms
}

function encodeSetupToken(payload: DirectSetupPayload): string {
  const json = JSON.stringify(payload);
  const b64 = btoa(encodeURIComponent(json))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `shx1.${b64}`;
}

export function decodeSetupToken(oobCode: string): DirectSetupPayload | null {
  if (!oobCode.startsWith("shx1.")) return null;
  try {
    const raw = oobCode.slice(5).replace(/-/g, "+").replace(/_/g, "/");
    const padded = raw + "===".slice((raw.length + 3) % 4);
    const json = decodeURIComponent(atob(padded));
    const parsed = JSON.parse(json) as DirectSetupPayload;
    if (!parsed.c || !parsed.e || !parsed.k || typeof parsed.t !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildDirectSetupUrl(oobCode: string, clientId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:5173";
  return `${origin}/definir-mot-de-passe?oobCode=${encodeURIComponent(oobCode)}&clientId=${encodeURIComponent(clientId)}`;
}

function parseInput<T>(schema: { safeParse: (d: unknown) => { success: boolean; data?: T; error?: unknown } }, data: unknown): T {
  const res = schema.safeParse(data);
  if (!res.success) {
    const msgs = zodMessages(res.error as Parameters<typeof zodMessages>[0]);
    throw new Error(msgs.slice(0, 3).join(" "));
  }
  return res.data as T;
}

function requireSignedInStaff(): { uid: string; email: string } {
  const u = getFirebaseAuth().currentUser;
  if (!u) throw new Error("Session expirée. Veuillez vous reconnecter à l'administration.");
  return { uid: u.uid, email: u.email ?? "" };
}

async function withFirestoreCheck<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "";
    const msg = (err as { message?: string })?.message ?? "";
    const projectId = firebaseState.projectId || "shenaexpress-13924";
    if (code === "permission-denied" || msg.includes("Missing or insufficient permissions")) {
      throw new Error(
        `Accès Firestore refusé par les règles de sécurité du projet ${projectId}. Dans Console Firebase > Firestore Database > Règles, publiez le contenu du fichier firestore.rules du projet.`,
        { cause: err },
      );
    }
    if (code === "not-found" || msg.includes("database (default) does not exist") || msg.includes("offline")) {
      throw new Error(
        `La base de données Cloud Firestore n'est pas encore activée sur le projet ${projectId}. Ouvrez Console Firebase > Firestore Database > Créer une base de données.`,
        { cause: err },
      );
    }
    throw err;
  }
}

export const directBackend = {
  async createClient(raw: unknown): Promise<{ clientId: string; setupLink: string; inviteSent: boolean }> {
    const actor = requireSignedInStaff();
    const input = parseInput(createClientSchema, raw);
    const db = getFirebaseDb();

    return withFirestoreCheck(async () => {
      // 1) Vérification des doublons de téléphone
      const dupPhone = await getDocs(
        query(collection(db, "clients"), where("phoneKey", "==", phoneKey(input.phone))),
      );
      if (!dupPhone.empty) {
        throw new Error("Un client avec ce numéro de téléphone existe déjà.");
      }
      if (input.email) {
        const dupEmail = await getDocs(
          query(collection(db, "clients"), where("email", "==", input.email)),
        );
        if (!dupEmail.empty) {
          throw new Error("Un client avec cette adresse e-mail existe déjà.");
        }
      }

      // 2) Réservation de l'identifiant client unique (ex. SHENA-001 ou SHE-CLIENT-001)
      const clientId = await runTransaction(db, async (tx) => {
        if (input.clientId) {
          const existing = await tx.get(doc(db, "clients", input.clientId));
          if (existing.exists()) {
            throw new Error(`L'identifiant client ${input.clientId} est déjà attribué.`);
          }
          return input.clientId;
        }
        const counterRef = doc(db, "counters", "clients");
        const counterSnap = await tx.get(counterRef);
        let next = ((counterSnap.data()?.value as number | undefined) ?? 0) + 1;
        let candidate = formatClientId(next);
        while ((await tx.get(doc(db, "clients", candidate))).exists()) {
          next += 1;
          candidate = formatClientId(next);
        }
        tx.set(counterRef, { value: next, updatedAt: serverTimestamp() }, { merge: true });
        return candidate;
      });

      // 3) Création du compte Firebase Auth avec identifiant technique unique (aucune collision avec l'e-mail admin)
      const bootstrapKey = randomSecret(24);
      let authEmail = technicalClientEmail(clientId);
      let signUp = await identityPost("accounts:signUp", {
        email: authEmail,
        password: bootstrapKey,
        displayName: input.fullName,
        returnSecureToken: true,
      });
      if (!signUp.ok && String((signUp.data.error as { message?: string })?.message) === "EMAIL_EXISTS") {
        authEmail = technicalClientEmail(clientId, Math.random().toString(36).slice(2, 7));
        signUp = await identityPost("accounts:signUp", {
          email: authEmail,
          password: bootstrapKey,
          displayName: input.fullName,
          returnSecureToken: true,
        });
      }
      if (!signUp.ok || typeof signUp.data.localId !== "string") {
        throw new Error("Impossible de créer le compte Firebase Authentication du client.");
      }
      const uid = signUp.data.localId;

      // 4) Écriture atomique du profil Firestore + table de résolution d'identifiant + audit
      const batch = writeBatch(db);
      const now = serverTimestamp();
      batch.set(doc(db, "users", uid), {
        uid,
        role: "client",
        clientId,
        displayName: input.fullName,
        email: input.email,
        disabled: false,
        createdAt: now,
        updatedAt: now,
      });
      batch.set(doc(db, "clients", clientId), {
        clientId,
        clientUid: uid,
        fullName: input.fullName,
        phone: input.phone,
        phoneKey: phoneKey(input.phone),
        whatsapp: input.whatsapp,
        email: input.email,
        hasRealEmail: Boolean(input.email),
        address: input.address,
        city: input.city,
        status: "active",
        passwordConfigured: false,
        searchTokens: buildSearchTokens(
          clientId,
          input.fullName,
          input.phone,
          input.whatsapp,
          input.email,
          input.city,
        ),
        createdAt: now,
        updatedAt: now,
      });
      batch.set(doc(db, "clientAuth", clientId), {
        clientId,
        clientUid: uid,
        authEmail,
        status: "active",
        updatedAt: now,
      });
      batch.set(doc(db, "clientPrivate", clientId), {
        clientId,
        notes: input.notes ?? "",
        updatedAt: now,
        updatedBy: actor.uid,
      });
      batch.set(doc(collection(db, "auditLogs")), {
        action: "client.create",
        actorUid: actor.uid,
        actorRole: "admin",
        targetType: "client",
        targetId: clientId,
        summary: `Création du client ${clientId} (${input.fullName})`,
        details: null,
        at: now,
      });
      await batch.commit();

      const oobCode = encodeSetupToken({
        c: clientId,
        e: authEmail,
        k: bootstrapKey,
        t: Date.now(),
      });
      return {
        clientId,
        setupLink: buildDirectSetupUrl(oobCode, clientId),
        inviteSent: false,
      };
    });
  },

  async updateClient(raw: unknown): Promise<{ ok: boolean }> {
    const actor = requireSignedInStaff();
    const input = parseInput(updateClientSchema, raw);
    const db = getFirebaseDb();
    return withFirestoreCheck(async () => {
      const ref = doc(db, "clients", input.clientId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Client introuvable.");
      const current = snap.data() as ClientDoc;

      const batch = writeBatch(db);
      batch.update(ref, {
        fullName: input.fullName,
        phone: input.phone,
        phoneKey: phoneKey(input.phone),
        whatsapp: input.whatsapp,
        email: input.email,
        hasRealEmail: Boolean(input.email),
        address: input.address,
        city: input.city,
        searchTokens: buildSearchTokens(
          input.clientId,
          input.fullName,
          input.phone,
          input.whatsapp,
          input.email,
          input.city,
        ),
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, "users", current.clientUid), {
        displayName: input.fullName,
        email: input.email,
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(collection(db, "auditLogs")), {
        action: "client.update",
        actorUid: actor.uid,
        actorRole: "admin",
        targetType: "client",
        targetId: input.clientId,
        summary: `Modification du client ${input.clientId}`,
        details: null,
        at: serverTimestamp(),
      });
      await batch.commit();
      return { ok: true };
    });
  },

  async setClientStatus(raw: unknown): Promise<{ ok: boolean }> {
    const actor = requireSignedInStaff();
    const { clientId, active } = parseInput(setClientStatusSchema, raw);
    const db = getFirebaseDb();
    return withFirestoreCheck(async () => {
      const ref = doc(db, "clients", clientId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Client introuvable.");
      const client = snap.data() as ClientDoc;
      const batch = writeBatch(db);
      batch.update(ref, { status: active ? "active" : "disabled", updatedAt: serverTimestamp() });
      batch.update(doc(db, "users", client.clientUid), { disabled: !active, updatedAt: serverTimestamp() });
      batch.set(
        doc(db, "clientAuth", clientId),
        { clientId, status: active ? "active" : "disabled", updatedAt: serverTimestamp() },
        { merge: true },
      );
      batch.set(doc(collection(db, "auditLogs")), {
        action: active ? "client.enable" : "client.disable",
        actorUid: actor.uid,
        actorRole: "admin",
        targetType: "client",
        targetId: clientId,
        summary: `${active ? "Réactivation" : "Désactivation"} de l'accès ${clientId}`,
        details: null,
        at: serverTimestamp(),
      });
      await batch.commit();
      return { ok: true };
    });
  },

  async regenerateClientSetupLink(clientIdInput: unknown, isReset: boolean): Promise<{ link: string }> {
    const actor = requireSignedInStaff();
    const { clientId } = parseInput(clientRefSchema, clientIdInput);
    const db = getFirebaseDb();
    return withFirestoreCheck(async () => {
      const ref = doc(db, "clients", clientId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Client introuvable.");
      const client = snap.data() as ClientDoc;
      if (client.status !== "active") throw new Error("Réactivez d'abord l'accès de ce client.");

      const bootstrapKey = randomSecret(24);
      const suffix = Math.random().toString(36).slice(2, 8);
      const newAuthEmail = technicalClientEmail(clientId, suffix);
      const signUp = await identityPost("accounts:signUp", {
        email: newAuthEmail,
        password: bootstrapKey,
        displayName: client.fullName,
        returnSecureToken: true,
      });
      if (!signUp.ok || typeof signUp.data.localId !== "string") {
        throw new Error("Impossible de régénérer l'accès Firebase Authentication du client.");
      }
      const newUid = signUp.data.localId;
      const oldUid = client.clientUid;

      const batch = writeBatch(db);
      const now = serverTimestamp();
      batch.set(doc(db, "users", newUid), {
        uid: newUid,
        role: "client",
        clientId,
        displayName: client.fullName,
        email: client.email ?? null,
        disabled: false,
        createdAt: now,
        updatedAt: now,
      });
      if (oldUid && oldUid !== newUid) {
        batch.set(doc(db, "users", oldUid), { disabled: true, updatedAt: now }, { merge: true });
      }
      batch.update(ref, {
        clientUid: newUid,
        passwordConfigured: false,
        updatedAt: now,
      });
      batch.set(doc(db, "clientAuth", clientId), {
        clientId,
        clientUid: newUid,
        authEmail: newAuthEmail,
        status: "active",
        updatedAt: now,
      });

      // Mise à jour du propriétaire sur les commandes, colis et finances existants
      const [ordersSnap, shipmentsSnap, finSnap] = await Promise.all([
        getDocs(query(collection(db, "orders"), where("clientId", "==", clientId))),
        getDocs(query(collection(db, "shipments"), where("clientId", "==", clientId))),
        getDocs(query(collection(db, "orderFinance"), where("clientId", "==", clientId))),
      ]);
      for (const d of ordersSnap.docs) batch.update(d.ref, { clientUid: newUid });
      for (const d of shipmentsSnap.docs) batch.update(d.ref, { clientUid: newUid });
      for (const d of finSnap.docs) batch.update(d.ref, { clientUid: newUid });

      batch.set(doc(collection(db, "auditLogs")), {
        action: isReset ? "client.password_reset" : "client.access_link",
        actorUid: actor.uid,
        actorRole: "admin",
        targetType: "client",
        targetId: clientId,
        summary: `${isReset ? "Réinitialisation du mot de passe" : "Nouveau lien de configuration"} pour ${clientId}`,
        details: null,
        at: now,
      });
      await batch.commit();

      const oobCode = encodeSetupToken({
        c: clientId,
        e: newAuthEmail,
        k: bootstrapKey,
        t: Date.now(),
      });
      return { link: buildDirectSetupUrl(oobCode, clientId) };
    });
  },

  async sendClientInvite(raw: unknown): Promise<{ sent: boolean; emulated?: boolean; link?: string }> {
    const { link } = await this.regenerateClientSetupLink(raw, false);
    return { sent: false, emulated: true, link };
  },

  async saveClientNotes(raw: unknown): Promise<{ ok: boolean }> {
    const actor = requireSignedInStaff();
    const { clientId, notes } = parseInput(clientNotesSchema, raw);
    const db = getFirebaseDb();
    return withFirestoreCheck(async () => {
      await setDoc(doc(db, "clientPrivate", clientId), {
        clientId,
        notes,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
      return { ok: true };
    });
  },

  async verifyPasswordSetupToken(oobCode: string): Promise<{ valid: boolean; clientId: string; fullName: string }> {
    const payload = decodeSetupToken(oobCode);
    if (!payload) {
      throw new Error("Ce lien de configuration est invalide ou a expiré.");
    }
    if (Date.now() - payload.t > 24 * 3600 * 1000) {
      throw new Error("Ce lien de configuration a expiré (validité 24h). Demandez un nouveau lien à SHENA Express.");
    }
    const check = await identityPost("accounts:signInWithPassword", {
      email: payload.e,
      password: payload.k,
      returnSecureToken: true,
    });
    if (!check.ok) {
      throw new Error("Ce lien de configuration a déjà été utilisé ou remplacé par un lien plus récent.");
    }
    return {
      valid: true,
      clientId: payload.c,
      fullName: "",
    };
  },

  async completePasswordSetup(raw: { oobCode: string; newPassword: string }): Promise<{ ok: boolean; clientId: string }> {
    const { oobCode, newPassword } = parseInput(completePasswordSetupSchema, raw);
    const payload = decodeSetupToken(oobCode);
    if (!payload) {
      throw new Error("Ce lien de configuration est invalide ou a expiré.");
    }
    if (Date.now() - payload.t > 24 * 3600 * 1000) {
      throw new Error("Ce lien de configuration a expiré (validité 24h). Demandez un nouveau lien à SHENA Express.");
    }
    const signIn = await identityPost("accounts:signInWithPassword", {
      email: payload.e,
      password: payload.k,
      returnSecureToken: true,
    });
    if (!signIn.ok || typeof signIn.data.idToken !== "string") {
      throw new Error("Ce lien de configuration a déjà été utilisé ou remplacé par un lien plus récent.");
    }

    const updated = await identityPost("accounts:update", {
      idToken: signIn.data.idToken,
      password: newPassword,
      returnSecureToken: true,
    });
    if (!updated.ok) {
      throw new Error("Impossible d'enregistrer le nouveau mot de passe. Choisissez au moins 8 caractères.");
    }

    // Marque le compte comme configuré (actif) dans Firestore si accessible
    try {
      const db = getFirebaseDb();
      await updateDoc(doc(db, "clients", payload.c), {
        passwordConfigured: true,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Le statut sera également mis à jour dès la première connexion
    }

    return { ok: true, clientId: payload.c };
  },

  async resolveClientAuthEmail(clientId: string): Promise<string> {
    try {
      const db = getFirebaseDb();
      const snap = await getDoc(doc(db, "clientAuth", clientId));
      if (snap.exists()) {
        const data = snap.data() as { authEmail?: string; status?: string };
        if (data.status === "disabled") {
          throw new Error("Cet accès est désactivé. Contactez SHENA Express.");
        }
        if (data.authEmail) return data.authEmail;
      }
    } catch (err) {
      if ((err as Error).message.includes("désactivé")) throw err;
    }
    return technicalClientEmail(clientId);
  },

  async createOrder(raw: unknown): Promise<{ orderId: string }> {
    const actor = requireSignedInStaff();
    const input = parseInput(createOrderSchema, raw);
    const db = getFirebaseDb();
    return withFirestoreCheck(async () => {
      const clientSnap = await getDoc(doc(db, "clients", input.clientId));
      if (!clientSnap.exists()) throw new Error("Client introuvable.");
      const client = clientSnap.data() as ClientDoc;

      const year = new Date().getUTCFullYear();
      const orderId = await runTransaction(db, async (tx) => {
        const counterRef = doc(db, "counters", `orders_${year}`);
        const snap = await tx.get(counterRef);
        const next = ((snap.data()?.value as number | undefined) ?? 0) + 1;
        tx.set(counterRef, { value: next, updatedAt: serverTimestamp() }, { merge: true });
        return formatOrderId(year, next);
      });

      const items: OrderItem[] = input.items.map((it, idx) => ({
        lineId: it.lineId ?? `L${idx + 1}`,
        description: it.description,
        merchantRef: it.merchantRef ?? null,
        quantityOrdered: it.quantityOrdered,
        quantityReceived: 0,
        declaredUnitValue: it.declaredUnitValue ?? null,
      }));
      const stats = computeOrderStats(orderId, items, []);
      const now = serverTimestamp();
      const batch = writeBatch(db);
      batch.set(doc(db, "orders", orderId), {
        orderId,
        clientId: client.clientId,
        clientUid: client.clientUid,
        clientName: client.fullName,
        merchant: input.merchant,
        merchantOrderRef: input.merchantOrderRef,
        orderDate: input.orderDate,
        items,
        currency: input.currency,
        status: "registered",
        transportMode: input.transportMode,
        stats,
        shipmentIds: [],
        searchTokens: buildSearchTokens(
          orderId,
          client.clientId,
          client.fullName,
          input.merchant,
          input.merchantOrderRef,
          ...items.map((i) => i.description),
        ),
        publicNote: input.publicNote,
        createdAt: now,
        updatedAt: now,
      });
      batch.set(doc(db, "orderPrivate", orderId), {
        orderId,
        internalNotes: input.internalNotes ?? "",
        updatedAt: now,
        updatedBy: actor.uid,
      });
      batch.set(doc(db, "orderFinance", orderId), {
        orderId,
        clientId: client.clientId,
        clientUid: client.clientUid,
        currency: input.currency,
        charges: [],
        totalDue: 0,
        totalPaid: 0,
        balance: 0,
        paymentStatus: "none",
        updatedAt: now,
      });
      batch.set(doc(collection(db, "shipmentEvents")), {
        kind: "created",
        targetType: "order",
        orderId,
        shipmentId: null,
        clientUid: client.clientUid,
        fromStatus: null,
        toStatus: "registered",
        publicNote: input.publicNote ?? "Commande enregistrée.",
        dateChanges: null,
        actorUid: actor.uid,
        actorRole: "admin",
        at: now,
      });
      batch.set(doc(collection(db, "auditLogs")), {
        action: "order.create",
        actorUid: actor.uid,
        actorRole: "admin",
        targetType: "order",
        targetId: orderId,
        summary: `Création de la commande ${orderId} pour ${client.clientId}`,
        details: null,
        at: now,
      });
      await batch.commit();
      return { orderId };
    });
  },

  async updateOrder(raw: unknown): Promise<{ ok: boolean }> {
    const actor = requireSignedInStaff();
    const input = parseInput(updateOrderSchema, raw);
    const db = getFirebaseDb();
    return withFirestoreCheck(async () => {
      const ref = doc(db, "orders", input.orderId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Commande introuvable.");
      const existing = snap.data() as OrderDoc;
      const prevById = new Map(existing.items.map((i) => [i.lineId, i]));
      const items: OrderItem[] = input.items.map((it, idx) => {
        const lineId = it.lineId ?? `L${idx + 1}`;
        const prev = prevById.get(lineId);
        return {
          lineId,
          description: it.description,
          merchantRef: it.merchantRef ?? null,
          quantityOrdered: it.quantityOrdered,
          quantityReceived: Math.min(prev?.quantityReceived ?? 0, it.quantityOrdered),
          declaredUnitValue: it.declaredUnitValue ?? null,
        };
      });
      const stats = computeOrderStats(input.orderId, items, []);
      const batch = writeBatch(db);
      batch.update(ref, {
        merchant: input.merchant,
        merchantOrderRef: input.merchantOrderRef,
        orderDate: input.orderDate,
        currency: input.currency,
        transportMode: input.transportMode,
        publicNote: input.publicNote,
        items,
        stats,
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, "orderPrivate", input.orderId), {
        orderId: input.orderId,
        internalNotes: input.internalNotes ?? "",
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
      await batch.commit();
      return { ok: true };
    });
  },

  async recordReceipt(raw: unknown): Promise<{ ok: boolean }> {
    const actor = requireSignedInStaff();
    const input = parseInput(recordReceiptSchema, raw);
    const db = getFirebaseDb();
    return withFirestoreCheck(async () => {
      const ref = doc(db, "orders", input.orderId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Commande introuvable.");
      const order = snap.data() as OrderDoc;
      const updates = new Map(input.lines.map((l) => [l.lineId, l.quantityReceived]));
      const items = order.items.map((it) => {
        const nextRec = updates.get(it.lineId);
        if (nextRec === undefined) return it;
        if (nextRec > it.quantityOrdered) {
          throw new Error(`Quantité reçue supérieure à la quantité commandée pour ${it.description}.`);
        }
        return { ...it, quantityReceived: nextRec };
      });
      const shipmentsSnap = await getDocs(
        query(collection(db, "shipments"), where("clientId", "==", order.clientId)),
      );
      const linked = shipmentsSnap.docs
        .map((d) => d.data() as ShipmentDoc)
        .filter((s) => s.orderIds.includes(order.orderId));
      const stats = computeOrderStats(order.orderId, items, linked);
      const nextStatus = deriveOrderStatus(order.status, stats);
      const batch = writeBatch(db);
      batch.update(ref, { items, stats, status: nextStatus, updatedAt: serverTimestamp() });
      batch.set(doc(collection(db, "shipmentEvents")), {
        kind: "receipt",
        targetType: "order",
        orderId: order.orderId,
        shipmentId: null,
        clientUid: order.clientUid,
        fromStatus: order.status,
        toStatus: nextStatus,
        publicNote: input.publicNote ?? `Réception enregistrée (${stats.received}/${stats.ordered} article(s)).`,
        dateChanges: null,
        actorUid: actor.uid,
        actorRole: "admin",
        at: serverTimestamp(),
      });
      await batch.commit();
      return { ok: true };
    });
  },

  async createShipment(raw: unknown): Promise<{ shipmentId: string }> {
    const actor = requireSignedInStaff();
    const input = parseInput(createShipmentSchema, raw);
    const dateErrs = validateDateOrder(input.dates);
    if (dateErrs.length) throw new Error(dateErrs[0]!);
    const db = getFirebaseDb();
    return withFirestoreCheck(async () => {
      const clientSnap = await getDoc(doc(db, "clients", input.clientId));
      if (!clientSnap.exists()) throw new Error("Client introuvable.");
      const client = clientSnap.data() as ClientDoc;

      const ordersSnap = await getDocs(
        query(collection(db, "orders"), where("clientId", "==", input.clientId)),
      );
      const ordersMap = new Map<string, OrderDoc>();
      for (const d of ordersSnap.docs) ordersMap.set(d.id, d.data() as OrderDoc);

      const otherShipmentsSnap = await getDocs(
        query(collection(db, "shipments"), where("clientId", "==", input.clientId)),
      );
      const otherShipments = otherShipmentsSnap.docs.map((d) => d.data() as ShipmentDoc);

      const orderItemsRecord: Record<string, OrderItem[]> = {};
      for (const [oid, o] of ordersMap.entries()) orderItemsRecord[oid] = o.items;

      const lines: ShipmentLine[] = input.lines.map((l) => {
        const ord = ordersMap.get(l.orderId);
        const item = ord?.items.find((i) => i.lineId === l.lineId);
        if (!ord || !item) throw new Error(`Ligne ${l.lineId} introuvable dans ${l.orderId}.`);
        return { orderId: l.orderId, lineId: l.lineId, description: item.description, quantity: l.quantity };
      });

      const issues = validateAllocation({
        newLines: lines,
        orders: orderItemsRecord,
        otherShipments,
      });
      if (issues.length) throw new Error(issues[0]!.message);

      const year = new Date().getUTCFullYear();
      const { shipmentId, seq } = await runTransaction(db, async (tx) => {
        const counterRef = doc(db, "counters", `shipments_${year}`);
        const snap = await tx.get(counterRef);
        const next = ((snap.data()?.value as number | undefined) ?? 0) + 1;
        tx.set(counterRef, { value: next, updatedAt: serverTimestamp() }, { merge: true });
        return { shipmentId: formatShipmentId(year, next), seq: next };
      });

      const trackingNumber = input.trackingNumber || defaultTrackingNumber(year, seq);
      const orderIds = [...new Set(lines.map((l) => l.orderId))];
      const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);
      const status: StatusCode = input.dates.warehouseReceivedAt ? "received" : "preparing";

      const newShipment: ShipmentDoc = {
        shipmentId,
        trackingNumber,
        clientId: client.clientId,
        clientUid: client.clientUid,
        orderIds,
        lines,
        itemCount,
        weightKg: input.weightKg,
        dimensionsCm: input.dimensionsCm,
        transportMode: input.transportMode,
        status,
        lastStep: progressStep(status) ?? 1,
        dates: input.dates,
        dateChangeMessage: input.dateChangeMessage,
        pickupInstructions: input.pickupInstructions,
        createdAt: { toMillis: () => Date.now(), toDate: () => new Date() },
        updatedAt: { toMillis: () => Date.now(), toDate: () => new Date() },
      };

      const batch = writeBatch(db);
      const now = serverTimestamp();
      batch.set(doc(db, "shipments", shipmentId), { ...newShipment, createdAt: now, updatedAt: now });
      batch.set(doc(db, "shipmentPrivate", shipmentId), {
        shipmentId,
        internalNotes: input.internalNotes ?? "",
        updatedAt: now,
        updatedBy: actor.uid,
      });

      const allShipments = [...otherShipments, newShipment];
      for (const oid of orderIds) {
        const ord = ordersMap.get(oid);
        if (!ord) continue;
        const linked = allShipments.filter((s) => s.orderIds.includes(oid));
        const stats = computeOrderStats(oid, ord.items, linked);
        const nextOrderStatus = deriveOrderStatus(ord.status, stats);
        batch.update(doc(db, "orders", oid), {
          stats,
          status: nextOrderStatus,
          shipmentIds: linked.map((s) => s.shipmentId),
          updatedAt: now,
        });
      }

      batch.set(doc(collection(db, "shipmentEvents")), {
        kind: "created",
        targetType: "shipment",
        orderId: orderIds[0] ?? null,
        shipmentId,
        clientUid: client.clientUid,
        fromStatus: null,
        toStatus: status,
        publicNote: `Colis ${trackingNumber} créé.`,
        dateChanges: null,
        actorUid: actor.uid,
        actorRole: "admin",
        at: now,
      });
      await batch.commit();
      return { shipmentId };
    });
  },

  async updateShipment(raw: unknown): Promise<{ ok: boolean }> {
    const actor = requireSignedInStaff();
    const input = parseInput(updateShipmentSchema, raw);
    const dateErrs = validateDateOrder(input.dates);
    if (dateErrs.length) throw new Error(dateErrs[0]!);
    const db = getFirebaseDb();
    return withFirestoreCheck(async () => {
      const ref = doc(db, "shipments", input.shipmentId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Colis introuvable.");
      const current = snap.data() as ShipmentDoc;
      const changes = diffDates(current.dates, input.dates);

      const batch = writeBatch(db);
      const now = serverTimestamp();
      batch.update(ref, {
        trackingNumber: input.trackingNumber || current.trackingNumber,
        transportMode: input.transportMode,
        weightKg: input.weightKg,
        dimensionsCm: input.dimensionsCm,
        dates: input.dates,
        dateChangeMessage: input.dateChangeMessage,
        pickupInstructions: input.pickupInstructions,
        updatedAt: now,
      });
      batch.set(doc(db, "shipmentPrivate", input.shipmentId), {
        shipmentId: input.shipmentId,
        internalNotes: input.internalNotes ?? "",
        updatedAt: now,
        updatedBy: actor.uid,
      });
      if (Object.keys(changes).length > 0) {
        batch.set(doc(collection(db, "shipmentEvents")), {
          kind: "dates",
          targetType: "shipment",
          orderId: current.orderIds[0] ?? null,
          shipmentId: current.shipmentId,
          clientUid: current.clientUid,
          fromStatus: current.status,
          toStatus: current.status,
          publicNote: input.dateChangeMessage ?? "Mise à jour des dates prévisionnelles.",
          dateChanges: changes,
          actorUid: actor.uid,
          actorRole: "admin",
          at: now,
        });
      }
      await batch.commit();
      return { ok: true };
    });
  },

  async updateStatus(raw: unknown): Promise<{ ok: boolean }> {
    const actor = requireSignedInStaff();
    const input = parseInput(updateStatusSchema, raw);
    const db = getFirebaseDb();
    return withFirestoreCheck(async () => {
      const col = input.targetType === "order" ? "orders" : "shipments";
      const ref = doc(db, col, input.targetId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Élément introuvable.");
      const data = snap.data() as { status: StatusCode; clientUid: string; lastStep?: number; orderIds?: string[] };
      const step = progressStep(input.status, data.lastStep ?? 1) ?? data.lastStep ?? 1;

      const batch = writeBatch(db);
      const now = serverTimestamp();
      batch.update(ref, {
        status: input.status,
        ...(input.targetType === "shipment" ? { lastStep: step } : {}),
        updatedAt: now,
      });
      batch.set(doc(collection(db, "shipmentEvents")), {
        kind: "status",
        targetType: input.targetType,
        orderId: input.targetType === "order" ? input.targetId : (data.orderIds?.[0] ?? null),
        shipmentId: input.targetType === "shipment" ? input.targetId : null,
        clientUid: data.clientUid,
        fromStatus: data.status,
        toStatus: input.status,
        publicNote: input.publicNote,
        dateChanges: null,
        actorUid: actor.uid,
        actorRole: "admin",
        at: now,
      });
      await batch.commit();
      return { ok: true };
    });
  },

  async setOrderCharges(raw: unknown): Promise<{ ok: boolean }> {
    requireSignedInStaff();
    const input = parseInput(setChargesSchema, raw);
    const db = getFirebaseDb();
    return withFirestoreCheck(async () => {
      const ordSnap = await getDoc(doc(db, "orders", input.orderId));
      if (!ordSnap.exists()) throw new Error("Commande introuvable.");
      const order = ordSnap.data() as OrderDoc;

      const paymentsSnap = await getDocs(
        query(collection(db, "paymentRecords"), where("orderId", "==", input.orderId)),
      );
      const payments = paymentsSnap.docs.map((d) => d.data() as PaymentRecordDoc);
      const charges: ChargeLine[] = input.charges.map((c, i) => ({
        id: c.id ?? `C${i + 1}`,
        kind: c.kind,
        label: c.label,
        amount: c.amount,
      }));
      const due = totalDue(charges);
      const paid = totalPaid(payments, order.currency);
      await setDoc(doc(db, "orderFinance", input.orderId), {
        orderId: input.orderId,
        clientId: order.clientId,
        clientUid: order.clientUid,
        currency: order.currency,
        charges,
        totalDue: due,
        totalPaid: paid,
        balance: balance(due, paid),
        paymentStatus: paymentStatus(due, paid),
        updatedAt: serverTimestamp(),
      });
      return { ok: true };
    });
  },

  async recordPayment(raw: unknown): Promise<{ paymentId: string }> {
    const actor = requireSignedInStaff();
    const input = parseInput(recordPaymentSchema, raw);
    const db = getFirebaseDb();
    return withFirestoreCheck(async () => {
      const ordSnap = await getDoc(doc(db, "orders", input.orderId));
      if (!ordSnap.exists()) throw new Error("Commande introuvable.");
      const order = ordSnap.data() as OrderDoc;
      if (input.currency !== order.currency) {
        throw new Error(`La devise du paiement (${input.currency}) doit correspondre à celle de la commande (${order.currency}).`);
      }
      const payRef = doc(collection(db, "paymentRecords"));
      await setDoc(payRef, {
        orderId: input.orderId,
        clientId: order.clientId,
        clientUid: order.clientUid,
        amount: input.amount,
        currency: input.currency,
        method: input.method,
        reference: input.reference,
        receivedOn: input.receivedOn,
        voided: false,
        voidReason: null,
        recordedBy: actor.uid,
        createdAt: serverTimestamp(),
      });

      const [finSnap, paymentsSnap] = await Promise.all([
        getDoc(doc(db, "orderFinance", input.orderId)),
        getDocs(query(collection(db, "paymentRecords"), where("orderId", "==", input.orderId))),
      ]);
      const charges = (finSnap.data()?.charges as ChargeLine[] | undefined) ?? [];
      const payments = paymentsSnap.docs.map((d) => d.data() as PaymentRecordDoc);
      const due = totalDue(charges);
      const paid = totalPaid(payments, order.currency);
      await setDoc(doc(db, "orderFinance", input.orderId), {
        orderId: input.orderId,
        clientId: order.clientId,
        clientUid: order.clientUid,
        currency: order.currency,
        charges,
        totalDue: due,
        totalPaid: paid,
        balance: balance(due, paid),
        paymentStatus: paymentStatus(due, paid),
        updatedAt: serverTimestamp(),
      });
      return { paymentId: payRef.id };
    });
  },

  async voidPayment(raw: unknown): Promise<{ ok: boolean }> {
    requireSignedInStaff();
    const input = parseInput(voidPaymentSchema, raw);
    const db = getFirebaseDb();
    return withFirestoreCheck(async () => {
      const ref = doc(db, "paymentRecords", input.paymentId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Paiement introuvable.");
      const pay = snap.data() as PaymentRecordDoc;
      await updateDoc(ref, { voided: true, voidReason: input.reason });

      const [finSnap, paymentsSnap] = await Promise.all([
        getDoc(doc(db, "orderFinance", pay.orderId)),
        getDocs(query(collection(db, "paymentRecords"), where("orderId", "==", pay.orderId))),
      ]);
      const charges = (finSnap.data()?.charges as ChargeLine[] | undefined) ?? [];
      const payments = paymentsSnap.docs.map((d) => d.data() as PaymentRecordDoc);
      const due = totalDue(charges);
      const paid = totalPaid(payments, pay.currency);
      await updateDoc(doc(db, "orderFinance", pay.orderId), {
        totalDue: due,
        totalPaid: paid,
        balance: balance(due, paid),
        paymentStatus: paymentStatus(due, paid),
        updatedAt: serverTimestamp(),
      });
      return { ok: true };
    });
  },

  async updateSettings(raw: unknown): Promise<{ ok: boolean }> {
    requireSignedInStaff();
    const input = parseInput(settingsUpdateSchema, raw);
    const db = getFirebaseDb();
    return withFirestoreCheck(async () => {
      await setDoc(doc(db, "settings", "public"), { ...input.publicSettings, isExample: false, updatedAt: serverTimestamp() });
      try {
        await setDoc(doc(db, "clientPrivate", "__settings_private__"), { ...input.privateSettings, updatedAt: serverTimestamp() });
      } catch {
        // Ignore si non requis
      }
      return { ok: true };
    });
  },
};
