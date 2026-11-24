import type { RequiredCheck, ToolDefinition } from "@fidoo/core";
import { BackgroundTaskManager } from "../tasks/background-task-manager.js";
import { createBashTool } from "./bash.js";
import { editFileTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { readFileTool } from "./read.js";
import { repoMapTool } from "./repo-map.js";
import { reportBlockedTool } from "./report-blocked.js";
import { createTaskTools } from "./tasks.js";
import { writeFileTool } from "./write.js";

export function createCodingTools(
  tasks = new BackgroundTaskManager(),
  requiredChecks: readonly RequiredCheck[] = [],
): ToolDefinition[] {
  return [
    readFileTool,
    repoMapTool,
    globTool,
    grepTool,
    editFileTool,
    writeFileTool,
    createBashTool(tasks, requiredChecks),
    ...createTaskTools(tasks),
    reportBlockedTool,
  ];
}
