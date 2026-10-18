/** Cached state is an offline fallback, never evidence for bypassing a rejected identity. */
export function hostStateTransportUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/unauthori[sz]ed|forbidden|authentication|identity|revoked|\b401\b|\b403\b|unsupported|update host/i.test(message)) return false;
  return /unreachable|offline|failed to fetch|fetch failed|network|timed?\s*out|timeout|connection (?:refused|reset)|load failed|error sending request/i.test(message);
}
