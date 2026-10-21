/** Wire-only references; provider events and durable Host transcripts stay complete. */
export const TOOL_CONTENT_CAPABILITY = "sessions.tool-content.v1";
export const TOOL_CONTENT_MODE = "tool-refs-v1";
export type ToolContentMode = typeof TOOL_CONTENT_MODE;
export const TOOL_CONTENT_FIELDS = ["output", "input", "detail", "previewOutput", "diff", "text", "title", "previewTitle", "query"] as const;
export type ToolContentField = typeof TOOL_CONTENT_FIELDS[number];
export type ToolContentRef = {
  sessionId: string;
  blockPath: string[];
  step?: boolean;
  version: string;
  fields: { name: ToolContentField; characters: number; bytes: number; aliasOf?: ToolContentField }[];
};
export type ToolContentRequest = {
  sessionId: string;
  blockPath: string[];
  field: ToolContentField;
  step?: boolean;
  version?: string;
  transfer?: string;
  /** UTF-16 offsets, always on Unicode code-point boundaries. */
  offset?: number;
  end?: number;
  tail?: boolean;
};
export type ToolContentPage = {
  sessionId: string; blockPath: string[]; field: ToolContentField;
  version: string; transfer: string; running?: boolean;
  start: number; end: number; total: number; text: string;
  /** Original diff row semantics for this range, including long-line fragments. */
  lines?: { number?: number; kind: "add" | "del" | "context"; text: string }[];
};
export type ToolContentSearchPage = {
  revision: number; ids: string[]; total: number; next?: number;
  hits?: Record<string, { field: ToolContentField; offset: number }>;
};
export type ToolContentSource = {
  /** Includes the execution environment and connection identity, never credentials. */
  key: readonly unknown[];
  read(request: ToolContentRequest, signal?: AbortSignal): Promise<ToolContentPage>;
  search?(query: string, offset: number, signal?: AbortSignal): Promise<ToolContentSearchPage>;
};

export type ToolContentSelection = { blockId: string; field: string; offset: number; query: string };
