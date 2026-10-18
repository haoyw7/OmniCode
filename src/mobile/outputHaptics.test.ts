import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OutputHaptics } from "./outputHaptics";
import { TranscriptHapticsTracker } from "./transcriptHaptics";
import type { Block } from "../features/sessions/model/session";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); });
afterEach(() => vi.useRealTimers());
const block = (id: string, text: string, role: Block["role"] = "assistant"): Block => ({ id, text, role });

it("increases pulse frequency with real output, with a bounded gradual cadence", () => {
  const run = (count: number) => {
    const pulses: number[] = [];
    const engine = new OutputHaptics(() => pulses.push(Date.now()), () => {});
    const owner = {};
    engine.claim(owner);
    for (let step = 0; step < 80; step++) {
      engine.add(owner, count);
      vi.advanceTimersByTime(100);
    }
    engine.release(owner);
    return pulses;
  };
  const slow = run(1), fast = run(20);
  expect(fast.length).toBeGreaterThan(slow.length * 2);
  const gaps = fast.slice(1).map((at, index) => at - fast[index]);
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1000 / 6);
  expect(Math.max(...gaps)).toBeLessThanOrEqual(675);
});

it("pauses within 400ms without new text and never drains a burst as a vibration backlog", () => {
  const pulse = vi.fn();
  const engine = new OutputHaptics(pulse, vi.fn());
  const owner = {};
  engine.claim(owner);
  engine.add(owner, 10_000);
  vi.advanceTimersByTime(400);
  const count = pulse.mock.calls.length;
  vi.advanceTimersByTime(10_000);
  expect(pulse).toHaveBeenCalledTimes(count);
  expect(vi.getTimerCount()).toBe(0);
  engine.add(owner, 4);
  expect(pulse.mock.calls.length).toBeGreaterThan(count);
  engine.release(owner);
});

it("gives only the focused surface ownership, cancels on release, and prioritizes interactions", () => {
  const pulse = vi.fn(), cancel = vi.fn();
  const engine = new OutputHaptics(pulse, cancel);
  const main = {}, sheet = {};
  engine.claim(main);
  engine.add(main, 10);
  engine.claim(sheet);
  pulse.mockClear();
  engine.add(main, 100);
  engine.release(main);
  expect(pulse).not.toHaveBeenCalled();
  engine.interrupt();
  engine.add(sheet, 100);
  vi.advanceTimersByTime(349);
  expect(pulse).not.toHaveBeenCalled();
  vi.advanceTimersByTime(26);
  expect(pulse).toHaveBeenCalledOnce();
  engine.release(sheet);
  vi.advanceTimersByTime(1000);
  expect(pulse).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("ignores initial history, duplicate/shrinking snapshots, restored turns and replays", () => {
  const tracker = new TranscriptHapticsTracker();
  const initial = [block("u", "question", "user"), block("a", "old")];
  expect(tracker.update(initial, true).characters).toBe(0);
  const update = [...initial.slice(0, 1), block("a", "old中文🙂")];
  expect(tracker.update(update, true).characters).toBe(3);
  expect(tracker.update(update, true).characters).toBe(0);
  expect(tracker.update(initial, true).characters).toBe(0);
  expect(tracker.update(update, true).characters).toBe(0);
  expect(tracker.update([block("past", "history"), ...update], true).characters).toBe(0);
  const restored = [...update, block("restored", "cached response")];
  expect(tracker.update(restored, true, [restored[2]]).characters).toBe(0);
  expect(tracker.update([...update, block("restored", "cached response!")], true).characters).toBe(1);
});

it("tracks new body text, one phase cue, one attention cue and completion once", () => {
  const tracker = new TranscriptHapticsTracker();
  const initial = [block("u", "question", "user")];
  tracker.update(initial, false);
  const thinking = [...initial, block("r", "thought", "reasoning")];
  expect(tracker.update(thinking, true).phase).toBe(true);
  expect(tracker.update([...initial, block("r", "thought grows", "reasoning")], true).phase).toBe(false);
  const text = [...thinking, block("a", "reply")];
  expect(tracker.update(text, true).characters).toBe(5);
  expect(tracker.update(text, true, [], "request-1").attention).toBe(true);
  expect(tracker.update(text, true, [], "request-1").attention).toBe(false);
  expect(tracker.update(text, false).finished).toBe(true);
  expect(tracker.update(text, false).finished).toBe(false);
});

it("does not announce historical completion or waiting for input as a finished reply", () => {
  const tracker = new TranscriptHapticsTracker();
  tracker.update([block("a", "historical")], true);
  expect(tracker.update([block("a", "historical")], false).finished).toBe(false);
  tracker.update([block("a", "historical"), block("b", "new")], true);
  expect(tracker.update([block("a", "historical"), block("b", "new")], false, [], "approval").finished).toBe(false);
});
