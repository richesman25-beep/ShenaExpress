import { defineConfig } from "@playwright/test";

// Ce parcours est exclusivement destiné au projet demo-shena et aux émulateurs.
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["accounting.spec.ts", "order-creation.spec.ts"],
  timeout: 60000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4199", trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      use: { browserName: "chromium", viewport: { width: 1280, height: 900 } },
    },
    {
      name: "mobile-android",
      use: {
        browserName: "chromium",
        viewport: { width: 412, height: 915 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "npx vite --port 4199 --strictPort --host 127.0.0.1",
    env: { VITE_USE_EMULATORS: "true" },
    url: "http://127.0.0.1:4199",
    reuseExistingServer: false,
  },
});
