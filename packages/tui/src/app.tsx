import type {
  ArtifactPage,
  BackgroundTask,
  ProviderSettings,
  PublicRunEvent,
  RunSummary,
  SettingsUpdateParams,
  TaskOutputPage,
} from "@fidoo/protocol";
import { Box, Text, useApp, useInput } from "ink";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { commandDefinitions, paletteDefinitions } from "./commands/definitions.js";
import { MessageList } from "./components/conversation/message-list.js";
import { PlanPanel } from "./components/conversation/plan-panel.js";
import { ApprovalDialog } from "./components/dialogs/approval-dialog.js";
import { CommandDialog } from "./components/dialogs/command-dialog.js";
import { HelpDialog } from "./components/dialogs/help-dialog.js";
import { ModeDialog, modeIds } from "./components/dialogs/mode-dialog.js";
import { OutputDialog } from "./components/dialogs/output-dialog.js";
import { PlanApprovalDialog } from "./components/dialogs/plan-approval-dialog.js";
import { ReasoningDialog } from "./components/dialogs/reasoning-dialog.js";
import { SessionsDialog } from "./components/dialogs/sessions-dialog.js";
import { SettingsDialog } from "./components/dialogs/settings-dialog.js";
import { StatusDialog } from "./components/dialogs/status-dialog.js";
import { ThemeDialog } from "./components/dialogs/theme-dialog.js";
import { TraceDialog } from "./components/dialogs/trace-dialog.js";
import { UserInputDialog } from "./components/dialogs/user-input-dialog.js";
import { Composer } from "./components/input/composer.js";
import { Welcome } from "./components/layout/brand.js";
import { StatusBar } from "./components/layout/status-bar.js";
import { moveSelection, navigationIntent } from "./navigation/navigation.js";
import type { AgentController } from "./runtime/agent-controller.js";
import { ComposerStore } from "./runtime/composer-store.js";
import { isActivePhase } from "./runtime/store.js";
import type { PendingUserInput, SubagentCard } from "./runtime/types.js";
import {
  ActivityScreen,
  type ActivityTab,
  activitySelection,
} from "./screens/activity/activity-screen.js";
import { AgentTraceScreen } from "./screens/activity/agent-trace-screen.js";
import { StopTaskDialog } from "./screens/activity/stop-task-dialog.js";
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
  taskId?: string;
  follow?: boolean;
  page: ArtifactPage | TaskOutputPage | undefined;
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
  | { type: "mode"; selected: number }
  | { type: "activity"; tab: ActivityTab; selected: number }
  | {
      type: "agent";
      agent: SubagentCard;
      events: PublicRunEvent[];
      loading: boolean;
      error?: string;
    }
  | { type: "task_stop"; task: BackgroundTask; selected: number }
  | { type: "plan_approval"; selected: number }
  | { type: "theme"; selected: number }
  | { type: "help" }
  | { type: "status" }
  | { type: "reasoning" }
  | { type: "settings"; settings: ProviderSettings }
  | { type: "user_input"; input: PendingUserInput }
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
  const pendingApproval = state.pendingApprovals[0];
  const activity = useSyncExternalStore(
    controller.activity.subscribe,
    controller.activity.getSnapshot,
  );
  const [planExpanded, setPlanExpanded] = useState(false);
  const [exitArmed, setExitArmed] = useState(false);
  const [commandNotice, setCommandNotice] = useState<string>();
  const [connectionSettings, setConnectionSettings] = useState<ProviderSettings>();
  const [composerStore] = useState(() => new ComposerStore());
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
    controller.activity.setRun(state.runId);
  }, [controller, state.runId]);

  useEffect(() => () => controller.activity.dispose(), [controller]);

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

  useEffect(() => {
    if (state.pendingInput) {
      const input = state.pendingInput;
      setDialog((current) =>
        current?.type === "user_input" ? current : { type: "user_input", input },
      );
    }
  }, [state.pendingInput]);

  useEffect(() => {
    if (state.pendingPlan) {
      setDialog((current) =>
        current?.type === "plan_approval" ? current : { type: "plan_approval", selected: 0 },
      );
    }
  }, [state.pendingPlan]);

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

  const showActivity = (tab: ActivityTab = "agents") => {
    setCommandNotice(undefined);
    setDialog({ type: "activity", tab, selected: 0 });
    void controller.activity.refresh();
  };

  const showAgent = async (agent: SubagentCard) => {
    setDialog({ type: "agent", agent, events: [], loading: true });
    try {
      const events = await controller.activity.trace(agent.runId);
      setDialog((current) =>
        current?.type === "agent" && current.agent.runId === agent.runId
          ? { ...current, agent, events, loading: false }
          : current,
      );
    } catch (error) {
      setDialog((current) =>
        current?.type === "agent" && current.agent.runId === agent.runId
          ? { ...current, loading: false, error: errorText(error) }
          : current,
      );
    }
  };

  const showTaskOutput = useCallback(
    async (task: BackgroundTask, offset?: number, follow = true) => {
      const title = `Task ${task.taskId.slice(0, 8)} · ${task.command}`;
      setDialog((current) => ({
        type: "output",
        title,
        artifactId: undefined,
        taskId: task.taskId,
        follow,
        page:
          current?.type === "output" && current.taskId === task.taskId ? current.page : undefined,
        content: "",
        offset: offset ?? 0,
        limit: 200,
        loading: true,
        error: undefined,
      }));
      try {
        let requested = offset;
        if (requested === undefined) {
          const probe = await controller.activity.readOutput(task.taskId, 0, 1);
          requested = Math.max(0, probe.totalLines - 200);
        }
        const page = await controller.activity.readOutput(task.taskId, requested, 200);
        setDialog((current) =>
          current?.type === "output" && current.taskId === task.taskId
            ? {
                ...current,
                title,
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
          current?.type === "output" && current.taskId === task.taskId
            ? { ...current, loading: false, error: errorText(error) }
            : current,
        );
      }
    },
    [controller],
  );

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
    if (dialog.taskId) {
      const task = activity.tasks.find((item) => item.taskId === dialog.taskId);
      if (task) void showTaskOutput(task, nextOffset, false);
    } else if (dialog.artifactId) {
      void showArtifact(dialog.artifactId, nextOffset, dialog.title);
    } else {
      setDialog({ ...dialog, offset: nextOffset });
    }
  };

  const outputTask =
    dialog?.type === "output" && dialog.taskId
      ? activity.tasks.find((task) => task.taskId === dialog.taskId)
      : undefined;
  const outputOffset = dialog?.type === "output" ? dialog.offset : undefined;
  const outputNextOffset = dialog?.type === "output" ? dialog.page?.nextOffset : undefined;
  const outputFollow = dialog?.type === "output" && dialog.follow === true;
  const outputLoading = dialog?.type === "output" && dialog.loading;
  useEffect(() => {
    if (outputTask?.status !== "running" || !outputFollow || outputLoading) return;
    const timer = setTimeout(() => {
      void showTaskOutput(outputTask, outputNextOffset ?? outputOffset ?? 0, true);
    }, 1000);
    return () => clearTimeout(timer);
  }, [outputTask, outputFollow, outputLoading, outputNextOffset, outputOffset, showTaskOutput]);

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
    } else if (value === "/activity") {
      showActivity();
    } else if (value === "/agents") {
      showActivity("agents");
    } else if (value === "/tasks") {
      showActivity("processes");
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
    } else if (value === "/mode") {
      setDialog({ type: "mode", selected: 0 });
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
    if (key.ctrl && input === "t") {
      if (dialog?.type === "activity") setDialog(undefined);
      else showActivity();
      return;
    }
    if (dialog) {
      const intent = navigationIntent(input, key);
      const direction = dialogSelectionDirection(dialog, intent);
      if (dialog.type === "activity") {
        const length = dialog.tab === "agents" ? state.subagents.length : activity.tasks.length;
        if (intent === "left" || intent === "right") {
          setDialog({
            type: "activity",
            tab: dialog.tab === "agents" ? "processes" : "agents",
            selected: 0,
          });
        } else if (intent === "previous" || intent === "next") {
          setDialog({
            ...dialog,
            selected: activitySelection(dialog.selected, length, intent === "previous" ? -1 : 1),
          });
        } else if (intent === "activate") {
          if (dialog.tab === "agents") {
            const agent = state.subagents[dialog.selected];
            if (agent) void showAgent(agent);
          } else {
            const task = activity.tasks[dialog.selected];
            if (task) void showTaskOutput(task);
          }
        } else if (input === "a") {
          controller.activity.setScope(activity.scope === "current" ? "all" : "current");
          setDialog({ ...dialog, selected: 0 });
        } else if (input === "s" && dialog.tab === "processes") {
          const task = activity.tasks[dialog.selected];
          if (task?.status === "running") setDialog({ type: "task_stop", task, selected: 0 });
        } else if (intent === "back") {
          setDialog(undefined);
        }
        return;
      }
      if (dialog.type === "task_stop") {
        if (intent === "left" || intent === "right" || intent === "previous" || intent === "next") {
          setDialog({ ...dialog, selected: dialog.selected === 0 ? 1 : 0 });
        } else if (intent === "activate") {
          if (dialog.selected === 0) {
            showActivity("processes");
          } else {
            const task = dialog.task;
            showActivity("processes");
            void controller.activity
              .stop(task)
              .catch((error) => setCommandNotice(errorText(error)));
          }
        } else if (intent === "back") {
          showActivity("processes");
        }
        return;
      }
      if (dialog.type === "agent") {
        if (intent === "back") showActivity("agents");
        else if (input === "r") void showAgent(dialog.agent);
        return;
      }
      if (dialog.type === "reasoning" && key.ctrl && input === "r") {
        setDialog(undefined);
      } else if (dialog.type === "output" && key.ctrl && input === "o") {
        setDialog(undefined);
      } else if (dialog.type === "plan_approval" && key.escape) {
        void controller.respondPlan("rejected", "manual", "Revise the plan with more detail");
      } else if (key.escape && dialog.type === "output" && dialog.taskId) {
        showActivity("processes");
      } else if (key.escape && dialog.type !== "user_input") {
        setDialog(undefined);
      } else if (dialog.type === "output" && dialog.taskId && input === "r") {
        const task = activity.tasks.find((item) => item.taskId === dialog.taskId);
        if (task) void showTaskOutput(task, dialog.offset, true);
      } else if (dialog.type === "output" && (key.downArrow || input === "j")) {
        pageOutput(1);
      } else if (dialog.type === "output" && (key.upArrow || input === "k")) {
        pageOutput(-1);
      } else if (direction && "selected" in dialog) {
        const length =
          dialog.type === "sessions"
            ? dialog.sessions.length
            : dialog.type === "commands"
              ? paletteDefinitions.length
              : dialog.type === "mode" || dialog.type === "plan_approval"
                ? 4
                : THEME_PRESET_IDS.length;
        setDialog({ ...dialog, selected: moveSelection(dialog.selected, length, direction) });
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
      } else if (dialog.type === "mode" && key.return) {
        const mode = modeIds[dialog.selected];
        if (mode) {
          setDialog(undefined);
          void controller.setMode(mode).catch((error) => setCommandNotice(errorText(error)));
        }
      } else if (dialog.type === "plan_approval" && key.return) {
        const selected = dialog.selected;
        setDialog(undefined);
        if (selected === 3) {
          void controller.respondPlan("rejected", "manual", "Revise the plan with more detail");
        } else {
          const mode = selected === 0 ? "acceptEdits" : selected === 1 ? "auto" : "manual";
          void controller.respondPlan("approved", mode);
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
    if (pendingApproval) {
      if (input === "y") {
        void controller.respond("approved");
      } else if (input === "n" || key.escape) {
        void controller.respond("rejected");
      }
      return;
    }
    if (key.tab && key.shift) {
      void controller.cycleMode().catch((error) => setCommandNotice(errorText(error)));
      return;
    }
    if (key.ctrl && input === "k") {
      setCommandNotice(undefined);
      setDialog({ type: "commands", selected: 0 });
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
        ) : dialog?.type === "mode" ? (
          <ModeDialog current={state.permissionMode} selected={dialog.selected} />
        ) : dialog?.type === "activity" ? (
          <ActivityScreen
            agents={state.subagents}
            tasks={activity.tasks}
            tab={dialog.tab}
            selected={dialog.selected}
            scope={activity.scope}
            loading={activity.loading}
            error={activity.error}
          />
        ) : dialog?.type === "agent" ? (
          <AgentTraceScreen
            agent={dialog.agent}
            events={dialog.events}
            loading={dialog.loading}
            error={dialog.error}
          />
        ) : dialog?.type === "task_stop" ? (
          <StopTaskDialog task={dialog.task} selected={dialog.selected} />
        ) : dialog?.type === "plan_approval" ? (
          <PlanApprovalDialog plan={state.taskPlan} selected={dialog.selected} />
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
          <OutputDialog
            {...outputView(dialog)}
            live={Boolean(dialog.taskId)}
            follow={dialog.follow ?? false}
          />
        ) : dialog?.type === "user_input" ? (
          <UserInputDialog
            questions={dialog.input.questions}
            onSubmit={async (answers) => {
              await controller.respondInput(dialog.input.callId, answers);
              setDialog(undefined);
            }}
          />
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
        {dialog ? null : pendingApproval ? (
          <ApprovalDialog approval={pendingApproval} pendingCount={state.pendingApprovals.length} />
        ) : (
          <Composer
            enabled
            busy={isActivePhase(state.phase)}
            store={composerStore}
            onSubmit={submit}
          />
        )}
      </Box>
      <StatusBar
        state={state}
        backgroundTasks={activity.tasks}
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

function dialogSelectionDirection(
  dialog: DialogState,
  intent: ReturnType<typeof navigationIntent>,
): -1 | 1 | undefined {
  if (!("selected" in dialog)) return undefined;
  if (intent === "previous") return -1;
  if (intent === "next") return 1;
  if (dialog.type === "mode" || dialog.type === "plan_approval" || dialog.type === "theme") {
    if (intent === "left") return -1;
    if (intent === "right") return 1;
  }
  return undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
