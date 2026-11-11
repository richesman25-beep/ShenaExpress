import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@shared": resolve(import.meta.dirname, "./shared"),
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    headers: {
      "Cache-Control": "no-store",
    },
  },
  preview: {
    port: 5173,
    headers: {
      "Cache-Control": "no-store",
    },
  },
});
