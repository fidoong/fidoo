import { AgentError } from "../domain/errors.js";
import type { ToolDefinition } from "../ports/tool.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(tools: ToolDefinition[]) {
    for (const tool of tools) {
      if (this.tools.has(tool.name)) {
        throw new AgentError(`Duplicate tool: ${tool.name}`, "configuration");
      }
      this.tools.set(tool.name, tool);
    }
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }
}
