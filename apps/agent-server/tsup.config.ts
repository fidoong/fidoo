import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/stdio-server.ts"],
  outDir: "dist",
  format: ["esm"],
  target: "node22",
  platform: "node",
  sourcemap: true,
  clean: true,
  dts: true,
  shims: true,
});
