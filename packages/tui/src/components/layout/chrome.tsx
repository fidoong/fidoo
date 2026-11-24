import { Text, useStdout } from "ink";
import { theme } from "../../theme/index.js";

export function useTerminalColumns(): number {
  const { stdout } = useStdout();
  const detected = stdout && "columns" in stdout ? Number(stdout.columns) : 80;
  return detected > 0 ? detected : 80;
}

export function Rule() {
  const columns = useTerminalColumns();
  const width = Math.max(16, Math.min(columns - 2, 72));
  return <Text color={theme.border}>{"─".repeat(width)}</Text>;
}

export function Key({ children, primary = false }: { children: string; primary?: boolean }) {
  return (
    <Text
      bold
      {...(primary
        ? { color: theme.surface, backgroundColor: theme.brand }
        : { color: theme.brand })}
    >
      {primary ? ` ${children} ` : children}
    </Text>
  );
}
