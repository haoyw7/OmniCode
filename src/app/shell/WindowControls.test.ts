// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WindowControls } from "./WindowControls";
import { WINDOW_RESIZE_IDLE_MS } from "./windowResizeWork";

const native = vi.hoisted(() => ({ isMaximized: vi.fn(), onResized: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
vi.mock("../../shared/i18n/useTranslation", () => ({ useTranslation: () => ({ t: (text: string) => text }) }));

it("coalesces resize queries and ignores a stale initial native response", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resolveInitial!: (value: boolean) => void;
  let resized!: () => void;
  const stop = vi.fn();
  native.isMaximized.mockReset()
    .mockReturnValueOnce(new Promise<boolean>(resolve => { resolveInitial = resolve; }))
    .mockResolvedValue(true);
  native.onResized.mockImplementation(async (listener) => { resized = listener; return stop; });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(WindowControls)));
    act(() => { for (let i = 0; i < 100; i++) resized(); });
    expect(native.isMaximized).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(WINDOW_RESIZE_IDLE_MS));
    expect(native.isMaximized).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[aria-label="Restore window"]')).not.toBeNull();
    await act(async () => resolveInitial(false));
    expect(container.querySelector('[aria-label="Restore window"]')).not.toBeNull();
    act(() => resized());
  } finally {
    act(() => root.unmount());
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
  expect(stop).toHaveBeenCalledOnce();
  expect(native.isMaximized).toHaveBeenCalledTimes(2);
});
