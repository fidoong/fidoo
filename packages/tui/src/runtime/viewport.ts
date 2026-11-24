export function visibleTail(source: string, maxLines: number): string {
  const lines = source.split("\n");
  if (lines.length <= maxLines) return source;
  const visible = lines.slice(-maxLines);
  const opening = lines.find((line) => /^ {0,3}(```|~~~)/.test(line));
  const hasFence = visible.some((line) => /^ {0,3}(```|~~~)/.test(line));
  return [
    `… ${lines.length - maxLines} earlier streaming lines`,
    ...(opening && !hasFence ? [opening] : []),
    ...visible,
  ].join("\n");
}
