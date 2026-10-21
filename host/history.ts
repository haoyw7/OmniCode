import { HISTORY_MODE, type HistoryRequest, type HistoryWindow } from "../src/integrations/harness/core/history";
import { TOOL_CONTENT_MODE } from "../src/integrations/harness/core/toolContent";
import { ToolContentService, type ToolContentSnapshot } from "./tool-content";

export const HISTORY_ROWS = 75;
export const HISTORY_BYTES = 1024 * 1024;
type Snapshot = ToolContentSnapshot & { blockRevisions?: Record<string, number> };

type HistorySync<T extends Snapshot> = { contentMode: typeof TOOL_CONTENT_MODE; history: HistoryWindow; historyBase?: string } & (
  { kind: "unchanged"; revision: number } |
  { kind: "snapshot"; value: Omit<T, "session" | "blockRevisions"> & { session: T["session"]; history: HistoryWindow; contentMode: typeof TOOL_CONTENT_MODE } } |
  { kind: "delta"; base: number; blockIds: string[]; blocks: T["session"]["blocks"];
    value: Omit<T, "session" | "blockRevisions"> & { session: Omit<T["session"], "blocks">; history: HistoryWindow; contentMode: typeof TOOL_CONTENT_MODE } }
);

/** Stateless windows: block identities survive appends; a removed boundary resets to the tail. */
export class HistoryService {
  constructor(private readonly content: ToolContentService) {}

  sync<T extends Snapshot>(stored: T, revision: number | undefined, input: unknown): HistorySync<T> {
    const request = input as HistoryRequest;
    if (!request || request.mode !== HISTORY_MODE ||
      (request.start !== undefined && typeof request.start !== "string") ||
      (request.before !== undefined && (typeof request.before !== "string" || request.before !== request.start)))
      throw new Error("Invalid history cursor");
    const rows = stored.session.blocks;
    const oldStart = request.start === undefined ? -1 : rows.findIndex(row => row.id === request.start);
    const project = (blocks: T["session"]["blocks"]) => this.content.project({ kind: "snapshot" as const,
      value: { ...stored, session: { ...stored.session, blocks } } }).value.session.blocks as T["session"]["blocks"];
    const pageStart = (end: number) => {
      // Reserve room for envelope metadata. A single oversized row is kept whole
      // and uses the existing bounded transfer protocol, never silently truncated.
      let start = end, bytes = 0;
      while (start > 0 && end - start < HISTORY_ROWS) {
        const size = Buffer.byteLength(JSON.stringify(project([rows[start - 1]])));
        if (start < end && bytes + size > HISTORY_BYTES - 64 * 1024) break;
        start--; bytes += size;
      }
      return start;
    };
    let start = oldStart < 0 ? pageStart(rows.length) : request.before !== undefined ? pageStart(oldStart) : oldStart;
    // Actionable approvals and active background work must remain visible even when an unusually long live
    // turn exceeds the normal cold-start window. This is an explicit budget exception.
    const actionable = rows.findIndex(row => (row.approval && !row.approval.decided) ||
      ((row.tool?.background || row.agentRun) && ["pending", "running", "in_progress"].includes(row.tool?.status?.toLowerCase() ?? "")));
    if (actionable >= 0) start = Math.min(start, actionable);
    const history: HistoryWindow = { mode: HISTORY_MODE, start: rows[start]?.id, hasMore: start > 0 };
    const { blockRevisions, session: _session, ...metadata } = stored;
    const session: T["session"] = stored.session;
    const validBase = oldStart >= 0 && revision !== undefined && revision <= stored.revision && !!blockRevisions;
    if (validBase && revision === stored.revision && start === oldStart)
      return { kind: "unchanged" as const, revision: stored.revision, contentMode: TOOL_CONTENT_MODE, history };
    if (validBase) {
      const { blocks: _blocks, ...fields } = session;
      return { kind: "delta" as const, base: revision!, historyBase: request.start, contentMode: TOOL_CONTENT_MODE, history,
        value: { ...metadata, contentMode: TOOL_CONTENT_MODE, history, session: fields },
        blockIds: rows.slice(start).map(row => row.id),
        blocks: project(rows.slice(start).filter((row, index) => start + index < oldStart || (blockRevisions![row.id] ?? Infinity) > revision!)),
      };
    }
    return { kind: "snapshot" as const, contentMode: TOOL_CONTENT_MODE, history,
      value: { ...metadata, contentMode: TOOL_CONTENT_MODE, history, session: { ...session, blocks: project(rows.slice(start)) } } };
  }
}
