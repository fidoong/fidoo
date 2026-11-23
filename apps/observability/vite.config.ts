import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@fidoo/observability": fileURLToPath(
        new URL("../../packages/observability/src/index.ts", import.meta.url),
      ),
    },
  },
  root: "src/web",
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/v1/observability": "http://127.0.0.1:4173",
    },
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
});
