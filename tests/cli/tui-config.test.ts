import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readTuiConfig, writeTuiConfig } from "../../apps/cli/src/tui-config.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("TUI config persistence", () => {
  it("uses the Next preset when no config exists", async () => {
    const directory = await workspace();
    await expect(readTuiConfig(directory)).resolves.toEqual({ preset: "next" });
  });

  it("round-trips the selected preset and custom colors", async () => {
    const directory = await workspace();
    const preference = {
      preset: "midnight" as const,
      colors: { accent: "#ff8800", muted: "#999999" },
    };
    await writeTuiConfig(directory, preference);
    await expect(readTuiConfig(directory)).resolves.toEqual(preference);
  });

  it("reports an invalid config instead of silently discarding it", async () => {
    const directory = await workspace();
    await writeFile(join(directory, "tui.json"), '{"preset":"missing"}\n');
    await expect(readTuiConfig(directory)).rejects.toThrow("Unknown theme preset");
  });
});

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "fidoo-tui-config-"));
  directories.push(directory);
  return directory;
}
