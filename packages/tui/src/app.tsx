import type {
  ArtifactPage,
  ProviderSettings,
  PublicRunEvent,
  RunSummary,
  SettingsUpdateParams,
} from "@fidoo/protocol";
import { Box, Text, useApp, useInput } from "ink";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { commandDefinitions, paletteDefinitions } from "./commands/definitions.js";
import { MessageList } from "./components/conversation/message-list.js";
import { PlanPanel } from "./components/conversation/plan-panel.js";
import { ApprovalDialog } from "./components/dialogs/approval-dialog.js";
import { CommandDialog } from "./components/dialogs/command-dialog.js";
import { HelpDialog } from "./components/dialogs/help-dialog.js";
import { OutputDialog } from "./components/dialogs/output-dialog.js";
import { ReasoningDialog } from "./components/dialogs/reasoning-dialog.js";
import { SessionsDialog } from "./components/dialogs/sessions-dialog.js";
import { SettingsDialog } from "./components/dialogs/settings-dialog.js";
import { StatusDialog } from "./components/dialogs/status-dialog.js";
import { ThemeDialog } from "./components/dialogs/theme-dialog.js";
import { TraceDialog } from "./components/dialogs/trace-dialog.js";
import { Composer } from "./components/input/composer.js";
import { Welcome } from "./components/layout/brand.js";
import { StatusBar } from "./components/layout/status-bar.js";
import type { AgentController } from "./runtime/agent-controller.js";
import { isActivePhase } from "./runtime/store.js";
import {
  applyTheme,
  DEFAULT_THEME,
  THEME_PRESET_IDS,
  THEME_PRESETS,
  type ThemePreference,
  theme,
} from "./theme/index.js";

export interface TuiAppOptions {
  cwd: string;
  provider?: string;
  model?: string;
  theme?: ThemePreference;
  onThemeChange?(theme: ThemePreference): void | Promise<void>;
}

interface OutputDialogState {
  type: "output";
  title: string;
  artifactId: string | undefined;
  page: ArtifactPage | undefined;
  content: string;
  offset: number;
  limit: number;
  loading: boolean;
  error: string | undefined;
}

type DialogState =
  | { type: "sessions"; sessions: RunSummary[]; selected: number }
  | { type: "trace"; events: PublicRunEvent[] }
  | { type: "commands"; selected: number }
  | { type: "theme"; selected: number }
  | { type: "help" }
  | { type: "status" }
  | { type: "reasoning" }
  | { type: "settings"; settings: ProviderSettings }
  | OutputDialogState;

