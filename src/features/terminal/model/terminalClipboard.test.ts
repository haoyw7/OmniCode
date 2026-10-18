// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pasteTerminalClipboard } from "./terminalClipboard";

beforeEach(() => {
  Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
});
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "execCommand");
});

it("does not paste twice when a handled native paste returns false", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const term = { focus: vi.fn(), paste: vi.fn() };
  const read = vi.spyOn(navigator.clipboard, "readText").mockResolvedValue("duplicate");
  vi.spyOn(document, "execCommand").mockImplementation(() => {
    host.dispatchEvent(new Event("paste", { bubbles: true }));
    term.paste("native");
    return false;
  });
  try {
    await pasteTerminalClipboard(term, host, () => true);
    expect(term.paste.mock.calls).toEqual([["native"]]);
    expect(read).not.toHaveBeenCalled();
  } finally {
    host.remove();
  }
});

it("falls back to clipboard text without rewriting multiline input", async () => {
  const term = { focus: vi.fn(), paste: vi.fn() };
  vi.spyOn(document, "execCommand").mockReturnValue(false);
  vi.spyOn(navigator.clipboard, "readText").mockResolvedValue("echo 你好\necho world");
  await pasteTerminalClipboard(term, document.body, () => true);
  expect(term.paste).toHaveBeenCalledExactlyOnceWith("echo 你好\necho world");
});

it("does not deliver a delayed clipboard read after the terminal loses ownership", async () => {
  const term = { focus: vi.fn(), paste: vi.fn() };
  vi.spyOn(document, "execCommand").mockReturnValue(false);
  let resolve!: (text: string) => void;
  vi.spyOn(navigator.clipboard, "readText").mockImplementation(() => new Promise(r => { resolve = r; }));
  let current = true;
  const pending = pasteTerminalClipboard(term, document.body, () => current);
  current = false;
  resolve("old clipboard");
  await pending;
  expect(term.paste).not.toHaveBeenCalled();
});
