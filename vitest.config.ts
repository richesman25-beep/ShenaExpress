import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const alias = {
  "@shared": resolve(import.meta.dirname, "./shared"),
  "@": resolve(import.meta.dirname, "./src"),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/setup.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "emulator",
          environment: "node",
          include: ["tests/emulator/**/*.test.ts"],
          testTimeout: 120000,
          fileParallelism: false,
        },
      },
    ],
  },
});
