import { useRef } from "react";
import { reuseEqualSummaries } from "../data/sessionHistory";
import type { SessionSummary } from "../data/sessionStore";

/** Streaming rebuilds summaries every frame; hand memoized lists the old rows. */
export function useStableSummaries(next: SessionSummary[]): SessionSummary[] {
  const previous = useRef<SessionSummary[] | undefined>(undefined);
  const rows = reuseEqualSummaries(previous.current, next);
  previous.current = rows;
  return rows;
}
