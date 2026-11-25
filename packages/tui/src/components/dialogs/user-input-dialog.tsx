import type { UserInputQuestion } from "@fidoo/protocol";
import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { theme } from "../../theme/index.js";

export function UserInputDialog({
  questions,
  onSubmit,
}: {
  questions: UserInputQuestion[];
  onSubmit(answers: Record<string, string[]>): Promise<void>;
}) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const question = questions[index] ?? questions[0];

  const submit = async (value: string[]) => {
    if (!question) return;
    const next = { ...answers, [question.id]: value };
    if (index < questions.length - 1) {
      setAnswers(next);
      setIndex(index + 1);
      setSelected(0);
      setChecked(new Set());
      setDraft("");
      setError(undefined);
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await onSubmit(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };

  useInput((input, key) => {
    if (saving || !question) return;
    setError(undefined);
    if (question.options) {
      if (key.upArrow) setSelected(Math.max(0, selected - 1));
      if (key.downArrow) setSelected(Math.min(question.options.length - 1, selected + 1));
      if (input === " " && question.multiSelect) {
        const option = question.options[selected];
        if (option) {
          const next = new Set(checked);
          if (next.has(option.id)) next.delete(option.id);
          else next.add(option.id);
          setChecked(next);
        }
      }
      if (key.return) {
        if (question.multiSelect) {
          const values = question.options
            .filter((option) => checked.has(option.id))
            .map((option) => option.id);
          if (!values.length) {
            setError("Select at least one option.");
            return;
          }
          void submit(values);
        } else {
          const option = question.options[selected];
          if (option) void submit([option.id]);
        }
      }
      return;
    }
    if (key.return) {
      if (!draft.trim()) {
        setError("Enter an answer.");
        return;
      }
      void submit([draft.trim()]);
      return;
    }
    if ((key.ctrl && input === "u") || input === "") {
      setDraft("");
    } else if (key.backspace || key.delete) {
      setDraft(Array.from(draft).slice(0, -1).join(""));
    } else if (!key.ctrl && !key.meta && !key.escape && input) {
      setDraft(draft + input.replace(/\r\n?|\n/g, " "));
    }
  });

  if (!question) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.accent}
      paddingX={1}
      marginY={1}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color={theme.accent}>
          Input required
        </Text>
        <Text dimColor>
          {index + 1}/{questions.length}
        </Text>
      </Box>
      <Text>{question.question}</Text>
      <Box flexDirection="column" marginTop={1}>
        {question.options?.map((option, optionIndex) => (
          <Box key={option.id} flexDirection="column" marginBottom={1}>
            <Text {...(selected === optionIndex ? { color: theme.accent } : {})}>
              {question.multiSelect
                ? checked.has(option.id)
                  ? "[x] "
                  : "[ ] "
                : selected === optionIndex
                  ? "› "
                  : "  "}
              {option.label}
            </Text>
            {option.description ? <Text dimColor> {option.description}</Text> : null}
          </Box>
        ))}
        {!question.options ? (
          <Text color={theme.code}>
            › {draft}
            <Text inverse> </Text>
          </Text>
        ) : null}
      </Box>
      <Text dimColor>
        {question.options
          ? question.multiSelect
            ? "↑↓ move · Space toggle · Enter continue"
            : "↑↓ move · Enter select"
          : "Enter submit · Ctrl+U clear"}
        {" · Ctrl+C cancel run"}
      </Text>
      {error ? <Text color={theme.error}>{error}</Text> : null}
      {saving ? <Text dimColor>Submitting answers…</Text> : null}
    </Box>
  );
}
