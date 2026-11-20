import type { PublicRunEvent, RunSummary } from "@fidoo/protocol";
import { Box, Text, useApp, useInput } from "ink";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AgentController } from "./agent-controller.js";
import { paletteDefinitions } from "./commands.js";
import { ApprovalDialog } from "./components/approval-dialog.js";
import { Welcome } from "./components/brand.js";
import { CommandDialog } from "./components/command-dialog.js";
import { Composer } from "./components/composer.js";
import { HelpDialog } from "./components/help-dialog.js";
import { MessageList } from "./components/message-list.js";
import { PlanPanel } from "./components/plan-panel.js";
import { ReasoningPanel } from "./components/reasoning-panel.js";
import { SessionsDialog } from "./components/sessions-dialog.js";
import { StatusBar } from "./components/status-bar.js";
import { ThemeDialog } from "./components/theme-dialog.js";
import { TraceDialog } from "./components/trace-dialog.js";
import { isActivePhase } from "./store.js";
import {
  applyTheme,
  DEFAULT_THEME,
  THEME_PRESET_IDS,
  THEME_PRESETS,
  type ThemePreference,
  theme,
} from "./theme.js";

export interface TuiAppOptions {
  cwd: string;
  provider?: string;
  model?: string;
  theme?: ThemePreference;
  onThemeChange?(theme: ThemePreference): void | Promise<void>;
}

type DialogState =
  | { type: "sessions"; sessions: RunSummary[]; selected: number }
  | { type: "trace"; events: PublicRunEvent[] }
  | { type: "commands"; selected: number }
  | { type: "theme"; selected: number }
  | { type: "help" };

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
  const [expanded, setExpanded] = useState(false);
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  const [exitArmed, setExitArmed] = useState(false);
  const [commandNotice, setCommandNotice] = useState<string>();
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

  const toggleReasoning = () => {
    if (!state.reasoningText) {
      setCommandNotice("No reasoning has been received from this provider yet.");
      return;
    }
    setCommandNotice(undefined);
    setReasoningExpanded((current) => !current);
  };

  const submit = (value: string) => {
    setCommandNotice(undefined);
    if (value === "/quit") {
      close();
    } else if (value === "/new") {
      controller.newSession();
      setExpanded(false);
    } else if (value === "/sessions") {
      void showSessions();
    } else if (value === "/trace") {
      void showTrace();
    } else if (value === "/theme") {
      showTheme();
    } else if (value === "/reasoning") {
      toggleReasoning();
    } else if (value.startsWith("/resume ")) {
      void restoreSession(value.slice("/resume ".length).trim());
    } else if (value === "/resume") {
      setCommandNotice("Usage: /resume <run-id>");
    } else if (value === "/help") {
      setDialog({ type: "help" });
    } else if (value.startsWith("/")) {
      setCommandNotice(`Unknown command: ${value}`);
    } else {
      void controller.submit(value);
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
      if (key.escape) {
        setDialog(undefined);
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
      setExpanded((current) => !current);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      {!state.runId && !dialog ? <Welcome cwd={options.cwd} /> : null}
      <MessageList
        messages={state.messages}
        streamingText={state.streamingText}
        tools={state.tools}
        expanded={expanded}
        provider={options.provider}
        model={options.model}
      />
      {!dialog ? <ReasoningPanel state={state} expanded={reasoningExpanded} /> : null}
      {!dialog ? <PlanPanel state={state} /> : null}
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
      <Box marginTop={1}>
        {dialog ? null : state.pendingApproval ? (
          <ApprovalDialog approval={state.pendingApproval} />
        ) : (
          <Composer enabled={!isActivePhase(state.phase)} onSubmit={submit} />
        )}
      </Box>
      <StatusBar state={state} />
    </Box>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