export function TuiApp({
  controller,
  options,
  onExit,
}: {
  controller: AgentController;
  options: TuiAppOptions;
  onExit?(): void;
}) {
  const { exit } = useApp();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [planExpanded, setPlanExpanded] = useState(false);
  const [exitArmed, setExitArmed] = useState(false);
  const [commandNotice, setCommandNotice] = useState<string>();
  const [connectionSettings, setConnectionSettings] = useState<ProviderSettings>();
  const [dialog, setDialog] = useState<DialogState>();
  const [activeTheme, setActiveTheme] = useState<ThemePreference>(() => {
    const preference = options.theme ?? DEFAULT_THEME;
    applyTheme(preference);
    return preference;
  });
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const close = onExit ?? exit;

  useEffect(
    () => () => {
      if (exitTimer.current) {
        clearTimeout(exitTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    let mounted = true;
    void controller
      .getSettings()
      .then((settings) => {
        if (!mounted) return;
        setConnectionSettings(settings);
        if (!settings.configured) {
          setDialog((current) => current ?? { type: "settings", settings });
        }
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [controller]);

  const showSettings = async () => {
    try {
      const settings = connectionSettings ?? (await controller.getSettings());
      setConnectionSettings(settings);
      setDialog({ type: "settings", settings });
    } catch (error) {
      setCommandNotice(errorText(error));
    }
  };

  const saveSettings = async (input: SettingsUpdateParams) => {
    const settings = await controller.updateSettings(input);
    setConnectionSettings(settings);
    setDialog(undefined);
    setCommandNotice(`Model ready: ${settings.provider} / ${settings.model}`);
  };

  const showSessions = async () => {
    try {
      const sessions = await controller.listSessions();
      setDialog({ type: "sessions", sessions, selected: 0 });
    } catch (error) {
      setCommandNotice(errorText(error));
    }
  };

  const showTrace = async () => {
    try {
      const events = await controller.trace();
      setDialog({ type: "trace", events });
    } catch (error) {
      setCommandNotice(errorText(error));
    }
  };

  const showTheme = () => {
    setDialog({ type: "theme", selected: THEME_PRESET_IDS.indexOf(activeTheme.preset) });
  };

  const selectTheme = async (index: number) => {
    const preset = THEME_PRESET_IDS[index];
    if (!preset) {
      return;
    }
    const preference = preset === activeTheme.preset ? activeTheme : { preset };
    applyTheme(preference);
    setActiveTheme(preference);
    setDialog(undefined);
    try {
      await options.onThemeChange?.(preference);
      setCommandNotice(`Theme saved: ${THEME_PRESETS[preset].name}`);
    } catch (error) {
      setCommandNotice(`Theme applied, but saving failed: ${errorText(error)}`);
    }
  };

  const restoreSession = async (runId: string) => {
    setDialog(undefined);
    await controller.loadSession(runId);
  };

  const showArtifact = async (artifactId: string, offset = 0, title?: string) => {
    const heading = title ?? `Artifact ${artifactId.slice(0, 12)}`;
    setDialog((current) => ({
      type: "output",
      title: heading,
      artifactId,
      page:
        current?.type === "output" && current.artifactId === artifactId ? current.page : undefined,
      content: "",
      offset,
      limit: 200,
      loading: true,
      error: undefined,
    }));
    try {
      const page = await controller.readArtifact(artifactId, offset, 200);
      setDialog((current) =>
        current?.type === "output" && current.artifactId === artifactId && current.offset === offset
          ? {
              ...current,
              title: heading,
              page,
              offset: page.offset,
              limit: page.limit,
              loading: false,
              error: undefined,
            }
          : current,
      );
    } catch (error) {
      setDialog((current) =>
        current?.type === "output" && current.artifactId === artifactId && current.offset === offset
          ? { ...current, loading: false, error: errorText(error) }
          : current,
      );
    }
  };

  const showOutput = () => {
    const tool = state.tools
      .filter((item) => item.status === "success" || item.status === "error")
      .toSorted((left, right) => left.seq - right.seq)
      .at(-1);
    const artifact = tool?.artifacts?.at(-1);
    if (tool && artifact) {
      void showArtifact(artifact.id, 0, `${tool.name} · ${artifact.name}`);
    } else if (tool?.output) {
      setDialog({
        type: "output",
        title: `${tool.name} output`,
        artifactId: undefined,
        page: undefined,
        content: tool.output,
        offset: 0,
        limit: 200,
        loading: false,
        error: undefined,
      });
    } else {
      setCommandNotice("No completed tool output is available.");
    }
  };

  const pageOutput = (direction: -1 | 1) => {
    if (dialog?.type !== "output" || dialog.loading) {
      return;
    }
    const totalLines = dialog.page?.totalLines ?? splitLines(dialog.content).length;
    const currentOffset = dialog.page?.offset ?? dialog.offset;
    const nextOffset =
      direction > 0
        ? (dialog.page?.nextOffset ??
          (currentOffset + dialog.limit < totalLines
            ? currentOffset + dialog.limit
            : currentOffset))
        : Math.max(0, currentOffset - dialog.limit);
    if (nextOffset === currentOffset) {
      return;
    }
    if (dialog.artifactId) {
      void showArtifact(dialog.artifactId, nextOffset, dialog.title);
    } else {
      setDialog({ ...dialog, offset: nextOffset });
    }
  };

  const toggleReasoning = () => {
    if (!state.reasoningText) {
      setCommandNotice("No reasoning has been received from this provider yet.");
      return;
    }
    setCommandNotice(undefined);
    setDialog((current) => (current?.type === "reasoning" ? undefined : { type: "reasoning" }));
  };

  const togglePlan = () => {
    if (!state.taskPlan) {
      setCommandNotice("No explicit task plan has been recorded for this run.");
      return;
    }
    setCommandNotice(undefined);
    setPlanExpanded((current) => !current);
  };

  const submit = (value: string) => {
    setCommandNotice(undefined);
    const active = isActivePhase(state.phase);
    const command = commandDefinitions.find(
      (item) => value === item.name || value.startsWith(`${item.name} `),
    );
    if (active && value.startsWith("/") && !command?.duringRun) {
      setCommandNotice("Finish or cancel the active run before using this command.");
      return;
    }
    if (value === "/quit") {
      close();
    } else if (value === "/new") {
      controller.newSession();
    } else if (value === "/sessions") {
      void showSessions();
    } else if (value === "/trace") {
      void showTrace();
    } else if (value === "/theme") {
      showTheme();
    } else if (value === "/setup" || value === "/settings") {
      void showSettings();
    } else if (value === "/reasoning") {
      toggleReasoning();
    } else if (value === "/plan") {
      togglePlan();
    } else if (value === "/output") {
      showOutput();
    } else if (value === "/status") {
      setDialog({ type: "status" });
    } else if (value === "/cancel") {
      if (active) {
        void controller.cancel();
      } else {
        setCommandNotice("No active run to cancel.");
      }
    } else if (value.startsWith("/artifact ")) {
      void showArtifact(value.slice("/artifact ".length).trim());
    } else if (value === "/artifact") {
      setCommandNotice("Usage: /artifact <id>");
    } else if (value.startsWith("/resume ")) {
      void restoreSession(value.slice("/resume ".length).trim());
    } else if (value === "/resume") {
      setCommandNotice("Usage: /resume <run-id>");
    } else if (value === "/help") {
      setDialog({ type: "help" });
    } else if (value.startsWith("/")) {
      setCommandNotice(`Unknown command: ${value}`);
    } else {
      if (active) {
        void controller.steer(value).catch((error) => setCommandNotice(errorText(error)));
      } else {
        void controller.submit(value);
      }
    }
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (isActivePhase(state.phase)) {
        void controller.cancel();
      } else if (exitArmed) {
        close();
      } else {
        setExitArmed(true);
        exitTimer.current = setTimeout(() => setExitArmed(false), 2000);
      }
      return;
    }
    if (dialog) {
      if (dialog.type === "reasoning" && key.ctrl && input === "r") {
        setDialog(undefined);
      } else if (dialog.type === "output" && key.ctrl && input === "o") {
        setDialog(undefined);
      } else if (key.escape) {
        setDialog(undefined);
      } else if (dialog.type === "output" && (key.downArrow || input === "j")) {
        pageOutput(1);
      } else if (dialog.type === "output" && (key.upArrow || input === "k")) {
        pageOutput(-1);
      } else if (key.upArrow && "selected" in dialog) {
        setDialog({ ...dialog, selected: Math.max(0, dialog.selected - 1) });
      } else if (key.downArrow && "selected" in dialog) {
        const length =
          dialog.type === "sessions"
            ? dialog.sessions.length
            : dialog.type === "commands"
              ? paletteDefinitions.length
              : THEME_PRESET_IDS.length;
        setDialog({ ...dialog, selected: Math.min(Math.max(0, length - 1), dialog.selected + 1) });
      } else if (dialog.type === "sessions" && key.return) {
        const session = dialog.sessions[dialog.selected];
        if (session) {
          void restoreSession(session.runId);
        }
      } else if (dialog.type === "commands" && key.return) {
        const command = paletteDefinitions[dialog.selected];
        if (command) {
          setDialog(undefined);
          submit(command.name);
        }
      } else if (dialog.type === "theme" && key.return) {
        void selectTheme(dialog.selected);
      }
      return;
    }
    if (key.ctrl && input === "r") {
      toggleReasoning();
      return;
    }
    if (key.ctrl && input === "p") {
      togglePlan();
      return;
    }
    if (state.pendingApproval) {
      if (input === "y") {
        void controller.respond("approved");
      } else if (input === "n" || key.escape) {
        void controller.respond("rejected");
      }
      return;
    }
    if (key.ctrl && input === "k") {
      if (!isActivePhase(state.phase)) {
        setCommandNotice(undefined);
        setDialog({ type: "commands", selected: 0 });
      }
      return;
    }
    if (key.ctrl && input === "o") {
      showOutput();
    }
  });

  return (
    <Box flexDirection="column">
      {!state.runId && !dialog ? (
        <Box paddingX={2}>
          <Welcome cwd={options.cwd} />
        </Box>
      ) : null}
      <MessageList
        messages={state.messages}
        streamingText={state.streamingText}
        tools={state.tools}
        reasoningState={state}
        provider={connectionSettings?.provider ?? options.provider}
        model={connectionSettings?.model ?? options.model}
      />
      {!dialog ? (
        <Box paddingX={2}>
          <PlanPanel state={state} expanded={planExpanded} />
        </Box>
      ) : null}
      <Box flexDirection="column" paddingX={2}>
        {dialog?.type === "sessions" ? (
          <SessionsDialog sessions={dialog.sessions} selected={dialog.selected} />
        ) : dialog?.type === "trace" ? (
          <TraceDialog events={dialog.events} />
        ) : dialog?.type === "commands" ? (
          <CommandDialog selected={dialog.selected} />
        ) : dialog?.type === "theme" ? (
          <ThemeDialog selected={dialog.selected} current={activeTheme.preset} />
        ) : dialog?.type === "help" ? (
          <HelpDialog />
        ) : dialog?.type === "status" ? (
          <StatusDialog
            state={state}
            provider={connectionSettings?.provider ?? options.provider}
            model={connectionSettings?.model ?? options.model}
            cwd={options.cwd}
            contextLimit={connectionSettings?.contextLimit ?? 100_000}
          />
        ) : dialog?.type === "reasoning" ? (
          <ReasoningDialog state={state} />
        ) : dialog?.type === "settings" ? (
          <SettingsDialog
            initial={dialog.settings}
            onSave={saveSettings}
            onDiscover={(params) => controller.listModels(params)}
          />
        ) : dialog?.type === "output" ? (
          <OutputDialog {...outputView(dialog)} />
        ) : null}
        {state.notice ? (
          <Text {...(state.phase === "completed" ? { color: theme.success } : { dimColor: true })}>
            {state.phase === "completed" ? "✓ " : ""}
            {state.notice}
          </Text>
        ) : null}
        {state.error ? <Text color={theme.error}>{state.error}</Text> : null}
        {commandNotice ? <Text color={theme.warning}>{commandNotice}</Text> : null}
        {exitArmed ? <Text color={theme.warning}>Press Ctrl+C again to exit.</Text> : null}
      </Box>
      <Box>
        {dialog ? null : state.pendingApproval ? (
          <ApprovalDialog approval={state.pendingApproval} />
        ) : (
          <Composer enabled busy={isActivePhase(state.phase)} onSubmit={submit} />
        )}
      </Box>
      <StatusBar
        state={state}
        provider={connectionSettings?.provider ?? options.provider}
        model={connectionSettings?.model ?? options.model}
        contextLimit={connectionSettings?.contextLimit ?? 100_000}
      />
    </Box>
  );
}

function outputView(dialog: OutputDialogState) {
  if (dialog.page) {
    return {
      title: dialog.title,
      content: dialog.page.content,
      offset: dialog.page.offset,
      limit: dialog.page.limit,
      totalLines: dialog.page.totalLines,
      nextOffset: dialog.page.nextOffset,
      loading: dialog.loading,
      error: dialog.error,
    };
  }
  const lines = splitLines(dialog.content);
  const selected = lines.slice(dialog.offset, dialog.offset + dialog.limit);
  return {
    title: dialog.title,
    content: selected.join("\n"),
    offset: dialog.offset,
    limit: dialog.limit,
    totalLines: lines.length,
    nextOffset:
      dialog.offset + selected.length < lines.length ? dialog.offset + selected.length : undefined,
    loading: dialog.loading,
    error: dialog.error,
  };
}

function splitLines(content: string): string[] {
  if (!content) {
    return [];
  }
  const lines = content.split(/\r\n|\r|\n/);
  if (/(?:\r\n|\r|\n)$/.test(content)) {
    lines.pop();
  }
  return lines;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
