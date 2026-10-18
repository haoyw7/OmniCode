/** Optional v1 codes supplement the existing human-readable Host error. */
export function botErrorCode(error: unknown): string {
  if (error instanceof Error && "code" in error && error.code === "MEMORY_CONFLICT")
    return "MEMORY_CONFLICT";
  const message = error instanceof Error ? error.message : String(error);
  if (/unknown.outcome|before the operation result/i.test(message))
    return "unknown-outcome";
  if (/scope|another project|another Host|Wrong Host/i.test(message))
    return "scope-denied";
  if (/permission|revoked|unauthorized|private/i.test(message))
    return "permission-denied";
  if (
    /no longer pending|stale|request.*changed|generation changed/i.test(message)
  )
    return "stale-input";
  if (/already used|settings changed|conflict/i.test(message))
    return "conflict";
  if (/sqlite|storage|disk|database/i.test(message)) return "storage-failed";
  if (/inactive|paused|disabled/i.test(message)) return "paused";
  if (/wait for|running|busy|in use/i.test(message)) return "busy";
  if (
    /unsupported|unknown.*field|invalid|must be|expected an object/i.test(
      message,
    )
  )
    return "unsupported";
  return "unavailable";
}
