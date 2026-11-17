import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Transaction,
  type Firestore,
} from "firebase/firestore";
import {
  buildEmptyOrderPackage,
  addOrderPackageSchema,
  packageTrackingSchema,
  externalTracking,
  orderPackageStatus,
  buildOrderCreation,
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
  recordShipmentWeighingSchema,
  updateShippingPaymentSchema,
  setChargesSchema,
  recordPaymentSchema,
  voidPaymentSchema,
  settingsUpdateSchema,
  completePasswordSetupSchema,
  formatClientId,
  formatOrderId,
  formatPackageId,
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
  COMMERCIAL_RATE_CENTS_PER_LB,
  calculateShippingFeeCents,
  hasConfirmedMiamiReception,
  formatMoney,
  formatWeightLb,
  statusLabel,
  notificationTypeForStatus,
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
  type ShippingPaymentStatus,
  type WeightCorrectionEntry,
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

// Tous les chemins qui créent/modifient un suivi partagent ce verrou optimiste.
// Le SDK Web ne sait pas lire une requête avec tx.get : les requêtes ci-dessous
// sont refaites à chaque tentative, après lecture du verrou et avant son écriture.
async function readTrackingGuard(tx: Transaction) {
  const ref = doc(getFirebaseDb(), "counters", "shipmentTracking");
  const snap = await tx.get(ref);
  return { ref, revision: Number(snap.data()?.revision ?? 0) + 1 };
}
function writeTrackingGuard(tx: Transaction, guard: Awaited<ReturnType<typeof readTrackingGuard>>) {
  tx.set(guard.ref, { revision: guard.revision, updatedAt: serverTimestamp() });
}
async function assertTrackingAvailable(trackingNumber: string, shipmentId?: string) {
  const matches = await getDocsFromServer(query(collection(getFirebaseDb(), "shipments"), where("trackingNumber", "==", trackingNumber)));
  const externalMatches = await getDocsFromServer(query(collection(getFirebaseDb(), "shipments"), where("externalTrackingNumber", "==", trackingNumber)));
  if ([...matches.docs, ...externalMatches.docs].some(d => d.id !== shipmentId)) {
    throw new Error("Ce numéro de suivi est déjà utilisé par un autre colis.");
  }
}
class PackageAllocationConflict extends Error {
  readonly code='package-allocation-conflict';
}
async function readCreationCounter(tx: Transaction, kind: "orders" | "shipments", year: number) {
  const refs = kind === "shipments" ? [doc(getFirebaseDb(), "counters", "packages")] : [doc(getFirebaseDb(), "counters", `${kind}_${year}`), doc(getFirebaseDb(), "counters", `${kind}-${year}`)];
  const values = await Promise.all(refs.map(async ref => (await tx.get(ref)).data()?.value ?? 0));
  if (values.some(value => !Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER)) {
    throw new Error("Le compteur d'identifiants est invalide. Contactez l'administrateur.");
  }
  const next = Math.max(...values) + 1;
  const reservation = kind === "shipments" ? doc(getFirebaseDb(), "packageNumbers", formatPackageId(next)) : null;
  if (reservation && (await tx.get(reservation)).exists()) throw new PackageAllocationConflict("Ce numéro de colis a déjà été attribué. Faites vérifier le compteur global ; aucun numéro ne sera réutilisé.");
  return { refs, next, reservation };
}
function writeCreationCounter(tx: Transaction, counter: Awaited<ReturnType<typeof readCreationCounter>>) {
  for (const ref of counter.refs) tx.set(ref, { value: counter.next, updatedAt: serverTimestamp() }, { merge: true });
  if (counter.reservation) tx.set(counter.reservation, {sequence: counter.next, packageId: formatPackageId(counter.next), createdAt: serverTimestamp()});
}

/** Le contrôle de progression peut refuser un commit devenu périmé avant
 * la vérification des préconditions. Ne rejouer que si le compteur a changé. */
async function runPackageTransaction<T>(db:Firestore, update:(tx:Transaction)=>Promise<T>):Promise<T> {
  for(let attempt=0;attempt<6;attempt++) {
    let observed=-1;
    try {
      return await runTransaction(db,async tx=>{
        const counter=await tx.get(doc(db,'counters','packages'));
        observed=Number(counter.data()?.value??0);
        return update(tx);
      },{maxAttempts:10});
    } catch(error) {
      const code=String((error as {code?:string}).code??'');
      if((!code.includes('permission-denied') && code!=='package-allocation-conflict') || attempt===5)throw error;
      let latest;
      try {latest=await getDocFromServer(doc(db,'counters','packages'));}catch{throw error;}
      if(Number(latest.data()?.value??0)===observed)throw error;
      await new Promise(resolve=>setTimeout(resolve,50*(attempt+1)));
    }
  }
  throw new Error('Créations simultanées : veuillez réessayer.');
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
    return withFirestoreCheck(() => runPackageTransaction(db, async (tx) => {
      // Phase de lecture : aucun set/update/delete avant la fin des contrôles.
      const guard = await readTrackingGuard(tx);
      const clientSnap = await tx.get(doc(db, "clients", input.clientId));
      if (!clientSnap.exists()) throw new Error("Client introuvable.");
      const client = clientSnap.data() as ClientDoc;
      if (client.status !== "active") throw new Error("Le compte de ce client est désactivé.");
      if (client.clientId !== input.clientId || !client.clientUid) throw new Error("L'association du client à son compte est invalide. Contactez l'administrateur.");
      const year = new Date().getUTCFullYear();
      const orderCounter = await readCreationCounter(tx, "orders", year);
      const shipmentCounter = input.trackingNumber || input.createInitialPackage ? await readCreationCounter(tx, "shipments", year) : null;
      const orderId = formatOrderId(year, orderCounter.next);
      const shipmentId = shipmentCounter ? formatPackageId(shipmentCounter.next) : null;
      for (const path of [`orders/${orderId}`, `orderPrivate/${orderId}`, `orderFinance/${orderId}`,
        ...(shipmentId ? [`shipments/${shipmentId}`, `shipmentPrivate/${shipmentId}`] : [])]) {
        if ((await tx.get(doc(db, path))).exists()) {
          throw new PackageAllocationConflict("Cet identifiant est déjà utilisé. Aucune donnée n'a été remplacée. Faites vérifier les compteurs par l'administrateur.");
        }
      }
      if (input.trackingNumber) await assertTrackingAvailable(input.trackingNumber);
      const { order, shipment } = buildOrderCreation(input, client, orderId, shipmentId, new Date().toISOString());
      const initialStatus = order.status;
      const now = serverTimestamp();
      // Phase d'écriture : toute la commande et son colis sont validés ensemble.
      writeCreationCounter(tx, orderCounter);
      if (shipmentCounter) writeCreationCounter(tx, shipmentCounter);
      if (shipment && shipmentId) {
        tx.set(doc(db, "shipments", shipmentId), { ...shipment, createdAt: now, updatedAt: now });
        tx.set(doc(db, "shipmentPrivate", shipmentId), {
          shipmentId, internalNotes: input.internalNotes ?? "", updatedAt: now, updatedBy: actor.uid,
        });
        tx.set(doc(collection(db, "shipmentEvents")), {
          kind: "created", targetType: "shipment", orderId, shipmentId, clientUid: client.clientUid,
          fromStatus: null, toStatus: initialStatus, publicNote: input.publicNote ?? `Colis ${input.trackingNumber} enregistré.`,
          dateChanges: null, actorUid: actor.uid, actorRole: "admin", at: now,
        });
      }
      tx.set(doc(db, "orders", orderId), { ...order, createdAt: now, updatedAt: now });
      tx.set(doc(db, "orderPrivate", orderId), {
        orderId,
        internalNotes: input.internalNotes ?? "",
        updatedAt: now,
        updatedBy: actor.uid,
      });
      tx.set(doc(db, "orderFinance", orderId), {
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
      tx.set(doc(collection(db, "shipmentEvents")), {
        kind: "created",
        targetType: "order",
        orderId,
        shipmentId: shipmentId ?? null,
        clientUid: client.clientUid,
        fromStatus: null,
        toStatus: initialStatus,
        publicNote: input.publicNote ?? "Commande enregistrée.",
        dateChanges: null,
        actorUid: actor.uid,
        actorRole: "admin",
        at: now,
      });
      tx.set(doc(collection(db, "auditLogs")), {
        action: "order.create",
        actorUid: actor.uid,
        actorRole: "admin",
        targetType: "order",
        targetId: orderId,
        summary: `Création de la commande ${orderId} pour ${client.clientId}`,
        details: null,
        at: now,
      });
      writeTrackingGuard(tx, guard);
      return { orderId };
    }));
  },

  async addOrderPackage(raw: unknown): Promise<{shipmentId: string}> {
    const actor=requireSignedInStaff();
    const input=parseInput(addOrderPackageSchema,raw);
    const db=getFirebaseDb();
    return withFirestoreCheck(()=>runPackageTransaction(db, async tx=>{
      const guard=await readTrackingGuard(tx);
      const orderRef=doc(db,"orders",input.orderId), orderSnap=await tx.get(orderRef);
      if(!orderSnap.exists())throw new Error("Commande introuvable.");
      const order=orderSnap.data() as OrderDoc;
      if(order.status==='cancelled')throw new Error("Impossible d’ajouter un colis à une commande annulée.");
      const client=await tx.get(doc(db,"clients",order.clientId));
      if(!client.exists()||client.data().clientUid!==order.clientUid||client.data().status!=='active')throw new Error("Association client/commande invalide ou compte désactivé.");
      const counter=await readCreationCounter(tx,"shipments",0), id=formatPackageId(counter.next);
      const target=doc(db,"shipments",id);
      if((await tx.get(target)).exists())throw new PackageAllocationConflict("Cet identifiant est déjà utilisé. Aucun colis n’a été remplacé.");
      if(input.externalTrackingNumber)await assertTrackingAvailable(input.externalTrackingNumber);
      const shipment=buildEmptyOrderPackage(order,id,input.externalTrackingNumber,new Date().toISOString());
      const now=serverTimestamp();
      writeCreationCounter(tx,counter);
      tx.set(target,{...shipment,searchTokens:[id.toLowerCase(),...(input.externalTrackingNumber?[input.externalTrackingNumber.toLowerCase()]:[])],createdAt:now,updatedAt:now});
      tx.update(orderRef,{status:orderPackageStatus([shipment],order.status),shipmentIds:[...(order.shipmentIds??[]),id],stats:{...order.stats,shipmentCount:(order.stats?.shipmentCount??order.shipmentIds?.length??0)+1},searchTokens:[...new Set([...order.searchTokens,id.toLowerCase(),...(input.externalTrackingNumber?[input.externalTrackingNumber.toLowerCase()]:[])])],updatedAt:now});
      tx.set(doc(collection(db,"shipmentEvents")),{kind:'created',targetType:'shipment',orderId:order.orderId,shipmentId:id,clientUid:order.clientUid,toStatus:'registered',fromStatus:null,publicNote:`Colis ${id} ajouté à votre commande.`,actorUid:actor.uid,actorRole:'admin',at:now});
      tx.set(doc(collection(db,"auditLogs")),{action:'shipment.add',actorUid:actor.uid,actorRole:'admin',targetType:'shipment',targetId:id,summary:`Colis ${id} ajouté à ${order.orderId}`,at:now});
      writeTrackingGuard(tx,guard);
      return {shipmentId:id};
    }));
  },

  async updatePackageTracking(raw: unknown): Promise<{ok:boolean}> {
    const actor=requireSignedInStaff();const input=parseInput(packageTrackingSchema,raw);const db=getFirebaseDb();
    return withFirestoreCheck(()=>runTransaction(db,async tx=>{
      const guard=await readTrackingGuard(tx);const ref=doc(db,"shipments",input.shipmentId);const snap=await tx.get(ref);
      if(!snap.exists())throw new Error("Colis introuvable.");
      if(input.externalTrackingNumber)await assertTrackingAvailable(input.externalTrackingNumber,input.shipmentId);
      const now=serverTimestamp();
      tx.update(ref,{externalTrackingNumber:input.externalTrackingNumber,searchTokens:buildSearchTokens(input.shipmentId,input.externalTrackingNumber),updatedAt:now});
      tx.set(doc(collection(db,"auditLogs")),{action:'shipment.external_tracking',actorUid:actor.uid,actorRole:'admin',targetType:'shipment',targetId:input.shipmentId,summary:'Tracking externe modifié ; numéro SHENA conservé.',at:now});
      writeTrackingGuard(tx,guard);return {ok:true};
    }));
  },

  async updateOrder(raw: unknown): Promise<{ ok: boolean }> {
    const actor = requireSignedInStaff();
    const input = parseInput(updateOrderSchema, raw);
    const db = getFirebaseDb();
    return withFirestoreCheck(() => runTransaction(db, async (tx) => {
      const guard = await readTrackingGuard(tx);
      const ref = doc(db, "orders", input.orderId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error("Commande introuvable.");
      const existing = snap.data() as OrderDoc;
      const linkedShipments: ShipmentDoc[]=[];
      for(const id of existing.shipmentIds){const snap=await tx.get(doc(db,'shipments',id));if(snap.exists())linkedShipments.push(snap.data() as ShipmentDoc);}
      const hasNewPackages=linkedShipments.some(s=>s.packageSequence!==undefined);

      if (input.trackingNumber && existing.shipmentIds.length > 0) {
        await assertTrackingAvailable(input.trackingNumber, existing.shipmentIds[0]);
      }

      const rawItems =
        input.items.length > 0
          ? input.items
          : [
              {
                lineId: existing.items[0]?.lineId ?? "L1",
                description: input.description ?? existing.items[0]?.description ?? `Colis ${input.trackingNumber ?? input.orderId}`,
                merchantRef: input.merchantOrderRef ?? existing.merchantOrderRef ?? null,
                quantityOrdered: existing.items[0]?.quantityOrdered ?? 1,
                declaredUnitValue: existing.items[0]?.declaredUnitValue ?? null,
              },
            ];

      const prevById = new Map(existing.items.map((i) => [i.lineId, i]));
      const items: OrderItem[] = rawItems.map((it, idx) => {
        const lineId = it.lineId ?? `L${idx + 1}`;
        const prev = prevById.get(lineId);
        return {
          lineId,
          description: it.description,
          merchantRef: it.merchantRef ?? null,
          quantityOrdered: it.quantityOrdered,
          quantityReceived: Math.min(prev?.quantityReceived ?? (existing.shipmentIds.length > 0 ? it.quantityOrdered : 0), it.quantityOrdered),
          declaredUnitValue: it.declaredUnitValue ?? null,
        };
      });
      const stats = computeOrderStats(input.orderId, items, linkedShipments);
      const nextStatus = hasNewPackages ? orderPackageStatus(linkedShipments,existing.status) : input.initialStatus ?? existing.status;
      tx.update(ref, {
        merchant: input.merchant,
        merchantOrderRef: input.merchantOrderRef,
        orderDate: input.orderDate,
        currency: input.currency,
        transportMode: input.transportMode ?? existing.transportMode,
        publicNote: input.publicNote,
        status: nextStatus,
        items,
        stats,
        searchTokens: buildSearchTokens(
          input.orderId,
          existing.clientId,
          existing.clientName,
          input.trackingNumber,
          input.merchant,
          input.merchantOrderRef,
          ...items.map((i) => i.description),
        ),
        updatedAt: serverTimestamp(),
      });
      if (existing.shipmentIds[0] && !hasNewPackages) {
        const shipId = existing.shipmentIds[0];
        tx.update(doc(db, "shipments", shipId), {
          ...(input.trackingNumber ? { trackingNumber: input.trackingNumber } : {}),
          ...(input.initialStatus
            ? {
                status: input.initialStatus,
                lastStep: progressStep(input.initialStatus) ?? 1,
              }
            : {}),
          lines: items.map((it) => ({
            orderId: input.orderId,
            lineId: it.lineId,
            description: it.description,
            quantity: it.quantityOrdered,
          })),
          updatedAt: serverTimestamp(),
        });
      }
      tx.set(doc(db, "orderPrivate", input.orderId), {
        orderId: input.orderId,
        internalNotes: input.internalNotes ?? "",
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
      writeTrackingGuard(tx, guard);
      return { ok: true };
    }));
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
    return withFirestoreCheck(() => runPackageTransaction(db, async (tx) => {
      const guard = await readTrackingGuard(tx);
      const clientSnap = await tx.get(doc(db, "clients", input.clientId));
      if (!clientSnap.exists()) throw new Error("Client introuvable.");
      const client = clientSnap.data() as ClientDoc;
      if(client.status!=='active' || client.clientId!==input.clientId || !client.clientUid)throw new Error("Client invalide ou désactivé.");

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

      if (lines.length > 0) {
        const issues = validateAllocation({
          newLines: lines,
          orders: orderItemsRecord,
          otherShipments,
        });
        if (issues.length) throw new Error(issues[0]!.message);
      }

      const year = new Date().getUTCFullYear();
      const counter = await readCreationCounter(tx, "shipments", year);
      const seq = counter.next;
      const shipmentId = formatPackageId(seq);
      for (const path of [`shipments/${shipmentId}`, `shipmentPrivate/${shipmentId}`]) {
        if ((await tx.get(doc(db, path))).exists()) throw new PackageAllocationConflict("Cet identifiant de colis est déjà utilisé. Aucune donnée n'a été remplacée.");
      }
      const trackingNumber = shipmentId;
      const externalTrackingNumber = input.trackingNumber;
      if (externalTrackingNumber) await assertTrackingAvailable(externalTrackingNumber);
      const finalLines: ShipmentLine[] = lines;
      const orderIds = [...new Set([...(input.orderRef ? [input.orderRef] : []), ...lines.map((l) => l.orderId)])];
      if (!orderIds.length) throw new Error("Choisissez la commande principale de ce colis.");
      for (const id of orderIds) if (!ordersMap.has(id) || ordersMap.get(id)!.clientUid !== client.clientUid || ordersMap.get(id)!.status === "cancelled") throw new Error("Commande principale invalide ou associée à un autre client.");
      const itemCount = finalLines.reduce((sum, l) => sum + l.quantity, 0);
      const status: StatusCode =
        input.initialStatus ?? (input.dates.warehouseReceivedAt ? "received" : "registered");

      const nowIso = new Date().toISOString();
      const newShipment: ShipmentDoc = {
        shipmentId,
        trackingNumber,
        externalTrackingNumber,
        description: input.description,
        primaryOrderId: orderIds[0],
        packageSequence: seq,
        rateConfirmedAt: null,
        clientId: client.clientId,
        clientUid: client.clientUid,
        orderIds,
        lines: finalLines,
        itemCount,
        weightKg: input.weightKg,
        actualWeightLb: null,
        ratePerLbCents: null,
        shippingFeeCents: null,
        shippingCurrency: "USD",
        shippingPaymentStatus: null,
        paidAmountCents: 0,
        miamiReceivedAt: status === "received" ? input.dates.warehouseReceivedAt ?? nowIso : null,
        weighedAt: null,
        weighedByUid: null,
        weightHistory: [],
        orderConfirmedAt: nowIso,
        preparingAt: status === "preparing" ? nowIso : null,
        inTransitAt: status === "in_transit" || status === "shipped" ? nowIso : null,
        arrivedHaitiAt: status === "arrived_haiti" ? nowIso : null,
        readyForDeliveryAt: status === "available" ? nowIso : null,
        deliveredAt: status === "delivered" ? nowIso : null,
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

      writeCreationCounter(tx, counter);
      const now = serverTimestamp();
      tx.set(doc(db, "shipments", shipmentId), { ...newShipment, createdAt: now, updatedAt: now });
      tx.set(doc(db, "shipmentPrivate", shipmentId), {
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
        tx.update(doc(db, "orders", oid), {
          stats,
          status: nextOrderStatus,
          shipmentIds: linked.map((s) => s.shipmentId),
          updatedAt: now,
        });
      }

      tx.set(doc(collection(db, "shipmentEvents")), {
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
      writeTrackingGuard(tx, guard);
      return { shipmentId };
    }));
  },

  async updateShipment(raw: unknown): Promise<{ ok: boolean }> {
    const actor = requireSignedInStaff();
    const input = parseInput(updateShipmentSchema, raw);
    const dateErrs = validateDateOrder(input.dates);
    if (dateErrs.length) throw new Error(dateErrs[0]!);
    const db = getFirebaseDb();
    return withFirestoreCheck(() => runTransaction(db, async (tx) => {
      const guard = await readTrackingGuard(tx);
      const ref = doc(db, "shipments", input.shipmentId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error("Colis introuvable.");
      const current = snap.data() as ShipmentDoc;

      const nextExternal = input.trackingNumber === current.trackingNumber ? externalTracking(current) : input.trackingNumber ?? externalTracking(current);
      if (nextExternal) await assertTrackingAvailable(nextExternal, input.shipmentId);

      const changes = diffDates(current.dates, input.dates);
      const nextStatus = input.initialStatus ?? current.status;
      const nextLines = current.packageSequence ? current.lines :
        input.description !== undefined && input.description !== null
          ? [
              {
                orderId: input.orderRef ?? current.lines[0]?.orderId ?? current.shipmentId,
                lineId: current.lines[0]?.lineId ?? "L1",
                description: input.description,
                quantity: current.lines[0]?.quantity ?? 1,
              },
            ]
          : current.lines;

      if (snap.data()?.accountingManaged && JSON.stringify(nextLines) !== JSON.stringify(current.lines)) throw new Error("Colis facturé : les articles associés sont figés dans la comptabilité.");
      const now = serverTimestamp();
      tx.update(ref, {
        trackingNumber: current.packageSequence ? current.trackingNumber : input.trackingNumber || current.trackingNumber,
        externalTrackingNumber: nextExternal,
        description: input.description,
        transportMode: input.transportMode,
        weightKg: input.weightKg,
        dimensionsCm: input.dimensionsCm,
        lines: nextLines,
        status: nextStatus,
        lastStep: progressStep(nextStatus, current.lastStep) ?? current.lastStep ?? 1,
        dates: input.dates,
        dateChangeMessage: input.dateChangeMessage,
        pickupInstructions: input.pickupInstructions,
        updatedAt: now,
      });
      tx.set(doc(db, "shipmentPrivate", input.shipmentId), {
        shipmentId: input.shipmentId,
        internalNotes: input.internalNotes ?? "",
        updatedAt: now,
        updatedBy: actor.uid,
      });
      if (Object.keys(changes).length > 0) {
        tx.set(doc(collection(db, "shipmentEvents")), {
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
      writeTrackingGuard(tx, guard);
      return { ok: true };
    }));
  },

  async updateStatus(raw: unknown): Promise<{ ok: boolean }> {
    const actor = requireSignedInStaff();
    const input = parseInput(updateStatusSchema, raw);
    const db = getFirebaseDb();
    return withFirestoreCheck(() => runTransaction(db, async (tx) => {
      const guard = await readTrackingGuard(tx);
      const col = input.targetType === "order" ? "orders" : "shipments";
      const ref = doc(db, col, input.targetId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error("Élément introuvable.");
      const data = snap.data() as {
        status: StatusCode;
        clientUid: string;
        trackingNumber?: string;
        lastStep?: number;
        orderIds?: string[];
        shipmentIds?: string[];
        miamiReceivedAt?: string | null;
        preparingAt?: string | null;
        inTransitAt?: string | null;
        arrivedHaitiAt?: string | null;
        arrivedDominicanAt?: string | null;
        busToHaitiAt?: string | null;
        readyForDeliveryAt?: string | null;
        deliveredAt?: string | null;
      };
      const step = progressStep(input.status, data.lastStep ?? 1) ?? data.lastStep ?? 1;

      const relatedOrders = new Map<string, OrderDoc>();
      const relatedShipments = new Map<string, ShipmentDoc>();
      if(input.targetType==='shipment') {
        relatedShipments.set(input.targetId, snap.data() as ShipmentDoc);
        for(const oid of data.orderIds ?? []) {
          const order=await tx.get(doc(db,'orders',oid));
          if(!order.exists())continue;
          relatedOrders.set(oid,order.data() as OrderDoc);
          for(const sid of order.data().shipmentIds ?? []){if(!relatedShipments.has(sid)){const s=await tx.get(doc(db,'shipments',sid));if(s.exists())relatedShipments.set(sid,s.data() as ShipmentDoc);}}
        }
      } else {
        for(const sid of data.shipmentIds ?? []) {const s=await tx.get(doc(db,'shipments',sid));if(s.exists())relatedShipments.set(sid,s.data() as ShipmentDoc);}
      }
      const batch = tx;
      const now = serverTimestamp();
      const nowIso = new Date().toISOString();
      const stageDates: Record<string, string> = {};
      if (input.status === "preparing" && !data.preparingAt) stageDates.preparingAt = nowIso;
      if (input.status === "received" && !data.miamiReceivedAt) stageDates.miamiReceivedAt = nowIso;
      if ((input.status === "in_transit" || input.status === "shipped") && !data.inTransitAt) stageDates.inTransitAt = nowIso;
      if (input.status === "arrived_dr" && !data.arrivedDominicanAt) stageDates.arrivedDominicanAt = nowIso;
      if (input.status === "bus_to_haiti" && !data.busToHaitiAt) stageDates.busToHaitiAt = nowIso;
      if ((input.status === "arrived_haiti" || input.status === "customs") && !data.arrivedHaitiAt) stageDates.arrivedHaitiAt = nowIso;
      if ((input.status === "available" || input.status === "out_for_delivery") && !data.readyForDeliveryAt) stageDates.readyForDeliveryAt = nowIso;
      if (input.status === "delivered" && !data.deliveredAt) stageDates.deliveredAt = nowIso;

      batch.update(ref, {
        status: input.status,
        ...(input.targetType === "shipment" ? { lastStep: step, ...stageDates } : {}),
        updatedAt: now,
      });

      if (input.targetType==='shipment') {
        const current=relatedShipments.get(input.targetId)!;
        relatedShipments.set(input.targetId,{...current,status:input.status,lastStep:step});
        for(const [oid] of relatedOrders) {
          const siblings=[...relatedShipments.values()].filter(s=>s.orderIds.includes(oid));
          batch.update(doc(db,'orders',oid),{status:orderPackageStatus(siblings,input.status),updatedAt:now});
        }
      } else {
        for(const [sid] of relatedShipments) batch.update(doc(db,'shipments',sid),{status:input.status,lastStep:step,...stageDates,updatedAt:now});
      }

      batch.set(doc(collection(db, "shipmentEvents")), {
        kind: "status",
        targetType: input.targetType,
        orderId: input.targetType === "order" ? input.targetId : (data.orderIds?.[0] ?? null),
        shipmentId: input.targetType === "shipment" ? input.targetId : (data.shipmentIds?.[0] ?? null),
        clientUid: data.clientUid,
        fromStatus: data.status,
        toStatus: input.status,
        publicNote: input.publicNote,
        dateChanges: null,
        actorUid: actor.uid,
        actorRole: "admin",
        at: now,
      });

      const notifType = notificationTypeForStatus(input.status);
      const label = statusLabel(input.status);
      batch.set(doc(collection(db, "notifications")), {
        recipientUid: data.clientUid,
        type: notifType,
        title:
          input.targetType === "shipment"
            ? `Colis ${data.trackingNumber ?? input.targetId} — ${label}`
            : `Commande ${input.targetId} — ${label}`,
        body: input.publicNote || `Nouveau statut enregistré : ${label}.`,
        orderId: input.targetType === "order" ? input.targetId : (data.orderIds?.[0] ?? null),
        shipmentId: input.targetType === "shipment" ? input.targetId : (data.shipmentIds?.[0] ?? null),
        createdAt: now,
        readAt: null,
        channels: ["in_app"],
      });

      writeTrackingGuard(tx,guard);
      return { ok: true };
    }));
  },

  async recordShipmentWeighing(raw: unknown): Promise<{
    actualWeightLb: number;
    ratePerLbCents: number;
    shippingFeeCents: number;
    shippingPaymentStatus: ShippingPaymentStatus;
  }> {
    const actor = requireSignedInStaff();
    const input = parseInput(recordShipmentWeighingSchema, raw);
    const db = getFirebaseDb();
    return withFirestoreCheck(() => runTransaction(db, async (tx) => {
      const ref = doc(db, "shipments", input.shipmentId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error("Colis introuvable.");
      if (snap.data()?.accountingManaged) throw new Error("Utilisez Comptabilité : les données financières de ce colis facturé sont figées.");
      const current = snap.data() as ShipmentDoc;
      if (current.status === "cancelled") {
        throw new Error("Impossible de peser un colis annulé.");
      }

      const relatedOrders: OrderDoc[] = [];
      const relatedShipments = new Map<string, ShipmentDoc>([[current.shipmentId, current]]);
      for (const oid of current.orderIds) {
        const orderSnap = await tx.get(doc(db, "orders", oid));
        if (!orderSnap.exists()) throw new Error("La commande associée est introuvable.");
        const order = orderSnap.data() as OrderDoc;
        if (order.clientUid !== current.clientUid) throw new Error("Le colis et la commande n'appartiennent pas au même client.");
        relatedOrders.push(order);
        for (const sid of order.shipmentIds) {
          if (relatedShipments.has(sid)) continue;
          const linked = await tx.get(doc(db, "shipments", sid));
          if (linked.exists()) relatedShipments.set(sid, linked.data() as ShipmentDoc);
        }
      }
      const nowIso = new Date().toISOString();
      let miamiReceivedAt = input.miamiReceivedAt ?? current.miamiReceivedAt ?? null;
      let nextStatus = current.status;
      if (!hasConfirmedMiamiReception(current)) {
        if (!input.confirmMiamiReceipt) {
          throw new Error("La réception physique à Miami doit être confirmée avant la pesée.");
        }
        miamiReceivedAt = input.miamiReceivedAt ?? nowIso;
        nextStatus = "received";
      } else if (!miamiReceivedAt) {
        miamiReceivedAt = nowIso;
      }

      const pricing = await tx.get(doc(db, "settings", "public"));
      const ratePerLbCents = current.ratePerLbCents ?? pricing.data()?.shippingRatePerLbCents ?? COMMERCIAL_RATE_CENTS_PER_LB;
      const shippingFeeCents = calculateShippingFeeCents(input.weightLb, ratePerLbCents);
      const prevWeight = current.actualWeightLb ?? null;
      const prevFee = current.shippingFeeCents ?? null;
      const isCorrection = prevWeight !== null;
      if (isCorrection && !input.reason?.trim()) {
        throw new Error("Un motif est obligatoire pour corriger une pesée existante.");
      }

      const entry: WeightCorrectionEntry = {
        previousWeightLb: prevWeight,
        newWeightLb: input.weightLb,
        previousFeeCents: prevFee,
        newFeeCents: shippingFeeCents,
        ratePerLbCents,
        reason: input.reason?.trim() || "Pesée initiale à l'entrepôt de Miami",
        recordedAt: nowIso,
        recordedByUid: actor.uid,
        recordedByEmail: actor.email || null,
      };
      const weightHistory = [...(current.weightHistory ?? []), entry];
      const paidAmountCents = current.paidAmountCents ?? 0;
      let nextPayStatus: ShippingPaymentStatus = current.shippingPaymentStatus ?? "unpaid";
      if (nextPayStatus === "paid" && isCorrection && shippingFeeCents !== paidAmountCents) {
        nextPayStatus = "adjustment_required";
      } else if (!current.shippingPaymentStatus) {
        nextPayStatus = "unpaid";
      }

      const batch = tx;
      const now = serverTimestamp();
      batch.update(ref, {
        status: nextStatus,
        lastStep: nextStatus === "received" ? Math.max(current.lastStep ?? 1, 1) : current.lastStep,
        miamiReceivedAt,
        dates: {...current.dates,warehouseReceivedAt:input.miamiReceivedAt??current.dates?.warehouseReceivedAt??miamiReceivedAt?.slice(0,10)??null},
        actualWeightLb: input.weightLb,
        ratePerLbCents,
        rateConfirmedAt: input.confirmRate ? nowIso : null,
        shippingFeeCents,
        shippingCurrency: "USD",
        shippingPaymentStatus: nextPayStatus,
        paidAmountCents,
        weighedAt: nowIso,
        weighedByUid: actor.uid,
        weightHistory,
        updatedAt: now,
      });

      relatedShipments.set(current.shipmentId, { ...current, status: nextStatus });
      for (const order of relatedOrders) {
        const items = order.items.map(item => ({ ...item, quantityReceived: Math.max(item.quantityReceived,
          current.lines.filter(line => line.orderId === order.orderId && line.lineId === item.lineId).reduce((sum, line) => sum + line.quantity, 0)) }));
        batch.update(doc(db, "orders", order.orderId), {
          items, stats: computeOrderStats(order.orderId, items, [...relatedShipments.values()]),
          ...(order.status !== "cancelled" ? { status: orderPackageStatus([...relatedShipments.values()].filter(s=>s.orderIds.includes(order.orderId)),order.shipmentIds.length===1?nextStatus:order.status) } : {}), updatedAt: now,
        });
      }

      const note = isCorrection
        ? `Poids corrigé : ${formatWeightLb(input.weightLb)} — Frais recalculés : ${formatMoney(shippingFeeCents, "USD")}.`
        : `Colis pesé à Miami : ${formatWeightLb(input.weightLb)} — Frais de livraison : ${formatMoney(shippingFeeCents, "USD")} (6,00 USD/lb).`;

      batch.set(doc(collection(db, "shipmentEvents")), {
        kind: "status",
        targetType: "shipment",
        orderId: current.orderIds[0] ?? null,
        shipmentId: current.shipmentId,
        clientUid: current.clientUid,
        fromStatus: current.status,
        toStatus: nextStatus,
        publicNote: note,
        dateChanges: null,
        actorUid: actor.uid,
        actorRole: "admin",
        at: now,
      });

      batch.set(doc(collection(db, "notifications")), {
        recipientUid: current.clientUid,
        type: "shipment_received",
        title: `Pesée enregistrée — colis ${current.trackingNumber}`,
        body: note,
        orderId: current.orderIds[0] ?? null,
        shipmentId: current.shipmentId,
        createdAt: now,
        readAt: null,
        channels: ["in_app"],
      });

      batch.set(doc(collection(db, "auditLogs")), {
        action: isCorrection ? "shipment.weigh_correct" : "shipment.weigh",
        actorUid: actor.uid,
        actorRole: "admin",
        targetType: "shipment",
        targetId: current.shipmentId,
        summary: note,
        details: {
          previousWeightLb: prevWeight,
          newWeightLb: input.weightLb,
          previousFeeCents: prevFee,
          newFeeCents: shippingFeeCents,
          ratePerLbCents,
        },
        at: now,
      });

      return {
        actualWeightLb: input.weightLb,
        ratePerLbCents,
        shippingFeeCents,
        shippingPaymentStatus: nextPayStatus,
      };
    }));
  },

  async updateShippingPayment(raw: unknown): Promise<{ ok: boolean }> {
    const actor = requireSignedInStaff();
    const input = parseInput(updateShippingPaymentSchema, raw);
    const db = getFirebaseDb();
    return withFirestoreCheck(async () => {
      const ref = doc(db, "shipments", input.shipmentId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error("Colis introuvable.");
      if (snap.data()?.accountingManaged) throw new Error("Utilisez Comptabilité : les données financières de ce colis facturé sont figées.");
      const current = snap.data() as ShipmentDoc;
      if (current.shippingFeeCents == null || current.shippingFeeCents <= 0) {
        throw new Error("Le colis doit d'abord être pesé à Miami avant d'enregistrer un paiement.");
      }
      const paidAmountCents =
        input.paidAmountCents !== null && input.paidAmountCents !== undefined
          ? input.paidAmountCents
          : input.shippingPaymentStatus === "paid"
            ? current.shippingFeeCents
            : (current.paidAmountCents ?? 0);

      const batch = writeBatch(db);
      const now = serverTimestamp();
      batch.update(ref, {
        shippingPaymentStatus: input.shippingPaymentStatus,
        paidAmountCents,
        updatedAt: now,
      });
      batch.set(doc(collection(db, "auditLogs")), {
        action: "shipment.payment_status",
        actorUid: actor.uid,
        actorRole: "admin",
        targetType: "shipment",
        targetId: current.shipmentId,
        summary: `Statut de paiement du colis ${current.trackingNumber} : ${input.shippingPaymentStatus}`,
        details: {
          previousStatus: current.shippingPaymentStatus ?? null,
          nextStatus: input.shippingPaymentStatus,
          paidAmountCents,
          note: input.note ?? null,
        },
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
      if ((await getDoc(doc(db, "orderFinance", input.orderId))).data()?.accountingManaged) throw new Error("Utilisez le module Comptabilité pour cette commande facturée.");
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
      if ((await getDoc(doc(db, "orderFinance", input.orderId))).data()?.accountingManaged) throw new Error("Utilisez le module Comptabilité pour cette commande facturée.");
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
      if (finSnap.data()?.accountingManaged) throw new Error("Utilisez le module Comptabilité pour cette commande facturée.");
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
      if (finSnap.data()?.accountingManaged) throw new Error("Utilisez le module Comptabilité pour cette commande facturée.");
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
      const batch = writeBatch(db);
      // Conserver les tarifs réservés à la comptabilité et enregistrer les deux
      // documents atomiquement, dans les collections utilisées par le serveur.
      batch.set(doc(db, "settings", "public"), { ...input.publicSettings, isExample: false, updatedAt: serverTimestamp() }, { merge: true });
      batch.set(doc(db, "settings", "private"), { ...input.privateSettings, updatedAt: serverTimestamp() }, { merge: true });
      await batch.commit();
      return { ok: true };
    });
  },
};
