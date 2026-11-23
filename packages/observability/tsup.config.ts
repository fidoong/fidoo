import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["esm"],
  target: "node22",
  platform: "neutral",
  sourcemap: true,
  clean: true,
  dts: true,
});
