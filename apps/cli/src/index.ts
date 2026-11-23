#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { AgentApi, InProcessTransport } from "@fidoo/api";
import type { AgentClient } from "@fidoo/client";
import { createAgentClient } from "@fidoo/client";
import { createEvent, errorMessage, replayRun } from "@fidoo/core";
import {
  createNodeRuntime,
  FileEventStore,
  InteractiveApproval,
  LocalWorkspace,
  loadPermissionPolicy,
} from "@fidoo/node-runtime";
import type { PublicRunEvent, RunSnapshot } from "@fidoo/protocol";
import { Command, InvalidArgumentError } from "commander";
import type { GlobalOptions, OutputFormat, RuntimeConfig } from "./config.js";
import {
  dataHome,
  parseProvider,
  parseThinking,
  resolveRuntimeConfig,
  serverArguments,
} from "./config.js";
import { renderFinal, renderPublicEvent } from "./output.js";

const program = new Command();
program
  .name("fidoo")
  .description("Fidoo — provider-neutral, verification-driven coding agent")
  .version("0.1.0")
  .option("--cwd <path>", "workspace directory", process.cwd())
  .option("--provider <name>", "openai or deepseek", parseProvider)
  .option("--model <name>", "model name; defaults to FIDOO_MODEL")
  .option("--base-url <url>", "OpenAI-compatible API base URL")
  .option("--thinking <mode>", "DeepSeek thinking: enabled or disabled", parseThinking)
  .option("-y, --yes", "auto-approve medium-risk operations")
  .option("--read-only", "deny all write and execute operations")
  .option("--policy <path>", "additional trusted permission policy JSON")
  .option("--output <format>", "text, json, or jsonl", parseOutput, "text")
  .option("--max-iterations <number>", "agent iteration budget", "40")
  .showHelpAfterError();

program
  .command("run")
  .description("start a coding task")
  .argument("<task...>", "task description")
  .action(async (parts: string[]) => {
    const options = program.opts<GlobalOptions>();
    const config = resolveRuntimeConfig(options);
    const client = await createApiClient(config);
    const { runId } = await client.run.start({ task: parts.join(" "), cwd: config.cwd });
    const state = await withCancellation((signal) => executeRun(client, runId, config, signal));
    finish(state, config.output);
  });

program
  .command("resume")
  .description("resume a run without replaying interrupted side effects")
  .argument("<runId>", "run identifier")
  .argument("[task...]", "additional user instruction")
  .action(async (runId: string, parts: string[]) => {
    const options = program.opts<GlobalOptions>();
    const config = resolveRuntimeConfig(options);
    const client = await createApiClient(config);
    await client.run.resume({ runId, task: parts.length ? parts.join(" ") : undefined });
    const state = await withCancellation((signal) => executeRun(client, runId, config, signal));
    finish(state, config.output);
  });

program
  .command("tui")
  .description("open the interactive terminal UI backed by fidoo-server --stdio")
  .action(async () => {
    const options = program.opts<GlobalOptions>();
    await launchTui(resolveRuntimeConfig(options));
  });

program
  .command("cancel")
  .description("mark a run cancelled")
  .argument("<runId>", "run identifier")
  .action(async (runId: string) => {
    const options = program.opts<GlobalOptions>();
    const store = new FileEventStore(dataHome());
    const events = await store.load(runId);
    let state = replayRun(runId, events);
    if (state.status === "running") {
      await store.append(
        createEvent(
          {
            eventId: randomUUID(),
            runId,
            seq: events.length + 1,
            timestamp: new Date().toISOString(),
          },
          "run.cancelled",
          {
            reason:
              "Cancelled through CLI; active processes must be interrupted in their own terminal",
          },
        ),
      );
      state = replayRun(runId, await store.load(runId));
    }
    finish(
      {
        runId: state.runId,
        task: state.task,
        cwd: state.cwd,
        status: state.status,
        changedFiles: [...state.changedFiles],
        verified: state.lastMutationSeq > 0 && state.lastVerificationSeq >= state.lastMutationSeq,
        ...(state.finalSummary ? { finalSummary: state.finalSummary } : {}),
        ...(state.error ? { error: state.error } : {}),
      },
      options.output,
    );
  });

