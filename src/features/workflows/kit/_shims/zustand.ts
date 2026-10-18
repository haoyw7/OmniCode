// A minimal zustand-compatible `create` (selector hooks over a module store), so
// ZCode's saved-workflow store ports without adding a state library.
import { useSyncExternalStore } from "react";

type SetState<T> = (partial: Partial<T> | ((state: T) => Partial<T>)) => void;

export function create<T>(initializer: (set: SetState<T>, get: () => T) => T) {
  let state: T;
  const listeners = new Set<() => void>();
  const set: SetState<T> = (partial) => {
    const next = typeof partial === "function" ? (partial as (state: T) => Partial<T>)(state) : partial;
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  state = initializer(set, () => state);
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
  function useStore<U>(selector: (state: T) => U): U {
    return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
  }
  return Object.assign(useStore, { getState: () => state, setState: set, subscribe });
}
