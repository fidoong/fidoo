import { Box, Text } from "ink";
import { Lexer, type Token, type Tokens } from "marked";
import { memo, type ReactNode, useMemo } from "react";
import { theme } from "../../theme/index.js";
import { CodeBlock } from "./code.js";

export const Markdown = memo(function Markdown({ source }: { source: string }) {
  const tokens = useMemo(() => Lexer.lex(source, { gfm: true, breaks: true }), [source]);
  const keys = new Map<string, number>();
  return (
    <Box flexDirection="column">
      {tokens.map((token) => renderBlock(token, nextKey(keys, `${token.type}-${token.raw}`)))}
    </Box>
  );
});

function renderBlock(token: Token, key: string): ReactNode {
  switch (token.type) {
    case "space":
      return null;
    case "heading":
      return (
        <Box key={key} marginTop={1} flexDirection="column">
          <Text bold color={theme.brand}>
            {renderInline(token.tokens ?? [])}
          </Text>
          {token.depth === 1 ? <Text dimColor>{"─".repeat(24)}</Text> : null}
        </Box>
      );
    case "paragraph":
      return (
        <Box key={key}>
          <Text wrap="wrap">{renderInline(token.tokens ?? [])}</Text>
        </Box>
      );
    case "text":
      return (
        <Text key={key} wrap="wrap">
          {renderInline(token.tokens ?? Lexer.lexInline(token.text))}
        </Text>
      );
    case "code":
      return <CodeBlock key={key} code={token.text} language={token.lang} />;
    case "list": {
      const list = token as Tokens.List;
      const itemKeys = new Map<string, number>();
      return (
        <Box key={key} flexDirection="column">
          {list.items.map((item, index) =>
            renderListItem(item, list, index, nextKey(itemKeys, item.raw)),
          )}
        </Box>
      );
    }
    case "blockquote": {
      const quoteKeys = new Map<string, number>();
      return (
        <Box key={key} flexDirection="column">
          {(token.tokens ?? []).map((child) => {
            const childKey = nextKey(quoteKeys, child.raw);
            return (
              <Box key={childKey}>
                <Text color={theme.brandSecondary}>┃ </Text>
                <Box flexGrow={1}>{renderBlock(child, childKey)}</Box>
              </Box>
            );
          })}
        </Box>
      );
    }
    case "hr":
      return (
        <Text key={key} dimColor>
          {"─".repeat(48)}
        </Text>
      );
    case "table": {
      const table = token as Tokens.Table;
      const rowKeys = new Map<string, number>();
      return (
        <Box key={key} flexDirection="column">
          <Text bold>{renderCells(table.header)}</Text>
          <Text dimColor>{"─".repeat(32)}</Text>
          {table.rows.map((row) => (
            <Text key={nextKey(rowKeys, JSON.stringify(row))}>{renderCells(row)}</Text>
          ))}
        </Box>
      );
    }
    case "html":
      return (
        <Text key={key} dimColor>
          {token.text}
        </Text>
      );
    default:
      return <Text key={key}>{token.raw}</Text>;
  }
}

function renderListItem(
  item: Tokens.ListItem,
  list: Tokens.List,
  index: number,
  key: string,
): ReactNode {
  const marker = item.task ? (item.checked ? "[x]" : "[ ]") : list.ordered ? `${index + 1}.` : "•";
  const childKeys = new Map<string, number>();
  return (
    <Box key={key}>
      <Text color={theme.brand}>{marker} </Text>
      <Box flexGrow={1} flexDirection="column">
        {item.tokens.map((token) => {
          const childKey = nextKey(childKeys, token.raw);
          return token.type === "paragraph" || token.type === "text" ? (
            <Text key={childKey} wrap="wrap">
              {renderInline(token.tokens ?? Lexer.lexInline(token.text))}
            </Text>
          ) : (
            renderBlock(token, childKey)
          );
        })}
      </Box>
    </Box>
  );
}

function renderCells(cells: Tokens.TableCell[]): ReactNode {
  const keys = new Map<string, number>();
  return cells.map((cell, index) => (
    <Text key={nextKey(keys, cell.text)}>
      {index > 0 ? <Text dimColor> │ </Text> : null}
      {renderInline(cell.tokens)}
    </Text>
  ));
}

function renderInline(tokens: Token[]): ReactNode[] {
  const keys = new Map<string, number>();
  return tokens.map((token) => {
    const key = nextKey(keys, `${token.type}-${token.raw}`);
    switch (token.type) {
      case "strong":
        return (
          <Text key={key} bold>
            {renderInline(token.tokens ?? [])}
          </Text>
        );
      case "em":
        return (
          <Text key={key} italic>
            {renderInline(token.tokens ?? [])}
          </Text>
        );
      case "codespan":
        return (
          <Text key={key} color={theme.code}>
            {token.text}
          </Text>
        );
      case "link":
        return (
          <Text key={key}>
            <Text color={theme.accent} underline>
              {renderInline(token.tokens ?? [])}
            </Text>
            {token.text !== token.href ? <Text dimColor> ({token.href})</Text> : null}
          </Text>
        );
      case "image":
        return (
          <Text key={key} dimColor>
            [image: {token.text} · {token.href}]
          </Text>
        );
      case "del":
        return (
          <Text key={key} dimColor strikethrough>
            {renderInline(token.tokens ?? [])}
          </Text>
        );
      case "br":
        return "\n";
      case "escape":
        return token.text;
      case "text":
        return token.tokens ? renderInline(token.tokens) : token.text;
      case "html":
        return <Text key={key}>{token.text}</Text>;
      default:
        return <Text key={key}>{token.raw}</Text>;
    }
  });
}

function nextKey(keys: Map<string, number>, value: string): string {
  const base = value.slice(0, 64);
  const occurrence = (keys.get(base) ?? 0) + 1;
  keys.set(base, occurrence);
  return `${base}-${occurrence}`;
}
