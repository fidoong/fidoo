import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { WorkspacePort } from "@fidoo/core";
import { AgentError } from "@fidoo/core";

export class LocalWorkspace implements WorkspacePort {
  async assertDirectory(cwd: string): Promise<string> {
    const requested = resolve(cwd);
    let root: string;
    try {
      root = await realpath(requested);
    } catch {
      throw new AgentError(
        `Workspace directory does not exist or is not accessible: ${requested}. Pass an existing project directory with --cwd.`,
        "configuration",
      );
    }
    if (!(await stat(root)).isDirectory()) {
      throw new AgentError(`Workspace path is not a directory: ${root}`, "configuration");
    }
    return root;
  }
}
