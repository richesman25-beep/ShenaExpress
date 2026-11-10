import type { CallableOptions } from "firebase-functions/v2/https";

/**
 * Options communes des fonctions appelables.
 * - Région proche d'Haïti par défaut (modifiable via FUNCTIONS_REGION).
 * - App Check activable (ENFORCE_APP_CHECK=true) pour limiter les appels abusifs hors de l'application.
 * - Nombre d'instances plafonné pour maîtriser les coûts en cas d'abus.
 */
export function callableOptions(opts: { public?: boolean } = {}): CallableOptions {
  return {
    region: process.env.FUNCTIONS_REGION || "us-east1",
    enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true",
    maxInstances: opts.public ? 5 : 10,
    timeoutSeconds: 60,
    memory: "256MiB",
    cors: true,
  };
}
