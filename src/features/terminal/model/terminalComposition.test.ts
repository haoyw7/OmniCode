// @vitest-environment happy-dom
import { Terminal } from "@xterm/xterm";
import { afterEach, expect, it, vi } from "vitest";
import { guardTerminalComposition } from "./terminalComposition";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
});

function setup() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const term = new Terminal({ fontFamily: "monospace" });
  term.open(host);
  const stop = guardTerminalComposition(term.textarea);
  const sent: string[] = [];
  term.onData((data) => sent.push(data));
  cleanups.push(() => {
    stop();
    term.dispose();
    host.remove();
  });
  return { textarea: term.textarea!, sent };
}

async function directCommit(textarea: HTMLTextAreaElement, data: string) {
  // Captured WebKitGTK/Fcitx sequence: a direct commit has no compositionstart.
  textarea.dispatchEvent(new KeyboardEvent("keydown", {
    bubbles: true, cancelable: true, key: "Unidentified", keyCode: 229,
  }));
  textarea.dispatchEvent(new InputEvent("beforeinput", {
    bubbles: true, composed: true, inputType: "insertFromComposition",
    isComposing: true, data,
  }));
  textarea.value += data;
  textarea.dispatchEvent(new InputEvent("input", {
    bubbles: true, composed: true, inputType: "insertFromComposition",
    isComposing: true, data,
  }));
  textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data }));
  await vi.advanceTimersByTimeAsync(1);
  textarea.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, keyCode: 65 }));
}

it("sends each direct commit once without replaying earlier input", async () => {
  const { textarea, sent } = setup();
  for (const text of ["a", "1", "a", "a"]) await directCommit(textarea, text);
  expect(sent).toEqual(["a", "1", "a", "a"]);
});

it("keeps normal IME composition and subsequent direct commits working", async () => {
  const { textarea, sent } = setup();
  await directCommit(textarea, "a");
  textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  textarea.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: "ni" }));
  textarea.value += "ni";
  await vi.advanceTimersByTimeAsync(1);
  expect(sent).toEqual(["a"]);
  textarea.value = textarea.value.slice(0, -2) + "你";
  textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "你" }));
  await vi.advanceTimersByTimeAsync(1);
  await directCommit(textarea, "1");
  expect(sent).toEqual(["a", "你", "1"]);
});

it("does not send cancelled composition text", async () => {
  const { textarea, sent } = setup();
  textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  textarea.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: "ni" }));
  textarea.value = "ni";
  await vi.advanceTimersByTimeAsync(1);
  textarea.value = "";
  textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "" }));
  await vi.advanceTimersByTimeAsync(1);
  expect(sent).toEqual([]);
});

it("leaves commit-only input without keydown to xterm", async () => {
  const { textarea, sent } = setup();
  textarea.value = "🙂";
  textarea.dispatchEvent(new CompositionEvent("compositionend", {
    bubbles: true, data: "🙂",
  }));
  await vi.advanceTimersByTimeAsync(1);
  expect(sent).toEqual(["🙂"]);
});
