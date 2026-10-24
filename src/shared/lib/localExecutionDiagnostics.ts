/** Migration diagnostics count attempted native calls, never transcript data. */
export type LocalExecutionCommand =
  | "harness_spawn"
  | "session_upsert"
  | "bind_harness_session";

export type LocalExecutionReason =
  | "host-not-ready"
  | "home-draft"
  | "inbox"
  | "restore-binding"
  | "utility"
  | "legacy-local";

export type LocalExecutionContext = {
  sessionId?: string;
  cwd?: string;
  reason?: LocalExecutionReason;
};

type ReasonResolver = (context: LocalExecutionContext) => LocalExecutionReason;
let resolveReason: ReasonResolver | undefined;
const counts = new Map<string, number>();
const sessionReasons = new Map<string, Array<{ reason: LocalExecutionReason }>>();

/** Scope an exception to its session lifetime; overlapping scopes clean up safely. */
export function setLocalExecutionReason(sessionId: string, reason: LocalExecutionReason): () => void {
  if (!import.meta.env?.DEV) return () => undefined;
  const marker = { reason };
  const scopes = sessionReasons.get(sessionId) ?? [];
  scopes.push(marker);
  sessionReasons.set(sessionId, scopes);
  return () => {
    const index = scopes.indexOf(marker);
    if (index < 0) return;
    scopes.splice(index, 1);
    if (scopes.length === 0) sessionReasons.delete(sessionId);
  };
}

/** The application supplies ownership context; this module has no store imports. */
export function configureLocalExecutionDiagnostics(resolver?: ReasonResolver): void {
  resolveReason = resolver;
}

export function recordLocalExecution(
  command: LocalExecutionCommand,
  context: LocalExecutionContext,
): void {
  // Host imports the same adapters outside Vite, where import.meta.env is absent.
  if (!import.meta.env?.DEV) return;
  const reason = context.reason
    ?? (context.sessionId ? sessionReasons.get(context.sessionId)?.at(-1)?.reason : undefined)
    ?? resolveReason?.(context)
    ?? (context.cwd === "~" ? "home-draft" : "legacy-local");
  const key = `${command}:${reason}`;
  const count = (counts.get(key) ?? 0) + 1;
  counts.set(key, count);
  console.info("[local-execution]", { command, reason, count });
}
