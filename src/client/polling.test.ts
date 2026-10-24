import { afterEach, expect, it, vi } from "vitest";
import { startHostPolling } from "./polling";
import type { LifecyclePort } from "./ports";

afterEach(() => vi.useRealTimers());

it("does not poll hidden transcripts and resumes once without concurrent requests", async () => {
  vi.useFakeTimers();
  let active = false;
  let listener!: (active: boolean) => void;
  let finish!: (busy: boolean) => void;
  const unsubscribe = vi.fn();
  const lifecycle: LifecyclePort = { isActive: () => active, subscribe: (next) => { listener = next; return unsubscribe; } };
  const poll = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const stop = startHostPolling({ poll, supportsWait: () => true, lifecycle, onError: vi.fn() });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(poll).not.toHaveBeenCalled();
  active = true; listener(true); listener(true);
  expect(poll).toHaveBeenCalledExactlyOnceWith(1_000);
  active = false; listener(false);
  finish(true);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(poll).toHaveBeenCalledTimes(1);
  active = true; listener(true);
  expect(poll).toHaveBeenCalledTimes(2);
  stop(); finish(true);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(poll).toHaveBeenCalledTimes(2);
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

it("falls back to short polls without wait capability and backs off network failures", async () => {
  vi.useFakeTimers();
  const error = new Error("offline");
  const poll = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(true);
  const onError = vi.fn();
  const stop = startHostPolling({ poll, supportsWait: () => false, onError });
  await vi.advanceTimersByTimeAsync(1_499);
  expect(poll).toHaveBeenCalledExactlyOnceWith(undefined);
  expect(onError).toHaveBeenCalledWith(error);
  await vi.advanceTimersByTimeAsync(1);
  expect(poll).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(250);
  expect(poll).toHaveBeenCalledTimes(3);
  stop();
});
