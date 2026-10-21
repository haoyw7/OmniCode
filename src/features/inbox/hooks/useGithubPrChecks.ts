import { useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { errorMessage } from "../../../shared/lib/errorMessage";
import { githubPrChecksQuery } from "../model/githubPrChecksQueries";
import type { GithubPrChecks } from "../model/githubPrChecks";

const POLL_MS = 30_000;

export type GithubPrChecksView = {
  checks: GithubPrChecks | null;
  /** Initial load: no results yet, so the view must not read as "no checks". */
  loading: boolean;
  /** Revalidation of already-shown results. */
  refreshing: boolean;
  error: string | null;
  /** Previous results stayed on screen after a failed refresh. */
  stale: boolean;
  refresh: () => void;
};

export function useGithubPrChecks(params: {
  cwd: string;
  repo: string;
  number: number;
  enabled: boolean;
  /** Open PRs poll; closed or merged ones load once and on demand. */
  open: boolean;
  poll?: boolean;
  revision?: number;
}): GithubPrChecksView {
  const { cwd, repo, number, enabled, open, poll = true, revision = 0 } = params;
  const query = useQuery({
    ...githubPrChecksQuery(cwd, repo, number),
    enabled,
    refetchInterval: () => enabled && open && poll && !document.hidden ? POLL_MS : false,
    refetchOnWindowFocus: false,
  }, queryClient);
  const { refetch } = query;
  // Manual/revision triggers during a read coalesce into one follow-up.
  // Query owns the request and results; this ticket only owns the trigger.
  const lifetime = useRef<{ active: boolean; queued: boolean }>({ active: false, queued: false });
  useEffect(() => {
    const ticket = { active: enabled, queued: false };
    lifetime.current = ticket;
    return () => { ticket.active = false; };
  }, [cwd, repo, number, enabled]);
  const refresh = useCallback(() => {
    const ticket = lifetime.current;
    if (!ticket.active || ticket.queued) return;
    const fetching = queryClient.getQueryState(githubPrChecksQuery(cwd, repo, number).queryKey)?.fetchStatus === "fetching";
    if (!fetching) { void refetch({ cancelRefetch: false }); return; }
    ticket.queued = true;
    void refetch({ cancelRefetch: false }).then(() => {
      ticket.queued = false;
      if (ticket.active) void refetch({ cancelRefetch: false });
    });
  }, [cwd, repo, number, refetch]);
  const previous = useRef({ cwd, repo, number, revision, poll });
  useEffect(() => {
    const last = previous.current;
    previous.current = { cwd, repo, number, revision, poll };
    if (last.cwd !== cwd || last.repo !== repo || last.number !== number || !enabled) return;
    if (last.revision !== revision || (!last.poll && poll && open && !document.hidden)) refresh();
  }, [cwd, repo, number, revision, poll, open, enabled, refresh]);
  useEffect(() => {
    if (!enabled || !open || !poll) return;
    const onVisibility = () => {
      if (!document.hidden) void refetch({ cancelRefetch: false });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [enabled, open, poll, refetch]);

  return {
    checks: enabled ? query.data ?? null : null,
    loading: enabled && query.isPending,
    refreshing: enabled && query.isFetching && query.data !== undefined,
    error: enabled ? errorMessage(query.error) ?? null : null,
    stale: enabled && query.isError && query.data !== undefined,
    refresh,
  };
}
