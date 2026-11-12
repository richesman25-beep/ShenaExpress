import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAnalytics, isSupported as isAnalyticsSupported } from "firebase/analytics";
import { getAuth, connectAuthEmulator, type Auth } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, type Firestore } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator, type Functions } from "firebase/functions";

export interface FirebaseEnvValidation {
  valid: boolean;
  missingVars: string[];
  malformedVars: { name: string; reason: string }[];
  errorMessage?: string;
  config: {
    apiKey: string;
    authDomain: string;
    databaseURL?: string;
    projectId: string;
    appId: string;
    storageBucket?: string;
    messagingSenderId?: string;
    measurementId?: string;
    region: string;
  } | null;
}

export interface RuntimeFirebaseState {
  mode: "production" | "emulator" | "unconfigured";
  projectId: string;
  region: string;
  configError?: string;
  missingVars?: string[];
  malformedVars?: { name: string; reason: string }[];
}

const DEMO_CONFIG = {
  apiKey: "demo-api-key",
  authDomain: "demo-shena.firebaseapp.com",
  projectId: "demo-shena",
  appId: "1:000000000000:web:000000000000",
  measurementId: undefined as string | undefined,
};

const DEFAULT_PRODUCTION_CONFIG = {
  apiKey: "AIzaSyDzb42MNgabaOKe3brkWp7S3uXMa8WhLxE",
  authDomain: "shenaexpress-13924.firebaseapp.com",
  databaseURL: undefined as string | undefined,
  projectId: "shenaexpress-13924",
  storageBucket: "shenaexpress-13924.firebasestorage.app",
  messagingSenderId: "447281041430",
  appId: "1:447281041430:web:ce2292f951c29f9fc86537",
  measurementId: "G-14W9DE36MY",
  region: "us-east1",
};

