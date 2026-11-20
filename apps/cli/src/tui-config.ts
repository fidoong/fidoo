import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage } from "@fidoo/core";
import { DEFAULT_THEME, parseThemePreference, type ThemePreference } from "@fidoo/tui";

export async function readTuiConfig(dataHome: string): Promise<ThemePreference> {
  const path = configPath(dataHome);
  try {
    return parseThemePreference(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return DEFAULT_THEME;
    }
    throw new Error(`Invalid TUI config at ${path}: ${errorMessage(error)}`);
  }
}

export async function writeTuiConfig(dataHome: string, preference: ThemePreference): Promise<void> {
  await mkdir(dataHome, { recursive: true, mode: 0o700 });
  const path = configPath(dataHome);
  const temporary = join(dataHome, `.tui-${process.pid}-${Date.now()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(preference, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function configPath(dataHome: string): string {
  return join(dataHome, "tui.json");
}
