import { useCallback, useEffect, useRef, useState } from "react";
import type { GitDiffIndex } from "../platform/tauri/fs";
import type { MobileGitSource } from "./mobileGit";

export type MobileGitIndexState = {
  index: GitDiffIndex | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

/** Poll only the visible working copy; streaming tokens never restart a read. */
export function useMobileGitIndex(
  source: MobileGitSource | undefined,
  enabled: boolean,
  running: boolean,
): MobileGitIndexState {
  const [state, setState] = useState<{
    source?: MobileGitSource;
    index: GitDiffIndex | null;
    loading: boolean;
    error: string | null;
  }>({ index: null, loading: false, error: null });
  const refreshRef = useRef<(() => void) | undefined>(undefined);
  const refresh = useCallback(() => refreshRef.current?.(), []);
  useEffect(() => {
    if (!source || !enabled) return;
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (stopped || inFlight || document.hidden) return;
      clearTimeout(timer);
      inFlight = true;
      setState((previous) => ({
        source,
        index: previous.source === source ? previous.index : null,
        loading: true,
        error: null,
      }));
      try {
        const index = await source.loadIndex();
        if (!stopped) setState({ source, index, loading: false, error: null });
      } catch (problem) {
        if (!stopped)
          setState((previous) => ({
            ...previous,
            loading: false,
            error: problem instanceof Error ? problem.message : String(problem),
          }));
      } finally {
        inFlight = false;
        if (!stopped && !document.hidden)
          timer = setTimeout(load, running ? 5_000 : 30_000);
      }
    };
    const onVisibility = () => {
      clearTimeout(timer);
      if (!document.hidden) void load();
    };
    refreshRef.current = () => {
      void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
      refreshRef.current = undefined;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [source, enabled, running]);
  // A new Host/session must never flash the previous directory's counts.
  return {
    index: state.source === source ? state.index : null,
    loading: !!source && enabled && (state.source !== source || state.loading),
    error: state.source === source ? state.error : null,
    refresh,
  };
}
