import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@fidoo/agent-server": source("./apps/agent-server/src/stdio-server.ts"),
      "@fidoo/tui": source("./packages/tui/src/index.tsx"),
      "@fidoo/client/stdio": source("./packages/client/src/stdio.ts"),
      "@fidoo/core": source("./packages/core/src/index.ts"),
      "@fidoo/node-runtime": source("./packages/node-runtime/src/index.ts"),
      "@fidoo/protocol": source("./packages/protocol/src/index.ts"),
      "@fidoo/api": source("./packages/api/src/index.ts"),
      "@fidoo/client": source("./packages/client/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
