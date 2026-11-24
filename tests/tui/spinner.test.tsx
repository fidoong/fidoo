import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Spinner } from "../../packages/tui/src/components/layout/spinner.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  vi.unstubAllEnvs();
});

describe("Spinner", () => {
  it("animates active work with a shared clock", async () => {
    const view = render(<Spinner active />);
    cleanups.push(() => view.unmount());
    const initial = view.lastFrame();
    await vi.waitFor(() => expect(view.lastFrame()).not.toBe(initial));
  });

  it("supports a static reduced-motion fallback", () => {
    vi.stubEnv("FIDOO_MOTION", "off");
    const view = render(<Spinner active />);
    cleanups.push(() => view.unmount());
    expect(view.lastFrame()).toBe("●");
  });
});
