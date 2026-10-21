// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TranscriptFind } from "./TranscriptFind";
import { TranscriptPlatformContext } from "./TranscriptPlatform";
import { queryClient } from "../../../shared/lib/queryClient";

it("loads an earlier page before navigating to an unloaded search hit", async () => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container), navigated = vi.fn(), loaded = vi.fn();
  const source = { key: ["history-find"], read: vi.fn(), search: async () => ({ revision: 1, total: 1, ids: ["old"] }) };
  function Harness() {
    const [blocks, setBlocks] = useState<{ id: string; role: "assistant"; text: string }[]>([]);
    return createElement(TranscriptPlatformContext.Provider, { value: {
      copyText: async () => {}, copyMessage: async () => {}, readBinaryFile: async () => new Uint8Array(), openExternal: async () => {}, localFiles: false, toolContent: source,
    } }, createElement(TranscriptFind, { blocks, visible: true, focused: true,
      historyPaging: { hasMore: !blocks.length, loadEarlier: async () => { loaded(); setBlocks([{ id: "old", role: "assistant", text: "needle" }]); } },
      onNavigate: id => { if (id && blocks.some(block => block.id === id)) { navigated(id); return true; } return false; },
    }));
  }
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true })); await vi.advanceTimersByTimeAsync(50); });
    await act(async () => {
      const input = container.querySelector("input")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "needle");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    for (let i = 0; i < 6; i++) await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(navigated).toHaveBeenLastCalledWith("old");
  } finally {
    act(() => root.unmount()); container.remove(); queryClient.clear(); vi.useRealTimers(); vi.unstubAllGlobals();
  }
});

it("finds unloaded tool output and wraps backwards across remote result pages", async () => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const navigate = vi.fn(() => true), select = vi.fn();
  const search = vi.fn(async (_query: string, offset = 0) => ({ revision: 1, total: 105,
    ids: Array.from({ length: Math.min(100, 105 - offset) }, (_, i) => `tool${i + offset}`),
    hits: Object.fromEntries(Array.from({ length: Math.min(100, 105 - offset) }, (_, i) => [`tool${i + offset}`, { field: "output" as const, offset: 20000 }])),
  }));
  const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(50); }); };
  try {
    await act(async () => root.render(createElement(TranscriptPlatformContext.Provider, { value: {
      copyText: async () => {}, copyMessage: async () => {}, readBinaryFile: async () => new Uint8Array(), openExternal: async () => {}, localFiles: false,
      toolContent: { key: ["search-host"], read: vi.fn(), search }, selectToolContent: select,
    } }, createElement(TranscriptFind, { blocks: [], visible: true, focused: true, onNavigate: navigate }))));
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true })));
    await settle();
    const input = container.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "needle");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle(); await settle();
    expect(search).toHaveBeenCalledWith("needle", 0, expect.any(AbortSignal));
    expect(select).toHaveBeenLastCalledWith({ blockId: "tool0", field: "output", offset: 20000, query: "needle" });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Previous match"]')!.click());
    await settle(); await settle();
    expect(search).toHaveBeenLastCalledWith("needle", 100, expect.any(AbortSignal));
    expect(navigate).toHaveBeenLastCalledWith("tool104", "needle");
    expect(container.textContent).toContain("105 of 105");
  } finally {
    act(() => root.unmount()); container.remove(); queryClient.clear(); vi.useRealTimers(); vi.unstubAllGlobals();
  }
});
