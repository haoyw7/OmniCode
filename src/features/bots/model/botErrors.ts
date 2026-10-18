const UNSUPPORTED =
  "This OmniCode version cannot reach the assistant on this Host. Update OmniCode and try again.";
const UNREACHABLE = "Cannot reach the Host. Check the connection and retry.";

/** Maps transport failures to readable app text; other errors keep their source text. */
export function botErrorMessage(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error)).trim();
  if (/unsupported remote operation|unsupported assistant control/i.test(raw)) return UNSUPPORTED;
  if (
    /machine is (no longer connected|unreachable)|failed to fetch|networkerror|econnrefused|timed? ?out/i.test(
      raw,
    )
  )
    return UNREACHABLE;
  return raw || "Something went wrong.";
}
