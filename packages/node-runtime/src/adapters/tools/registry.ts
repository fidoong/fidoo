import type { ToolDefinition } from "@fidoo/core";
import { bashTool } from "./bash.js";
import { editFileTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { readFileTool } from "./read.js";
import { reportBlockedTool } from "./report-blocked.js";
import { writeFileTool } from "./write.js";

export function createCodingTools(): ToolDefinition[] {
  return [
    readFileTool,
    globTool,
    grepTool,
    editFileTool,
    writeFileTool,
    bashTool,
    reportBlockedTool,
  ];
}
