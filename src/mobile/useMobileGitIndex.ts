import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../shared/lib/queryClient";
import { mobileSourceKey } from "./mobileQueries";
import type { GitDiffIndex } from "../platform/tauri/fs";
import type { MobileGitSource } from "./mobileGit";

export type MobileGitIndexState = { index: GitDiffIndex | null; loading: boolean; error: string | null; refresh: () => void };
export function useMobileGitIndex(source: MobileGitSource | undefined, enabled: boolean, running: boolean): MobileGitIndexState {
  const [hidden, setHidden] = useState(() => document.hidden);
  const queryKey = ["mobile", "gitIndex", source ? mobileSourceKey(source) : null] as const;
  const read = useQuery({ queryKey, enabled: !!source && enabled && !hidden,
    refetchInterval: enabled && !hidden ? running ? 5000 : 30000 : false,
    queryFn: ({ signal }) => { signal.throwIfAborted(); return source!.loadIndex(); },
  }, queryClient);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running && source && enabled && !hidden) void read.refetch({ cancelRefetch: false });
    wasRunning.current = running;
  }, [running, source, enabled, hidden, read.refetch]);
  useEffect(() => {
    const onVisibility = () => { setHidden(document.hidden); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [source, enabled, read.refetch]);
  useEffect(() => { if (!enabled || hidden) void queryClient.cancelQueries({ queryKey }); }, [source, enabled, hidden]);
  const refresh = useCallback(() => { if (source && enabled && !document.hidden) void read.refetch({ cancelRefetch: false }); }, [source, enabled, read.refetch]);
  return { index: read.data ?? null, loading: !!source && enabled && read.isFetching, error: read.error ? String(read.error instanceof Error ? read.error.message : read.error) : null, refresh };
}
