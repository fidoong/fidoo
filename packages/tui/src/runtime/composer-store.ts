export interface ComposerState {
  value: string;
  cursor: number;
  history: string[];
  historyIndex: number;
  suggestionIndex: number;
}

export class ComposerStore {
  private state: ComposerState = {
    value: "",
    cursor: 0,
    history: [],
    historyIndex: -1,
    suggestionIndex: 0,
  };
  private historyDraft = "";
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): ComposerState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  insert(text: string): void {
    const value = text.replace(/\r\n?/g, "\n");
    if (!value) return;
    const characters = Array.from(this.state.value);
    characters.splice(this.state.cursor, 0, ...Array.from(value));
    this.setValue(characters.join(""), this.state.cursor + Array.from(value).length);
  }

  backspace(): void {
    if (this.state.cursor <= 0) return;
    const characters = Array.from(this.state.value);
    characters.splice(this.state.cursor - 1, 1);
    this.setValue(characters.join(""), this.state.cursor - 1);
  }

  clear(): void {
    this.historyDraft = "";
    this.update({ value: "", cursor: 0, historyIndex: -1, suggestionIndex: 0 });
  }

  moveLeft(): void {
    this.update({ cursor: Math.max(0, this.state.cursor - 1) });
  }

  moveRight(): void {
    this.update({ cursor: Math.min(Array.from(this.state.value).length, this.state.cursor + 1) });
  }

  moveLineStart(): void {
    const characters = Array.from(this.state.value);
    const before = characters.slice(0, this.state.cursor);
    this.update({ cursor: before.lastIndexOf("\n") + 1 });
  }

  moveLineEnd(): void {
    const characters = Array.from(this.state.value);
    const next = characters.indexOf("\n", this.state.cursor);
    this.update({ cursor: next < 0 ? characters.length : next });
  }

  moveVertical(direction: -1 | 1): boolean {
    const lines = this.lineRanges();
    const current = lines.findIndex(
      (line) => this.state.cursor >= line.start && this.state.cursor <= line.end,
    );
    const target = lines[current + direction];
    const line = lines[current];
    if (current < 0 || !line || !target) return false;
    const column = this.state.cursor - line.start;
    this.update({ cursor: Math.min(target.start + column, target.end) });
    return true;
  }

  historyPrevious(): void {
    if (this.state.history.length === 0) return;
    if (this.state.historyIndex < 0) this.historyDraft = this.state.value;
    const index =
      this.state.historyIndex < 0
        ? this.state.history.length - 1
        : Math.max(0, this.state.historyIndex - 1);
    this.updateHistory(index, this.state.history[index] ?? "");
  }

  historyNext(): void {
    if (this.state.historyIndex < 0) return;
    const index = this.state.historyIndex + 1;
    if (index >= this.state.history.length) {
      this.updateHistory(-1, this.historyDraft);
      this.historyDraft = "";
      return;
    }
    this.updateHistory(index, this.state.history[index] ?? "");
  }

  moveSuggestion(direction: -1 | 1, length: number): void {
    if (length <= 0) return;
    this.update({ suggestionIndex: (this.state.suggestionIndex + direction + length) % length });
  }

  complete(value: string): void {
    this.setValue(value, Array.from(value).length);
  }

  submit(): string | undefined {
    const submitted = this.state.value.trim();
    if (!submitted) return undefined;
    this.historyDraft = "";
    this.update({
      value: "",
      cursor: 0,
      history: [...this.state.history, submitted],
      historyIndex: -1,
      suggestionIndex: 0,
    });
    return submitted;
  }

  private setValue(value: string, cursor: number): void {
    this.update({ value, cursor, suggestionIndex: 0 });
  }

  private updateHistory(historyIndex: number, value: string): void {
    this.update({ value, cursor: Array.from(value).length, historyIndex, suggestionIndex: 0 });
  }

  private lineRanges() {
    const characters = Array.from(this.state.value);
    const ranges: Array<{ start: number; end: number }> = [];
    let start = 0;
    for (let index = 0; index <= characters.length; index += 1) {
      if (index === characters.length || characters[index] === "\n") {
        ranges.push({ start, end: index });
        start = index + 1;
      }
    }
    return ranges;
  }

  private update(update: Partial<ComposerState>): void {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }
}
