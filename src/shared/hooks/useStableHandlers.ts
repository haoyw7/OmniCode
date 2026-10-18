import { useInsertionEffect, useRef } from "react";

type Handler = (...args: never[]) => unknown;

/**
 * Returns `handlers` with every function swapped for a stable forwarder that
 * calls the latest one. Props built from inline callbacks otherwise change on
 * every render and defeat `memo` all the way down (a host session rebuilt its
 * whole transcript on each streamed update). Keys that are not functions,
 * including `undefined`, pass through unchanged, so presence checks still see
 * whether a handler is offered.
 */
export function useStableHandlers<T extends object>(handlers: T): T {
  const latest = useRef(handlers);
  const forwarders = useRef(new Map<PropertyKey, Handler>());
  // Forwarders run from events and effects. Insertion effects land before any
  // layout effect, so a child's layout effect already reaches this render's
  // handlers.
  useInsertionEffect(() => {
    latest.current = handlers;
  });
  const stable = { ...handlers };
  for (const key of Object.keys(handlers) as (keyof T)[]) {
    if (typeof handlers[key] !== "function") continue;
    let forward = forwarders.current.get(key);
    if (!forward) {
      forward = (...args: never[]) => {
        const current = latest.current[key];
        // A handler withdrawn since a child captured its forwarder is a no-op.
        return typeof current === "function"
          ? (current as Handler)(...args)
          : undefined;
      };
      forwarders.current.set(key, forward);
    }
    stable[key] = forward as T[keyof T];
  }
  return stable;
}