program
  .command("sessions")
  .description("list local runs")
  .action(async () => {
    const options = program.opts<GlobalOptions>();
    const sessions = await new FileEventStore(dataHome()).list();
    if (options.output === "text") {
      for (const session of sessions) {
        process.stdout.write(
          `${session.runId}\t${session.status}\t${session.updatedAt}\t${session.task}\n`,
        );
      }
    } else {
      process.stdout.write(`${JSON.stringify(sessions)}\n`);
    }
  });

program
  .command("trace")
  .description("print the canonical event trajectory")
  .argument("<runId>", "run identifier")
  .action(async (runId: string) => {
    const options = program.opts<GlobalOptions>();
    const events = await new FileEventStore(dataHome()).load(runId);
    if (options.output === "text") {
      for (const event of events) {
        process.stdout.write(
          `${event.seq}\t${event.timestamp}\t${event.type}\t${JSON.stringify(event.payload)}\n`,
        );
      }
    } else {
      process.stdout.write(`${JSON.stringify(events)}\n`);
    }
  });

program
  .command("doctor")
  .description("inspect local configuration without calling the provider")
  .action(async () => {
    const options = program.opts<GlobalOptions>();
    const provider = parseProvider(options.provider ?? process.env.FIDOO_PROVIDER);
    const model =
      options.model ??
      process.env.FIDOO_MODEL ??
      (provider === "deepseek" ? "deepseek-flash" : undefined);
    const configuredBaseURL =
      options.baseUrl ??
      process.env.FIDOO_BASE_URL ??
      (provider === "deepseek" ? process.env.DEEPSEEK_BASE_URL : process.env.OPENAI_BASE_URL);
    const baseURL =
      configuredBaseURL ??
      (provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com/v1");
    let workspace: { path: string; valid: boolean; error?: string };
    try {
      workspace = {
        path: await new LocalWorkspace().assertDirectory(options.cwd),
        valid: true,
      };
    } catch (error) {
      workspace = { path: options.cwd, valid: false, error: errorMessage(error) };
    }
    let permission: {
      valid: boolean;
      mode?: string;
      sources?: string[];
      ruleCount?: number;
      error?: string;
    };
    try {
      const policy = await loadPermissionPolicy({
        cwd: options.cwd,
        dataHome: dataHome(),
        ...(options.policy ? { policyFile: options.policy } : {}),
      });
      permission = {
        valid: true,
        mode: options.readOnly ? "read-only" : options.yes ? "auto" : (policy.mode ?? "ask"),
        sources: policy.sources,
        ruleCount: policy.rules.length,
      };
    } catch (error) {
      permission = { valid: false, error: errorMessage(error) };
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          node: process.version,
          cwd: options.cwd,
          workspace,
          dataHome: dataHome(),
          permission,
          provider,
          model,
          modelConfigured:
            provider === "deepseek" || Boolean(options.model ?? process.env.FIDOO_MODEL),
          baseURL: safeBaseURL(baseURL),
          providerTimeoutMs: 120_000,
          apiKeyConfigured: Boolean(
            process.env.FIDOO_API_KEY ??
              (provider === "deepseek" ? process.env.DEEPSEEK_API_KEY : process.env.OPENAI_API_KEY),
          ),
          baseURLConfigured: Boolean(configuredBaseURL),
          thinking: provider === "deepseek" ? (options.thinking ?? "enabled") : undefined,
        },
        null,
        2,
      )}\n`,
    );
  });

program.action(async () => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    program.outputHelp();
    return;
  }
  await launchTui(resolveRuntimeConfig(program.opts<GlobalOptions>()));
});

async function launchTui(config: RuntimeConfig): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("The TUI requires a TTY; use agent run for text, JSON, or JSONL output");
  }
  const [{ connectAgentServer }, { renderTui }, { readTuiConfig, writeTuiConfig }] =
    await Promise.all([
      import("@fidoo/client/stdio"),
      import("@fidoo/tui"),
      import("./tui-config.js"),
    ]);
  const preference = await readTuiConfig(config.dataHome);
  const connection = connectAgentServer({ serverArgs: serverArguments(config) });
  let app: ReturnType<typeof renderTui> | undefined;
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    void app?.controller.cancel().finally(() => app?.unmount());
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  try {
    const workspace = await connection.client.workspace.validate({ cwd: config.cwd });
    if (!workspace.valid) {
      throw new Error(workspace.error ?? `Invalid workspace: ${config.cwd}`);
    }
    app = renderTui({
      client: connection.client,
      cwd: config.cwd,
      provider: config.provider,
      model: config.model,
      theme: preference,
      onThemeChange: (next) => writeTuiConfig(config.dataHome, next),
    });
    if (shuttingDown) {
      app.unmount();
    }
    await app.waitUntilExit();
  } finally {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    await connection.close();
  }
}

async function createApiClient(config: RuntimeConfig): Promise<AgentClient> {
  const runtime = await createNodeRuntime(config);
  const api = new AgentApi({
    createRunService: runtime.createRunService,
    eventStore: runtime.eventStore,
    artifacts: runtime.artifacts,
    workspace: runtime.workspace,
  });
  return createAgentClient(new InProcessTransport(api));
}

async function executeRun(
  client: AgentClient,
  runId: string,
  config: RuntimeConfig,
  signal: AbortSignal,
): Promise<RunSnapshot> {
  const calls = new Map<string, { id: string; name: string; arguments: string }>();
  const cancel = () => {
    void client.run.cancel({ runId }).catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for await (const event of client.run.subscribe({ runId, afterSeq: 0 })) {
      renderPublicEvent(event, config.output);
      await handleApproval(client, event, calls, config.output, signal);
    }
    return await client.run.get({ runId });
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

async function handleApproval(
  client: AgentClient,
  event: PublicRunEvent,
  calls: Map<string, { id: string; name: string; arguments: string }>,
  output: OutputFormat,
  signal: AbortSignal,
): Promise<void> {
  if (event.type === "tool.proposed") {
    const call = event.payload.call as { id: string; name: string; arguments: string };
    calls.set(call.id, call);
    return;
  }
  if (event.type !== "tool.approval_required") {
    return;
  }
  const call = calls.get(String(event.payload.callId));
  if (!call) {
    throw new Error(`Missing tool proposal for ${String(event.payload.callId)}`);
  }
  const risk = event.payload.risk as "low" | "medium" | "high";
  const reason = String(event.payload.reason);
  const approval =
    output === "text"
      ? await new InteractiveApproval().approve({ runId: event.runId, call, risk, reason }, signal)
      : { approved: false, reason: "Approval is unavailable in non-interactive mode" };
  await client.approval.respond({
    runId: event.runId,
    callId: call.id,
    decision: approval.approved ? "approved" : "rejected",
    reason: approval.reason,
  });
}

async function withCancellation<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  try {
    return await operation(controller.signal);
  } finally {
    process.removeListener("SIGINT", cancel);
  }
}

function finish(state: RunSnapshot, format: OutputFormat): void {
  renderFinal(state, format);
  process.exitCode =
    state.status === "completed"
      ? 0
      : state.status === "cancelled"
        ? 130
        : state.status === "blocked"
          ? 2
          : 1;
}

function safeBaseURL(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "invalid Base URL";
  }
}

function parseOutput(value: string): OutputFormat {
  if (value === "text" || value === "json" || value === "jsonl") {
    return value;
  }
  throw new InvalidArgumentError("Expected text, json, or jsonl");
}

try {
  await program.parseAsync(process.argv);
} catch (error) {
  process.stderr.write(`Error: ${errorMessage(error)}\n`);
  process.exitCode = 1;
}
