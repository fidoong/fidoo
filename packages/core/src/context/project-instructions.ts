import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function loadProjectInstructions(cwd: string): Promise<string | undefined> {
  try {
    return await readFile(join(cwd, "AGENTS.md"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
