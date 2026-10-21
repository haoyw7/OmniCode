// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { SurfaceVisibilityContext } from "../../../shared/ui/SurfaceVisibility";
import { TranscriptPlatformContext } from "./TranscriptPlatform";
import { ToolContentPanel } from "./ToolContentPanel";
import type { ToolContentRef, ToolContentSource } from "../../../integrations/harness/core/toolContent";

vi.mock("../../../shared/ui/ReadonlyTextView", () => ({ ReadonlyTextView: ({ text }: { text: string }) => createElement("pre", {}, text) }));
const reference: ToolContentRef = { sessionId: "s", blockPath: ["t"], version: "v1", fields: [
  { name: "output", bytes: 20000, characters: 20000 }, { name: "detail", bytes: 20000, characters: 20000, aliasOf: "output" },
] };
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); queryClient.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render(source: ToolContentSource, active: boolean, visible = true) {
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: queryClient },
      createElement(TranscriptPlatformContext.Provider, { value: {
        toolContent: source, copyText: async () => {}, copyMessage: async () => {}, openExternal: async () => {}, readBinaryFile: async () => new Uint8Array(), localFiles: false,
      } }, createElement(SurfaceVisibilityContext.Provider, { value: visible }, createElement(ToolContentPanel, { reference, active })))));
    await vi.advanceTimersByTimeAsync(1);
  });
}

it("loads only expanded visible details, deduplicates aliases, and stops live polling when hidden", async () => {
  const source: ToolContentSource = { key: ["test"], read: vi.fn(async () => ({ sessionId: "s", blockPath: ["t"], field: "output", version: "v1", transfer: "token", start: 19996, end: 20000, total: 20000, text: "tail", running: true })) };
  await render(source, false); expect(source.read).not.toHaveBeenCalled();
  await render(source, true);
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  expect(source.read).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("tail");
  expect(container.querySelectorAll("[data-tool-content-field]")).toHaveLength(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(source.read).toHaveBeenCalledTimes(2);
  await render(source, false);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(source.read).toHaveBeenCalledTimes(2);
  await render(source, true, false);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(source.read).toHaveBeenCalledTimes(2);
});

it("keeps detail errors local and retries explicitly", async () => {
  const read = vi.fn(async () => { throw new Error("Tool content expired. Reload the details."); });
  const source: ToolContentSource = { key: ["retry"], read };
  await render(source, true);
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("expired");
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => {
    [...container.querySelectorAll("button")].find(button => button.textContent === "Retry")!.click();
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(read).toHaveBeenCalledTimes(2);
});
