import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";

function draftStorage(hostKey: string) {
  const key = `monocode.assistant-draft:${hostKey}`;
  let saved = "";
  try {
    saved = localStorage.getItem(key) ?? "";
  } catch {
    /* The composer remains usable without persistent storage. */
  }
  let value = saved;
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (value === saved) return;
    try {
      localStorage.setItem(key, value);
      saved = value;
    } catch {
      /* Keep the latest draft in memory and retry when the surface leaves. */
    }
  };
  return {
    initial: saved,
    flush,
    activate(visible: boolean) {
      active = visible;
      if (!active) flush();
    },
    update(next: SetStateAction<string>) {
      value = typeof next === "function" ? next(value) : next;
      clearTimeout(timer);
      // A successful send clears its saved draft immediately. A late send
      // still owns this Host's storage after the user switches Hosts.
      if (!value || !active || document.visibilityState === "hidden") flush();
      else timer = setTimeout(flush, 300);
      return value;
    },
  };
}

/** Keep typing local while saving a Host's latest draft before leaving it. */
export function useBotDraft(hostKey: string) {
  const visible = useSurfaceVisibility();
  const storage = useMemo(() => draftStorage(hostKey), [hostKey]);
  const mounted = useRef(false);
  const owners = useRef(new Map<string, ReturnType<typeof draftStorage>>());
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useLayoutEffect(() => {
    owners.current.set(hostKey, storage);
  }, [hostKey, storage]);
  const [draft, setDraft] = useState(() => ({ storage, value: storage.initial }));
  // Load the new Host atomically, before rendering its composer or effects.
  // Pairing the value with its owner also rejects late setters from old sends.
  if (draft.storage !== storage) setDraft({ storage, value: storage.initial });
  const update = useCallback((next: SetStateAction<string>) => {
    // Returning to a Host creates a new draft owner. An older send may still
    // finish afterward, but must not clear text edited during that later visit.
    if (!mounted.current || owners.current.get(hostKey) !== storage) return;
    const value = storage.update(next);
    setDraft((current) => current.storage === storage ? { storage, value } : current);
  }, [hostKey, storage]);
  useEffect(() => {
    storage.activate(visible);
    const hidden = () => {
      if (document.visibilityState === "hidden") storage.flush();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", storage.flush);
    return () => {
      storage.activate(false);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", storage.flush);
    };
  }, [storage, visible]);
  return [draft.value, update] as const;
}
