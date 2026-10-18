import { describe, expect, it } from "vitest";
import {
  isMacTerminalClearShortcut,
  macTerminalShortcutData,
  terminalClipboardShortcut,
} from "./terminalKeys";

function key(
  key: string,
  modifiers: Partial<
    Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">
  > = {},
) {
  return {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    keyCode: 0,
    ...modifiers,
  };
}

describe("terminal clipboard shortcuts", () => {
  it("preserves Ctrl+C as interrupt unless there is a selection", () => {
    const event = key("c", { ctrlKey: true });
    expect(terminalClipboardShortcut(event, false, false)).toBeNull();
    expect(terminalClipboardShortcut(event, false, true)).toBe("copy");
    expect(terminalClipboardShortcut(key("C", { ctrlKey: true, shiftKey: true }), false, false)).toBe("copy");
  });

  it("supports Ctrl+V, Ctrl+Shift+V and Insert shortcuts", () => {
    expect(terminalClipboardShortcut(key("v", { ctrlKey: true }), false, false)).toBe("paste");
    expect(terminalClipboardShortcut(key("V", { ctrlKey: true, shiftKey: true }), false, false)).toBe("paste");
    expect(terminalClipboardShortcut(key("Insert", { ctrlKey: true }), false, true)).toBe("copy");
    expect(terminalClipboardShortcut(key("Insert", { shiftKey: true }), false, false)).toBe("paste");
  });

  it("uses Command on macOS and preserves its Ctrl shell bindings", () => {
    expect(terminalClipboardShortcut(key("c", { metaKey: true }), true, false)).toBe("copy");
    expect(terminalClipboardShortcut(key("v", { metaKey: true }), true, false)).toBe("paste");
    expect(terminalClipboardShortcut(key("c", { ctrlKey: true }), true, true)).toBeNull();
    expect(terminalClipboardShortcut(key("v", { ctrlKey: true }), true, false)).toBeNull();
  });

  it("leaves IME and Alt combinations untouched", () => {
    const event = key("v", { ctrlKey: true });
    expect(terminalClipboardShortcut({ ...event, isComposing: true }, false, false)).toBeNull();
    expect(terminalClipboardShortcut({ ...event, keyCode: 229 }, false, false)).toBeNull();
    expect(terminalClipboardShortcut({ ...event, altKey: true }, false, false)).toBeNull();
  });
});

describe("mac terminal editing shortcuts", () => {
  it("sends shell word movement for Option+Arrow", () => {
    expect(macTerminalShortcutData(key("ArrowLeft", { altKey: true }))).toBe(
      "\x1bb",
    );
    expect(macTerminalShortcutData(key("ArrowRight", { altKey: true }))).toBe(
      "\x1bf",
    );
  });

  it("sends line movement and deletion for Command shortcuts", () => {
    expect(macTerminalShortcutData(key("ArrowLeft", { metaKey: true }))).toBe(
      "\x01",
    );
    expect(macTerminalShortcutData(key("ArrowRight", { metaKey: true }))).toBe(
      "\x05",
    );
    expect(macTerminalShortcutData(key("Backspace", { metaKey: true }))).toBe(
      "\x15",
    );
  });

  it("leaves other modifiers and keys to xterm and app shortcuts", () => {
    expect(
      macTerminalShortcutData(
        key("ArrowLeft", { metaKey: true, altKey: true }),
      ),
    ).toBeNull();
    expect(
      macTerminalShortcutData(
        key("ArrowLeft", { altKey: true, shiftKey: true }),
      ),
    ).toBeNull();
    expect(
      macTerminalShortcutData(key("ArrowLeft", { ctrlKey: true })),
    ).toBeNull();
    expect(
      macTerminalShortcutData(key("Backspace", { altKey: true })),
    ).toBeNull();
    expect(
      macTerminalShortcutData(key("Delete", { metaKey: true })),
    ).toBeNull();
  });
});

describe("mac terminal clear shortcut", () => {
  it("matches Command+K only", () => {
    expect(isMacTerminalClearShortcut(key("k", { metaKey: true }))).toBe(true);
    expect(isMacTerminalClearShortcut(key("K", { metaKey: true }))).toBe(true);
    expect(isMacTerminalClearShortcut(key("k", { ctrlKey: true }))).toBe(false);
    expect(
      isMacTerminalClearShortcut(key("k", { metaKey: true, shiftKey: true })),
    ).toBe(false);
    expect(
      isMacTerminalClearShortcut(key("k", { metaKey: true, altKey: true })),
    ).toBe(false);
    expect(isMacTerminalClearShortcut(key("j", { metaKey: true }))).toBe(false);
  });
});
