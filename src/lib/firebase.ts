import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAnalytics, isSupported as isAnalyticsSupported } from "firebase/analytics";
import { getAuth, connectAuthEmulator, type Auth } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, type Firestore } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator, type Functions } from "firebase/functions";

export interface RuntimeFirebaseState {
  mode: "production" | "emulator" | "unconfigured";
  projectId: string;
  region: string;
  configError?: string;
}

const DEMO_CONFIG = {
  apiKey: "demo-api-key",
  authDomain: "demo-shena.firebaseapp.com",
  projectId: "demo-shena",
  appId: "1:000000000000:web:000000000000",
  measurementId: undefined as string | undefined,
};

function readEnvConfig() {
  const env = import.meta.env ?? {};
  const apiKey = (env.VITE_FIREBASE_API_KEY as string | undefined)?.trim();
  const authDomain = (env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined)?.trim();
  const projectId = (env.VITE_FIREBASE_PROJECT_ID as string | undefined)?.trim();
  const appId = (env.VITE_FIREBASE_APP_ID as string | undefined)?.trim();
  const storageBucket = (env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined)?.trim();
  const messagingSenderId = (env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined)?.trim();
  const measurementId = (env.VITE_FIREBASE_MEASUREMENT_ID as string | undefined)?.trim();
  const region = ((env.VITE_FIREBASE_FUNCTIONS_REGION as string | undefined) || "us-east1").trim();
  const forceEmulators = (env.VITE_USE_EMULATORS as string | undefined)?.trim() === "true";
  const isProdBuild = Boolean(env.PROD) && !forceEmulators;

  const hasRealConfig =
    Boolean(apiKey && authDomain && projectId && appId) &&
    !projectId!.startsWith("demo-") &&
    apiKey !== "demo-api-key";

  if (isProdBuild) {
    if (!hasRealConfig) {
      return {
        state: {
          mode: "unconfigured" as const,
          projectId: projectId || "",
          region,
          configError:
            "Configuration Firebase de production manquante ou invalide. Renseignez VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID et VITE_FIREBASE_APP_ID avant le build de production.",
        },
        firebaseConfig: null,
      };
    }
    return {
      state: { mode: "production" as const, projectId: projectId!, region },
      firebaseConfig: {
        apiKey: apiKey!,
        authDomain: authDomain!,
        projectId: projectId!,
        appId: appId!,
        storageBucket,
        messagingSenderId,
        measurementId,
      },
    };
  }

  if (hasRealConfig && !forceEmulators) {
    return {
      state: { mode: "production" as const, projectId: projectId!, region },
      firebaseConfig: {
        apiKey: apiKey!,
        authDomain: authDomain!,
        projectId: projectId!,
        appId: appId!,
        storageBucket,
        messagingSenderId,
        measurementId,
      },
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
    throw new Error(resolved.state.configError || "Firebase non configuré.");
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
