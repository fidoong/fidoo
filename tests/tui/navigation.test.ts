import { describe, expect, it } from "vitest";
import {
  moveSelection,
  navigationIntent,
  selectionWindow,
} from "../../packages/tui/src/navigation/navigation.js";
import { ComposerStore } from "../../packages/tui/src/runtime/composer-store.js";

describe("TUI navigation", () => {
  it("maps arrows to shared navigation intents", () => {
    expect(navigationIntent("", { upArrow: true })).toBe("previous");
    expect(navigationIntent("", { downArrow: true })).toBe("next");
    expect(navigationIntent("", { leftArrow: true })).toBe("left");
    expect(navigationIntent("", { rightArrow: true })).toBe("right");
    expect(navigationIntent("", { return: true })).toBe("activate");
    expect(navigationIntent("", { escape: true })).toBe("back");
  });

  it("wraps list selection and keeps the selected item visible", () => {
    expect(moveSelection(0, 4, -1)).toBe(3);
    expect(moveSelection(3, 4, 1)).toBe(0);
    expect(selectionWindow(8, 20, 5)).toEqual({ start: 6, end: 11 });
  });

  it("keeps composer state outside the component and edits at the cursor", () => {
    const store = new ComposerStore();
    store.insert("world");
    store.moveLineStart();
    store.insert("hello ");
    expect(store.getSnapshot().value).toBe("hello world");
    store.moveLineEnd();
    store.moveLeft();
    store.backspace();
    expect(store.getSnapshot().value).toBe("hello word");
    expect(store.submit()).toBe("hello word");
    store.insert("draft");
    store.historyPrevious();
    expect(store.getSnapshot().value).toBe("hello word");
    store.historyNext();
    expect(store.getSnapshot().value).toBe("draft");
  });

  it("moves vertically through multiline input without losing the column", () => {
    const store = new ComposerStore();
    store.insert("one\ntwo\nthree");
    store.moveLineStart();
    expect(store.moveVertical(-1)).toBe(true);
    expect(store.getSnapshot().cursor).toBe(4);
    expect(store.moveVertical(-1)).toBe(true);
    expect(store.getSnapshot().cursor).toBe(0);
    expect(store.moveVertical(-1)).toBe(false);
    expect(store.moveVertical(1)).toBe(true);
    expect(store.getSnapshot().cursor).toBe(4);
  });
});
