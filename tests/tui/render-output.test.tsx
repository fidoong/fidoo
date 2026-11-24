import { Writable } from "node:stream";
import { renderInk as render, type TuiState } from "@fidoo/tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "../../packages/tui/src/components/conversation/message-list.js";
import { applyRunEvent, initialTuiState } from "../../packages/tui/src/runtime/store.js";
import { publicEvent as event } from "../helpers/public-event.js";

class CapturedTty extends Writable {
  readonly isTTY = true;
  readonly columns = 100;
  readonly rows = 24;
  output = "";

  override _write(chunk: unknown, _encoding: BufferEncoding, callback: () => void): void {
    this.output += String(chunk);
    callback();
  }
}

afterEach(() => vi.unstubAllEnvs());

describe("Ink terminal output", () => {
  it("appends long streaming responses without fullscreen clears or duplicate blocks", async () => {
    vi.stubEnv("FIDOO_MOTION", "off");
    const stdout = new CapturedTty();
    let state: TuiState = initialTuiState();
    state = applyRunEvent(state, event(1, "message.reasoning.delta", { text: "Plan the answer" }));
    const view = render(
      <MessageList messages={state.messages} streamingText="" reasoningState={state} />,
      { stdout, patchConsole: false },
    );
    try {
      for (let index = 0; index < 12; index += 1) {
        state = applyRunEvent(
          state,
          event(2, "message.assistant.delta", { text: `Paragraph ${index}\n\n` }),
        );
        view.rerender(
          <MessageList
            messages={state.messages}
            streamingText={state.streamingText}
            reasoningState={state}
          />,
        );
        await view.waitUntilRenderFlush();
      }
      expect(stdout.output).not.toContain("\u001b[H\u001b[0J");
      expect(stdout.output.match(/Paragraph 0/g)).toHaveLength(1);
      expect(stdout.output.match(/Paragraph 11/g)).toHaveLength(1);
      expect(stdout.output).toContain("Plan the answer");
      expect(stdout.output).toContain("  Paragraph 0");
    } finally {
      view.unmount();
    }
  });
});
