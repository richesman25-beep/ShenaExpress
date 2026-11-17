import { defineConfig } from "@playwright/test";
import base from "./playwright.accounting.config";
export default defineConfig({
  ...base,
  testMatch: [
    "multi-package.spec.ts",
    "order-creation.spec.ts",
    "accounting.spec.ts",
  ],
  projects: [
    ...base.projects!,
    {
      name: "tablet",
      use: {
        browserName: "chromium",
        viewport: { width: 768, height: 1024 },
        hasTouch: true,
      },
    },
  ],
});
