import { useSyncExternalStore } from "react";

type Clock = {
  now: number;
  listeners: Set<() => void>;
  timer: number | undefined;
};

const clocks = new Map<number, Clock>();
let watchingVisibility = false;

function clockFor(intervalMs: number): Clock {
  let clock = clocks.get(intervalMs);
  if (!clock) {
    clock = { now: Date.now(), listeners: new Set(), timer: undefined };
    clocks.set(intervalMs, clock);
  }
  return clock;
}

function tick(clock: Clock) {
  clock.now = Date.now();
  for (const listener of clock.listeners) listener();
}

function start(intervalMs: number, clock: Clock) {
  if (clock.timer !== undefined || document.hidden) return;
  clock.timer = window.setInterval(() => tick(clock), intervalMs);
}

function stop(clock: Clock) {
  if (clock.timer === undefined) return;
  window.clearInterval(clock.timer);
  clock.timer = undefined;
}

/** A hidden window paints nothing; catch every clock up once it returns. */
function onVisibilityChange() {
  for (const [intervalMs, clock] of clocks) {
    if (clock.listeners.size === 0) continue;
    if (document.hidden) {
      stop(clock);
    } else {
      tick(clock);
      start(intervalMs, clock);
    }
  }
}

function subscribe(intervalMs: number, listener: () => void) {
  if (!watchingVisibility) {
    watchingVisibility = true;
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  const clock = clockFor(intervalMs);
  if (clock.listeners.size === 0) clock.now = Date.now();
  clock.listeners.add(listener);
  start(intervalMs, clock);
  return () => {
    clock.listeners.delete(listener);
    if (clock.listeners.size === 0) stop(clock);
  };
}

const idle = () => () => {};
const subscribers = new Map<number, (listener: () => void) => () => void>();

/** useSyncExternalStore resubscribes whenever `subscribe` changes identity. */
function subscriberFor(intervalMs: number) {
  let subscriber = subscribers.get(intervalMs);
  if (!subscriber) {
    subscriber = (listener) => subscribe(intervalMs, listener);
    subscribers.set(intervalMs, subscriber);
  }
  return subscriber;
}

/**
 * Wall-clock time shared by every caller with the same interval: one timer
 * per interval instead of one per component, paused while the window is
 * hidden. A disabled caller only reads the clock when it renders anyway.
 */
export function useNow(intervalMs: number, enabled = true): number {
  return useSyncExternalStore(
    enabled ? subscriberFor(intervalMs) : idle,
    () => {
      const clock = clockFor(intervalMs);
      // An idle clock is stale; refresh it at most once per interval so the
      // snapshot stays stable within a render.
      if (clock.timer === undefined && Date.now() - clock.now >= intervalMs) {
        clock.now = Date.now();
      }
      return clock.now;
    },
  );
}
