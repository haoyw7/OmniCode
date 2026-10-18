import { usefulNativeTitle } from "../../../features/sessions/model/titlePolicy";

/** Read Claude title metadata from rows already decoded by a transcript parser. */
export function claudeNativeTitleFromRows(
  rows: Iterable<Record<string, unknown>>,
  sessionId: string,
): string | null {
  let title: string | null = null;
  let manual: string | null = null;
  for (const row of rows) {
    if (row.sessionId !== sessionId) continue;
    if (row.type === "ai-title")
      title = usefulNativeTitle(row.aiTitle, sessionId) ?? title;
    if (row.type === "custom-title" && typeof row.customTitle === "string")
      manual = usefulNativeTitle(row.customTitle, sessionId);
  }
  return manual ?? title;
}

export function parseClaudeNativeTitle(
  content: string,
  sessionId: string,
): string | null {
  function* rows(): Iterable<Record<string, unknown>> {
    for (const line of content.split("\n")) {
      try {
        const row: unknown = JSON.parse(line);
        if (row && typeof row === "object" && !Array.isArray(row))
          yield row as Record<string, unknown>;
      } catch {
        /* Incomplete writes do not discard the last complete title. */
      }
    }
  }
  return claudeNativeTitleFromRows(rows(), sessionId);
}
