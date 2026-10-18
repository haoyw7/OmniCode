import type { HarnessId } from "../../../features/sessions/model/session";

export type SessionAccessIssue = "occupied" | "unavailable";

/** Provider ownership errors only: ordinary turn/auth/database busy errors are distinct. */
export function providerSessionAccessIssue(
  harness: HarnessId,
  error: unknown,
): SessionAccessIssue | undefined {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (!message) return undefined;
  if (message === "Native session is in use by another MonoCode instance")
    return "occupied";
  if (
    message ===
    "Native session is open in another CLI or its ownership is unknown"
  )
    return "unavailable";
  switch (harness) {
    case "codex":
      if (
        /\bthread\b[^\n]{0,180}\balready has an active writer\b/i.test(message)
      )
        return "occupied";
      break;
    case "claude":
      if (
        /\b(?:conversation|session(?: id)?)\b[^\n]{0,180}\b(?:already open|is open|already in use)\b[^\n]{0,120}\b(?:another|elsewhere)\b/i.test(
          message,
        ) ||
        /\bsession\b[^\n]{0,180}\brunning in another terminal\b/i.test(message)
      )
        return "occupied";
      break;
    case "omp":
      if (
        /another writer holds the publish lock|open in another omp process/i.test(
          message,
        )
      )
        return "occupied";
      if (
        /\bSessionLockError\b|Session publish lock unavailable for/i.test(
          message,
        )
      )
        return "unavailable";
      break;
    case "fx":
      if (/\bthis session is open in another fx\b/i.test(message))
        return "occupied";
      // fx uses this load/resume error for a contended session.lock; it does not identify its owner.
      if (
        /^(?:Error:\s*)?(?:Session is busy|SessionBusy)[.!]?$/i.test(
          message.trim(),
        ) ||
        /\bSessionLockUnsupported\b|session is busy or the filesystem cannot provide the required lock/i.test(
          message,
        )
      )
        return "unavailable";
      break;
    case "hermes":
      if (
        /\bSESSION_NOT_OWNED\b|\bthis chat is open in another Hermes window\/terminal\b|\bsession\b[^\n]{0,180}\balready has a live owner\b/i.test(
          message,
        )
      )
        return "occupied";
      if (
        /\bSESSION_COORDINATION_UNAVAILABLE\b|Hermes could not read the active-session registry/i.test(
          message,
        )
      )
        return "unavailable";
      break;
    case "cursor":
      if (
        /\bchat\b[^\n]{0,180}\balready running in persistent session\b/i.test(
          message,
        )
      )
        return "occupied";
      break;
  }
  return undefined;
}
