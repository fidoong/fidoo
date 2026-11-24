import { Box, Text } from "ink";
import { memo, type ReactNode } from "react";
import { theme } from "../../theme/index.js";

const keywords = new Set([
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "interface",
  "let",
  "new",
  "null",
  "return",
  "static",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "undefined",
  "while",
]);
const syntax =
  /(\/\/.*|#.*$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|(-{1,2}[A-Za-z][\w-]*|\b[A-Za-z_][\w-]*\b)/gm;

export const CodeBlock = memo(function CodeBlock({
  code,
  language,
}: {
  code: string;
  language: string | undefined;
}) {
  const lines = code.split("\n");
  const occurrences = new Map<string, number>();
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.muted}
      paddingX={1}
      marginY={1}
    >
      <Text dimColor>{language || "text"}</Text>
      {lines.map((line, index) => {
        const occurrence = (occurrences.get(line) ?? 0) + 1;
        occurrences.set(line, occurrence);
        return (
          <Text key={`${line}-${occurrence}`}>
            <Text dimColor>{String(index + 1).padStart(3, " ")} │ </Text>
            <HighlightedLine line={line} language={language} />
          </Text>
        );
      })}
    </Box>
  );
});

export function CommandHighlight({ command }: { command: string }) {
  return (
    <Text>
      <HighlightedLine line={command} language="bash" />
    </Text>
  );
}

export const HighlightedLine = memo(function HighlightedLine({
  line,
  language,
}: {
  line: string;
  language: string | undefined;
}) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of line.matchAll(syntax)) {
    const index = match.index;
    if (index > cursor) {
      parts.push(line.slice(cursor, index));
    }
    const [value, comment, string, number, word] = match;
    parts.push(
      <Text
        key={`${index}-${value}`}
        {...(comment
          ? { dimColor: true }
          : string
            ? { color: theme.text }
            : number
              ? { color: theme.text }
              : word && keywords.has(word)
                ? { color: theme.code, bold: true }
                : language === "bash" && index === 0
                  ? { color: theme.brand, bold: true }
                  : word?.startsWith("-")
                    ? { dimColor: true }
                    : {})}
      >
        {value}
      </Text>,
    );
    cursor = index + value.length;
  }
  if (cursor < line.length) {
    parts.push(line.slice(cursor));
  }
  return <>{parts}</>;
});
