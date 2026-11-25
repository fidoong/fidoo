import type { RequiredCheck, ToolDefinition } from "@fidoo/core";
import { trackMutation } from "../changes/track-mutation.js";
import { WorkspaceChangeManager } from "../changes/workspace-change-manager.js";
import { BackgroundTaskManager } from "../tasks/background-task-manager.js";
import { createBashTool } from "./bash.js";
import { editFileTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { createMutationTools } from "./mutations.js";
import { readFileTool } from "./read.js";
import { readImageTool } from "./read-image.js";
import { listDirectoryTool, readManyFilesTool } from "./read-many.js";
import { repoMapTool } from "./repo-map.js";
import { reportBlockedTool } from "./report-blocked.js";
import { createRequiredChecksTool } from "./required-checks.js";
import { createTaskTools } from "./tasks.js";
import { createWorkspaceTools } from "./workspace.js";
import { writeFileTool } from "./write.js";

export function createCodingTools(
  tasks = new BackgroundTaskManager(),
  requiredChecks: readonly RequiredCheck[] = [],
  changes = new WorkspaceChangeManager(),
): ToolDefinition[] {
  return [
    readFileTool,
    readManyFilesTool,
    readImageTool,
    listDirectoryTool,
    repoMapTool,
    globTool,
    grepTool,
    trackMutation(editFileTool, changes),
    trackMutation(writeFileTool, changes),
    ...createMutationTools(changes),
    ...createWorkspaceTools(changes),
    createBashTool(tasks, requiredChecks),
    createRequiredChecksTool(requiredChecks, changes),
    ...createTaskTools(tasks),
    reportBlockedTool,
  ];
}
