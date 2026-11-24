import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { Markdown } from "../../packages/tui/src/components/conversation/markdown.js";

describe("Markdown terminal rendering", () => {
  it("renders structure instead of exposing markdown delimiters", () => {
    const source = [
      "# Implementation plan",
      "Use **safe edits** with `pnpm test` and [docs](https://example.com).",
      "- inspect the code",
      "- verify the result",
      "```ts",
      "const answer = 42;",
      "```",
      "> evidence matters",
    ].join("\n");
    const view = render(<Markdown source={source} />);
    const frame = view.lastFrame();
    expect(frame).toContain("Implementation plan");
    expect(frame).toContain("safe edits");
    expect(frame).toContain("pnpm test");
    expect(frame).toContain("• inspect the code");
    expect(frame).toContain("const answer = 42;");
    expect(frame).toContain("ts");
    expect(frame).toContain("┃ evidence matters");
    expect(frame).not.toContain("**");
    expect(frame).not.toContain("```");
    view.unmount();
  });

  it("renders tables and inline formatting", () => {
    const source = "| Name | Status |\n| --- | --- |\n| tests | **passed** |";
    const view = render(<Markdown source={source} />);
    expect(view.lastFrame()).toContain("Name │ Status");
    expect(view.lastFrame()).toContain("tests │ passed");
    view.unmount();
  });
});
