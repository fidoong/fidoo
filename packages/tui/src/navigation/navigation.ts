export type NavigationIntent = "previous" | "next" | "left" | "right" | "activate" | "back";

export interface NavigationKey {
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  return?: boolean;
  escape?: boolean;
}

export function navigationIntent(_input: string, key: NavigationKey): NavigationIntent | undefined {
  if (key.upArrow) return "previous";
  if (key.downArrow) return "next";
  if (key.leftArrow) return "left";
  if (key.rightArrow) return "right";
  if (key.return) return "activate";
  if (key.escape) return "back";
  return undefined;
}

export function moveSelection(current: number, length: number, delta: -1 | 1): number {
  if (length <= 0) return 0;
  return (current + delta + length) % length;
}

export function selectionWindow(selected: number, total: number, size: number) {
  const visible = Math.max(1, Math.min(size, total));
  const start = Math.max(0, Math.min(selected - Math.floor(visible / 2), total - visible));
  return { start, end: start + visible };
}