/** Nettoie les guillemets ou virgules de fin souvent copiés par erreur depuis un extrait JS dans Netlify. */
function cleanEnvValue(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .replace(/,+$/, "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
}

/**
 * Valide les variables VITE_FIREBASE_* en distinguant clairement les variables absentes
 * des valeurs mal formées, sans jamais exposer le contenu des clés dans le message d'erreur.
 */
export function validateFirebaseEnv(env: Record<string, unknown>): FirebaseEnvValidation {
  const apiKey = cleanEnvValue(env.VITE_FIREBASE_API_KEY);
  const authDomain = cleanEnvValue(env.VITE_FIREBASE_AUTH_DOMAIN);
  const databaseURL = cleanEnvValue(env.VITE_FIREBASE_DATABASE_URL) || undefined;
  const projectId = cleanEnvValue(env.VITE_FIREBASE_PROJECT_ID);
  const appId = cleanEnvValue(env.VITE_FIREBASE_APP_ID);
  const storageBucket = cleanEnvValue(env.VITE_FIREBASE_STORAGE_BUCKET) || undefined;
  const messagingSenderId = cleanEnvValue(env.VITE_FIREBASE_MESSAGING_SENDER_ID) || undefined;
  const measurementId = cleanEnvValue(env.VITE_FIREBASE_MEASUREMENT_ID) || undefined;
  const region = cleanEnvValue(env.VITE_FIREBASE_FUNCTIONS_REGION) || "us-east1";

  const missingVars: string[] = [];
  const malformedVars: { name: string; reason: string }[] = [];

  if (!apiKey) {
    missingVars.push("VITE_FIREBASE_API_KEY");
  } else if (apiKey === "demo-api-key" || !/^AIza[0-9A-Za-z_-]{25,}$/.test(apiKey)) {
    malformedVars.push({
      name: "VITE_FIREBASE_API_KEY",
      reason: "doit être une clé Web Firebase valide commençant par « AIza »",
    });
  }

  if (!authDomain) {
    missingVars.push("VITE_FIREBASE_AUTH_DOMAIN");
  } else if (
    /^https?:\/\//i.test(authDomain) ||
    authDomain.includes("/") ||
    authDomain.startsWith("demo-") ||
    !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(authDomain)
  ) {
    malformedVars.push({
      name: "VITE_FIREBASE_AUTH_DOMAIN",
      reason: "doit être un nom de domaine seul sans https:// ni barre oblique (ex. shenaexpress-13924.firebaseapp.com)",
    });
  }

  if (!projectId) {
    missingVars.push("VITE_FIREBASE_PROJECT_ID");
  } else if (projectId.startsWith("demo-") || !/^[a-z0-9-]{4,36}$/.test(projectId)) {
    malformedVars.push({
      name: "VITE_FIREBASE_PROJECT_ID",
      reason: "doit contenir uniquement des lettres minuscules, chiffres et tirets (ex. shenaexpress-13924)",
    });
  }

  if (!appId) {
    missingVars.push("VITE_FIREBASE_APP_ID");
  } else if (appId === DEMO_CONFIG.appId || !/^\d+:\d+:web:[0-9a-f]+$/i.test(appId)) {
    malformedVars.push({
      name: "VITE_FIREBASE_APP_ID",
      reason: "doit respecter l'identifiant d'application Web Firebase au format 1:XXXX:web:XXXX",
    });
  }

  if (missingVars.length === 0 && malformedVars.length === 0) {
    return {
      valid: true,
      missingVars: [],
      malformedVars: [],
      config: {
        apiKey,
        authDomain,
        databaseURL,
        projectId,
        appId,
        storageBucket,
        messagingSenderId,
        measurementId,
        region,
      },
    };
  }

  const parts: string[] = [];
  if (missingVars.length > 0) {
    parts.push(`Variable(s) absente(s) lors du build : ${missingVars.join(", ")}.`);
  }
  if (malformedVars.length > 0) {
    parts.push(
      `Variable(s) mal formée(s) : ${malformedVars.map((m) => `${m.name} (${m.reason})`).join(" ; ")}.`,
    );
  }
  parts.push("Configurez ces variables dans votre hébergeur (ex. Netlify > Environment variables) ou dans .env.local puis relancez un build.");

  return {
    valid: false,
    missingVars,
    malformedVars,
    errorMessage: `Configuration Firebase de production invalide. ${parts.join(" ")}`,
    config: null,
  };
}

function readEnvConfig() {
  const env = (import.meta.env ?? {}) as Record<string, unknown>;
  const validation = validateFirebaseEnv(env);
  const region = cleanEnvValue(env.VITE_FIREBASE_FUNCTIONS_REGION) || "us-east1";
  const forceEmulators = cleanEnvValue(env.VITE_USE_EMULATORS) === "true";
  const isProdBuild = Boolean(env.PROD) && !forceEmulators;

  const activeConfig =
    validation.valid && validation.config && validation.config.projectId !== "creo-store"
      ? validation.config
      : DEFAULT_PRODUCTION_CONFIG;

  if (isProdBuild) {
    return {
      state: { mode: "production" as const, projectId: activeConfig.projectId, region: activeConfig.region },
      firebaseConfig: activeConfig,
    };
  }

  if (validation.valid && validation.config && !forceEmulators) {
    return {
      state: { mode: "production" as const, projectId: activeConfig.projectId, region: activeConfig.region },
      firebaseConfig: activeConfig,
    };
  }

  return {
    state: { mode: "emulator" as const, projectId: DEMO_CONFIG.projectId, region },
    firebaseConfig: DEMO_CONFIG,
  };
}

const resolved = readEnvConfig();
export const firebaseState: RuntimeFirebaseState = resolved.state;

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;
let functionsInstance: Functions | null = null;
let emulatorsConnected = false;

function ensureInitialized() {
  if (!resolved.firebaseConfig) {
    throw new Error(firebaseState.configError || "Firebase non configuré.");
  }
  if (!appInstance) {
    appInstance = getApps()[0] ?? initializeApp(resolved.firebaseConfig);
    authInstance = getAuth(appInstance);
    authInstance.languageCode = "fr";
    dbInstance = getFirestore(appInstance);
    functionsInstance = getFunctions(appInstance, resolved.state.region);

    if (resolved.state.mode === "emulator" && !emulatorsConnected) {
      const host = typeof window !== "undefined" && window.location.hostname ? window.location.hostname : "127.0.0.1";
      connectAuthEmulator(authInstance, `http://${host}:9099`, { disableWarnings: true });
      connectFirestoreEmulator(dbInstance, host, 8080);
      connectFunctionsEmulator(functionsInstance, host, 5001);
      emulatorsConnected = true;
    } else if (typeof window !== "undefined" && resolved.firebaseConfig.measurementId) {
      isAnalyticsSupported()
        .then((yes) => {
          if (yes && appInstance) getAnalytics(appInstance);
        })
        .catch(() => undefined);
    }
  }
  return { app: appInstance!, auth: authInstance!, db: dbInstance!, functions: functionsInstance! };
}

export const getFirebaseAuth = (): Auth => ensureInitialized().auth;
export const getFirebaseDb = (): Firestore => ensureInitialized().db;
export const getFirebaseFunctions = (): Functions => ensureInitialized().functions;
