// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTranscriptHaptics } from "./useTranscriptHaptics";
import { outputHaptics, setHapticsForeground } from "./haptics";
import { saveHapticPreferences } from "./hapticPreferences";
import type { Block } from "../features/sessions/model/session";

const native = vi.hoisted(() => ({ pulse: vi.fn(async () => {}), feedback: vi.fn(async () => {}), cancel: vi.fn(async () => {}) }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => "android", isPluginAvailable: () => true },
  registerPlugin: () => native,
}));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, node: HTMLDivElement;
let blocks: Block[];
function View(props: Partial<Parameters<typeof useTranscriptHaptics>[0]>) {
  useTranscriptHaptics({ blocks, busy: true, active: true, scope: "main", ...props });
  return null;
}
function render(props: Partial<Parameters<typeof useTranscriptHaptics>[0]> = {}) {
  act(() => root.render(createElement(View, props)));
}
function append(text: string) { blocks = [{ id: "a", role: "assistant", text, streaming: true }]; }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  saveHapticPreferences({ interactions: true, output: true, strength: "gentle" });
  setHapticsForeground(true);
  node = document.createElement("div"); document.body.append(node);
  root = createRoot(node); blocks = [];
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount()); node.remove();
  outputHaptics.stop(); setHapticsForeground(true);
  vi.restoreAllMocks(); vi.useRealTimers();
});

it("pulses for newly received text, not initial or duplicate snapshots", () => {
  append("history"); render();
  expect(native.pulse).not.toHaveBeenCalled();
  append("history new"); render();
  expect(native.pulse).toHaveBeenCalledOnce();
  act(() => vi.advanceTimersByTime(400));
  const count = native.pulse.mock.calls.length;
  render(); act(() => vi.advanceTimersByTime(1000));
  expect(native.pulse).toHaveBeenCalledTimes(count);
});

it("stops on hiding, seeds returned history and resumes only for further text", () => {
  render(); append("one"); render();
  render({ active: false });
  const count = native.pulse.mock.calls.length;
  act(() => vi.advanceTimersByTime(1000));
  append("one received while covered"); render({ active: false });
  render();
  expect(native.pulse).toHaveBeenCalledTimes(count);
  append("one received while covered next"); render();
  expect(native.pulse.mock.calls.length).toBeGreaterThan(count);
});

it("cancels in the native background and never vibrates a resume backlog", () => {
  render(); append("one"); render();
  setHapticsForeground(false);
  const count = native.pulse.mock.calls.length;
  act(() => vi.advanceTimersByTime(1000));
  setHapticsForeground(true);
  append("one resumed backlog"); render();
  expect(native.pulse).toHaveBeenCalledTimes(count);
  append("one resumed backlog new"); render();
  expect(native.pulse.mock.calls.length).toBeGreaterThan(count);
});

it("honors independent settings immediately and supports the next turn after completion", () => {
  render(); append("one"); render();
  act(() => saveHapticPreferences({ interactions: false, output: false, strength: "standard" }));
  const count = native.pulse.mock.calls.length;
  append("one more"); render(); act(() => vi.advanceTimersByTime(500));
  render({ busy: false });
  expect(native.pulse).toHaveBeenCalledTimes(count);
  expect(native.feedback).not.toHaveBeenCalled();
  act(() => saveHapticPreferences({ interactions: true, output: true, strength: "standard" }));
  render({ busy: false });
  blocks = [...blocks, { id: "u", role: "user", text: "again" }]; render();
  blocks = [...blocks, { id: "b", role: "assistant", text: "new output" }]; render();
  expect(native.pulse).toHaveBeenLastCalledWith({ strength: "standard" });
  render({ busy: false });
  expect(native.feedback).toHaveBeenCalledExactlyOnceWith({ cue: "success" });
});

it("does not replay restored history or announce an interrupted turn as completed", () => {
  render(); append("cached"); render({ history: blocks });
  expect(native.pulse).not.toHaveBeenCalled();
  append("cached new"); render();
  render({ busy: false, completed: false });
  expect(native.feedback).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
