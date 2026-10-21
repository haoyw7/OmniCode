import { createStore } from "zustand/vanilla";
import { persist } from "zustand/middleware";

type StorageAdapter = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type PreferenceValue = { value: string | null; revision: number };

/** Persist keeps the existing raw keys/values: Host codecs and older windows share them. */
export function createPersistedPreferences(storage: StorageAdapter) {
  function createEntry(key: string) {
    let writing = 0;
    let retained = false;
    let pendingValue: string | null | undefined;
    let publishing = 0;
    let nextWrite = 0;
    let acceptedWrite = 0;
    const persistValue = (value: string | null) => {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    };
    const store = createStore<PreferenceValue>()(persist((): PreferenceValue => ({ value: null, revision: 0 }), {
      name: key,
      partialize: state => ({ value: state.value }),
      storage: {
        getItem: () => ({ state: { value: storage.getItem(key) } }),
        setItem: (_, { state }) => {
          if (publishing) return;
          persistValue(state.value);
        },
        removeItem: () => storage.removeItem(key),
      },
      merge: (saved, current) => {
        const value = (saved as Pick<PreferenceValue, "value"> | undefined)?.value ?? null;
        return value === current.value ? current : { value, revision: current.revision + 1 };
      },
    }));
    const refresh = (external = false, strict = false) => {
      if (writing) return;
      if (external) retained = false;
      if (retained) return;
      try {
        if (storage.getItem(key) !== store.getState().value) void store.persist.rehydrate();
      } catch (error) {
        if (strict) throw error;
        // Mounted observers retain their last readable value during a storage outage.
      }
    };
    const write = (value: string | null, retainOnError = false) => {
      refresh();
      const operation = ++nextWrite;
      const previousPending = pendingValue;
      writing++;
      pendingValue = value;
      const publish = () => {
        if (operation < acceptedWrite) return;
        acceptedWrite = operation;
        publishing++;
        try { store.setState(state => state.value === value ? state : { value, revision: state.revision + 1 }); }
        finally { publishing--; }
      };
      try {
        // Host edits must reach the durable journal before subscribers observe them.
        // The same persist adapter writes once; reentrant edits may already have won.
        try { persistValue(value); }
        catch (error) {
          pendingValue = previousPending;
          if (operation >= acceptedWrite) {
            retained = retainOnError;
            if (retained) publish();
          }
          throw error;
        }
        pendingValue = previousPending;
        if (operation < acceptedWrite) return;
        retained = false;
        publish();
      } finally {
        pendingValue = previousPending;
        writing--;
      }
    };
    return { store, refresh, write, read: () => pendingValue !== undefined && nextWrite > acceptedWrite ? pendingValue : store.getState().value };
  }
  // This registry owns store identities only; values and subscriptions live in Zustand.
  const entries = new Map<string, ReturnType<typeof createEntry>>();
  let eventTarget: Window | undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === null) for (const entry of entries.values()) entry.refresh(true);
    else entries.get(event.key)?.refresh(true);
  };
  const entryFor = (key: string) => {
    if (typeof window !== "undefined" && typeof window.addEventListener === "function" && eventTarget !== window) {
      eventTarget?.removeEventListener("storage", onStorage);
      eventTarget = window;
      eventTarget.addEventListener("storage", onStorage);
    }
    let entry = entries.get(key);
    if (!entry) { entry = createEntry(key); entries.set(key, entry); }
    return entry;
  };
  return {
    getItem(key: string) {
      const entry = entryFor(key);
      entry.refresh(false, true);
      return entry.read();
    },
    setItem(key: string, value: string, retainOnError = false) { entryFor(key).write(value, retainOnError); },
    removeItem(key: string) { entryFor(key).write(null); },
    store(key: string) {
      const entry = entryFor(key);
      entry.refresh();
      return entry.store as Pick<typeof entry.store, "getState" | "getInitialState" | "subscribe">;
    },
    subscribe(keys: readonly string[], listener: () => void) {
      const stops = [...new Set(keys)].map(key => {
        const entry = entryFor(key);
        entry.refresh();
        return entry.store.subscribe((next, previous) => {
          if (next.value !== previous.value) listener();
        });
      });
      return () => { for (const stop of stops) stop(); };
    },
    refresh(keys?: readonly string[]) {
      for (const key of keys ?? entries.keys()) entries.get(key)?.refresh(true);
    },
    dispose() {
      eventTarget?.removeEventListener("storage", onStorage);
      eventTarget = undefined;
      entries.clear();
    },
  };
}

/** Device-only preferences never enter the Host journal. */
export const devicePreferences = createPersistedPreferences({
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: key => localStorage.removeItem(key),
});

if (import.meta.hot) import.meta.hot.dispose(() => devicePreferences.dispose());
