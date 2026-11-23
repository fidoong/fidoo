import type { ToolDefinition } from "@fidoo/core";
import { bashTool } from "./bash.js";
import { editFileTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { readFileTool } from "./read.js";
import { repoMapTool } from "./repo-map.js";
import { reportBlockedTool } from "./report-blocked.js";
import { writeFileTool } from "./write.js";

export function createCodingTools(): ToolDefinition[] {
  return [
    readFileTool,
    repoMapTool,
    globTool,
    grepTool,
    editFileTool,
    writeFileTool,
    bashTool,
    reportBlockedTool,
  ];
}
