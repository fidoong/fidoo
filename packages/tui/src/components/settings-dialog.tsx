import type {
  ProviderKind,
  ProviderModelsParams,
  ProviderSettings,
  SettingsUpdateParams,
} from "@fidoo/protocol";
import { PROVIDER_IDS, providerDefinition } from "@fidoo/protocol";
import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { theme } from "../theme.js";

const steps = ["Provider", "Base URL", "API key", "Model", "Confirm"] as const;

export function SettingsDialog({
  initial,
  onSave,
  onDiscover,
}: {
  initial: ProviderSettings;
  onSave(settings: SettingsUpdateParams): Promise<void>;
  onDiscover(
    params: ProviderModelsParams,
  ): Promise<{ models: string[]; unavailable?: boolean | undefined }>;
}) {
  const [step, setStep] = useState(0);
  const [providerIndex, setProviderIndex] = useState(() =>
    Math.max(0, PROVIDER_IDS.indexOf(initial.provider)),
  );
  const initialDefinition = providerDefinition(initial.provider);
  const [provider, setProvider] = useState<ProviderKind>(initial.provider);
  const [model, setModel] = useState(initial.model || initialDefinition.defaultModel);
  const [baseURL, setBaseURL] = useState(initial.baseURL || initialDefinition.defaultBaseURL);
  const [apiKey, setApiKey] = useState("");
  const [hasSavedKey, setHasSavedKey] = useState(initial.hasApiKey);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [modelIndex, setModelIndex] = useState(0);
  const [loadingModels, setLoadingModels] = useState(false);
  const [catalogNotice, setCatalogNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const definition = providerDefinition(provider);
  const availableModels = discoveredModels.length > 0 ? discoveredModels : definition.models;

  const discover = () => {
    if (loadingModels) return;
    setLoadingModels(true);
    setCatalogNotice(undefined);
    setError(undefined);
    void onDiscover({ provider, baseURL, ...(apiKey ? { apiKey } : {}) })
      .then((result) => {
        setDiscoveredModels(result.models);
        setModelIndex(0);
        if (result.unavailable) {
          setCatalogNotice(
            "This endpoint has no model-list API. Choose a fallback or enter a model manually.",
          );
        }
        if (!model && result.models[0]) setModel(result.models[0]);
      })
      .catch((cause) => {
        setDiscoveredModels([]);
        setError(
          `Model discovery failed: ${cause instanceof Error ? cause.message : String(cause)}. Enter a model manually.`,
        );
      })
      .finally(() => setLoadingModels(false));
  };

  useInput((input, key) => {
    if (saving) return;
    setError(undefined);
    if (step === 0) {
      if (key.upArrow) setProviderIndex((current) => Math.max(0, current - 1));
      if (key.downArrow)
        setProviderIndex((current) => Math.min(PROVIDER_IDS.length - 1, current + 1));
      if (key.return) {
        const nextProvider = PROVIDER_IDS[providerIndex] ?? "openai";
        const next = providerDefinition(nextProvider);
        const unchanged = nextProvider === initial.provider;
        setProvider(nextProvider);
        setModel(unchanged ? initial.model : next.defaultModel);
        setBaseURL(unchanged ? initial.baseURL : next.defaultBaseURL);
        setHasSavedKey(unchanged && initial.hasApiKey);
        setApiKey("");
        setDiscoveredModels([]);
        setCatalogNotice(undefined);
        setStep(1);
      }
      return;
    }
    if (key.leftArrow) {
      setStep((current) => Math.max(0, current - 1));
      return;
    }
    if (step === 4) {
      if (key.return) {
        setSaving(true);
        void onSave({
          provider,
          model,
          baseURL,
          ...(apiKey ? { apiKey } : {}),
          save: true,
        }).catch((cause) => {
          setError(cause instanceof Error ? cause.message : String(cause));
          setSaving(false);
        });
      }
      return;
    }
    if (step === 3 && key.ctrl && input === "f") {
      discover();
      return;
    }
    if (step === 3 && key.upArrow) {
      setModelIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (step === 3 && key.downArrow) {
      setModelIndex((current) => Math.min(Math.max(0, availableModels.length - 1), current + 1));
      return;
    }
    if (step === 3 && key.tab && availableModels[modelIndex]) {
      setModel(availableModels[modelIndex]);
      return;
    }
    if (key.return) {
      if (step === 1 && !baseURL.trim()) {
        setError("Enter the provider Base URL.");
        return;
      }
      if (step === 2 && definition.apiKeyRequired && !apiKey && !hasSavedKey) {
        setError(`Enter an API key for ${definition.name}.`);
        return;
      }
      if (step === 3 && !model.trim()) {
        setError("Enter a model name.");
        return;
      }
      const enteringModelStep = step === 2;
      setStep((current) => current + 1);
      if (enteringModelStep) discover();
      return;
    }
    if (input === "\u0015" || (key.ctrl && input === "u")) {
      setField(step, "", { model: setModel, baseURL: setBaseURL, apiKey: setApiKey });
      return;
    }
    if (key.backspace || key.delete) {
      const current = step === 1 ? baseURL : step === 2 ? apiKey : model;
      setField(step, Array.from(current).slice(0, -1).join(""), {
        model: setModel,
        baseURL: setBaseURL,
        apiKey: setApiKey,
      });
      return;
    }
    if (!key.ctrl && !key.meta && !key.escape && input) {
      const pasted = input.replace(/\r\n?|\n/g, " ");
      const current = step === 1 ? baseURL : step === 2 ? apiKey : model;
      setField(step, current + pasted, { model: setModel, baseURL: setBaseURL, apiKey: setApiKey });
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.accent}
      paddingX={1}
      marginY={1}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold>Model setup</Text>
        <Text dimColor>
          {steps[step]} · {step + 1}/5
        </Text>
      </Box>
      <Text dimColor>← back · Enter continue · Esc close</Text>
      <Box marginTop={1} flexDirection="column">
        {step === 0 ? <ProviderStep providerIndex={providerIndex} /> : null}
        {step === 1 ? (
          <>
            <Text dimColor>OpenAI-compatible or native provider endpoint</Text>
            <InputLine value={baseURL} />
          </>
        ) : null}
        {step === 2 ? (
          <>
            <Text dimColor>
              {hasSavedKey
                ? "A key is saved; leave empty to keep it"
                : definition.apiKeyRequired
                  ? "API key required"
                  : "API key optional for local endpoints"}
            </Text>
            <InputLine value={apiKey ? "•".repeat(Math.min(apiKey.length, 24)) : ""} />
            <Text dimColor>
              Saved locally with 0600 permissions · never returned by settings.get
            </Text>
          </>
        ) : null}
        {step === 3 ? (
          <>
            <Text dimColor>{definition.name} model · type freely or Tab choose</Text>
            <InputLine value={model} />
            <Text dimColor>
              {loadingModels
                ? "Fetching live model catalog…"
                : discoveredModels.length > 0
                  ? `Live catalog · ${discoveredModels.length} models · Ctrl+F refresh`
                  : "Offline fallback · Ctrl+F fetch latest"}
            </Text>
            {catalogNotice ? <Text color={theme.warning}>{catalogNotice}</Text> : null}
            <ModelList models={availableModels} selected={modelIndex} />
          </>
        ) : null}
        {step === 4 ? (
          <>
            <Text dimColor>Ready to apply without restarting</Text>
            <Text>
              <Text dimColor>Provider </Text>
              {definition.name}
            </Text>
            <Text wrap="wrap">
              <Text dimColor>Model </Text>
              {model}
            </Text>
            <Text wrap="wrap">
              <Text dimColor>Endpoint </Text>
              {baseURL}
            </Text>
            <Text>
              <Text dimColor>API key </Text>
              {apiKey
                ? "new key entered"
                : hasSavedKey
                  ? "keep saved key"
                  : definition.apiKeyRequired
                    ? "missing"
                    : "not required"}
            </Text>
            <Text dimColor>Enter save and activate</Text>
          </>
        ) : null}
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color={theme.error}>{error}</Text>
        </Box>
      ) : null}
      {saving ? (
        <Box marginTop={1}>
          <Text color={theme.accent}>Applying configuration…</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function ProviderStep({ providerIndex }: { providerIndex: number }) {
  return (
    <>
      <Text dimColor>Choose a provider</Text>
      {PROVIDER_IDS.map((id, index) => {
        const selected = index === providerIndex;
        return (
          <Text key={id} wrap="wrap">
            <Text color={selected ? theme.accent : theme.muted}>{selected ? "› " : "  "}</Text>
            <Text bold={selected} color={selected ? theme.accent : theme.text}>
              {providerDefinition(id).name}
            </Text>
            <Text dimColor> · {providerDefinition(id).protocol}</Text>
          </Text>
        );
      })}
    </>
  );
}

function ModelList({ models, selected }: { models: string[]; selected: number }) {
  const size = 6;
  const start = Math.max(0, Math.min(selected - 2, models.length - size));
  const visible = models.slice(start, start + size);
  return (
    <Box flexDirection="column">
      {visible.map((item, index) => {
        const active = start + index === selected;
        return (
          <Text key={item}>
            <Text color={active ? theme.accent : theme.muted}>{active ? "› " : "  "}</Text>
            <Text dimColor={!active}>{item}</Text>
          </Text>
        );
      })}
      {models.length > size ? (
        <Text dimColor>
          … {start + 1}–{start + visible.length} / {models.length} · ↑/↓ navigate
        </Text>
      ) : null}
    </Box>
  );
}

function InputLine({ value }: { value: string }) {
  return (
    <Box marginY={1}>
      <Text wrap="wrap">
        <Text color={theme.accent}>› </Text>
        <Text>{value}</Text>
        <Text color={theme.brand}>▌</Text>
      </Text>
    </Box>
  );
}

function setField(
  step: number,
  value: string,
  setters: {
    model: (value: string) => void;
    baseURL: (value: string) => void;
    apiKey: (value: string) => void;
  },
): void {
  if (step === 1) setters.baseURL(value);
  if (step === 2) setters.apiKey(value);
  if (step === 3) setters.model(value);
}
