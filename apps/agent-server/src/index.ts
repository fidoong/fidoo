#!/usr/bin/env node
import { AgentApi } from "@fidoo/api";
import { errorMessage } from "@fidoo/core";
import { createNodeRuntime } from "@fidoo/node-runtime";
import { Command, InvalidArgumentError } from "commander";
import type { ServerOptions } from "./config.js";
import { resolveServerConfig } from "./config.js";
import { StdioServer } from "./stdio-server.js";

const program = new Command();
program
  .name("fidoo-server")
  .description("Fidoo Agent API server")
  .version("0.1.0")
  .option("--stdio", "serve newline-delimited JSON-RPC over stdio")
  .option("--cwd <path>", "workspace directory", process.cwd())
  .option("--provider <name>", "openai or deepseek")
  .option("--model <name>", "model name; defaults to FIDOO_MODEL")
  .option("--base-url <url>", "OpenAI-compatible API base URL")
  .option("--thinking <mode>", "DeepSeek thinking: enabled or disabled", parseThinking)
  .option("-y, --yes", "auto-approve medium-risk operations")
  .option("--read-only", "deny all write and execute operations")
  .option("--max-iterations <number>", "agent iteration budget", "40")
  .configureOutput({
    writeOut: (text) => process.stderr.write(text),
    writeErr: (text) => process.stderr.write(text),
  })
  .showHelpAfterError();

try {
  program.parse(process.argv);
  const options = program.opts<ServerOptions>();
  if (!options.stdio) {
    throw new Error("Select a transport with --stdio");
  }
  const runtime = await createNodeRuntime(resolveServerConfig(options));
  const api = new AgentApi({
    createRunService: runtime.createRunService,
    eventStore: runtime.eventStore,
    workspace: runtime.workspace,
  });
  const server = new StdioServer(api);
  server.listen();
  process.once("SIGINT", () => {
    void server.close().finally(() => {
      process.exitCode = 130;
    });
  });
} catch (error) {
  process.stderr.write(`Error: ${errorMessage(error)}\n`);
  process.exitCode = 1;
}

function parseThinking(value: string): "enabled" | "disabled" {
  if (value === "enabled" || value === "disabled") {
    return value;
  }
  throw new InvalidArgumentError("Thinking must be enabled or disabled");
}
