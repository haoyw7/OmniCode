import { expect, it, vi } from "vitest";
import { createTerminalFitScheduler } from "./terminalFitScheduler";

it("coalesces resize notifications into a task and closes both ports", () => {
  const channels: { port1: { onmessage: (() => void) | null; close: ReturnType<typeof vi.fn> }; port2: { postMessage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } }[] = [];
  class Channel {
    port1 = { onmessage: null as (() => void) | null, close: vi.fn() };
    port2 = { postMessage: vi.fn(), close: vi.fn() };
    constructor() { channels.push(this); }
  }
  const fit = vi.fn();
  const queue = createTerminalFitScheduler(fit, { MessageChannel: Channel } as unknown as Window);
  queue.schedule(); queue.schedule(); queue.schedule();
  expect(fit).not.toHaveBeenCalled();
  expect(channels).toHaveLength(1);
  channels[0].port1.onmessage!();
  expect(fit).toHaveBeenCalledOnce();
  expect(channels[0].port1.close).toHaveBeenCalledOnce();
  expect(channels[0].port2.close).toHaveBeenCalledOnce();
  queue.schedule();
  queue.cancel();
  expect(channels[1].port1.onmessage).toBeNull();
  queue.schedule();
  queue.dispose();
  queue.schedule();
  expect(channels).toHaveLength(3);
  expect(channels[2].port2.close).toHaveBeenCalledOnce();
});

it("uses a cancellable task fallback without MessageChannel", () => {
  vi.useFakeTimers();
  try {
    const fit = vi.fn();
    const queue = createTerminalFitScheduler(fit, { setTimeout, clearTimeout } as unknown as Window);
    queue.schedule(); queue.schedule();
    expect(fit).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(fit).toHaveBeenCalledOnce();
    queue.schedule(); queue.dispose();
    vi.runOnlyPendingTimers();
    expect(fit).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});
