import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { UserInputDialog } from "../../packages/tui/src/components/dialogs/user-input-dialog.js";

describe("UserInputDialog", () => {
  it("selects options and submits their stable ids", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <UserInputDialog
        questions={[
          {
            id: "scope",
            question: "Choose a scope",
            options: [
              { id: "minimal", label: "Minimal change" },
              { id: "full", label: "Full refactor" },
            ],
          },
        ]}
        onSubmit={onSubmit}
      />,
    );
    view.stdin.write("\x1B[B");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("› Full refactor"));
    view.stdin.write("\r");
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ scope: ["full"] }));
    view.unmount();
  });

  it("accepts a free-form answer", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <UserInputDialog questions={[{ id: "name", question: "What name?" }]} onSubmit={onSubmit} />,
    );
    view.stdin.write("Fidoo");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("› Fidoo"));
    view.stdin.write("\r");
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: ["Fidoo"] }));
    view.unmount();
  });
});
