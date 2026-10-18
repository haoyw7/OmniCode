import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { StoredCursorSubagentRun } from "../src/integrations/harness/providers/cursor/cursorStore";
import type { MachineTransport } from "./machine-io";

type Row = Record<string, unknown>;
type CursorDatabase = {
  get(sql: string, ...params: (string | number)[]): Promise<Row | undefined> | Row | undefined;
  all(sql: string, ...params: (string | number)[]): Promise<Row[]> | Row[];
  close(): void;
};
type CursorStores = {
  join(...parts: string[]): string;
  directories(path: string): Promise<string[]> | string[];
  open(path: string): CursorDatabase;
};

const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const dirs = (path: string): string[] => {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(path, entry.name));
  } catch {
    return [];
  }
};
const localStores: CursorStores = {
  join, directories: dirs,
  open(path) {
    const database = new DatabaseSync(path, { readOnly: true });
    database.exec("PRAGMA busy_timeout=100");
    return { get: (sql, ...params) => database.prepare(sql).get(...params),
      all: (sql, ...params) => database.prepare(sql).all(...params), close: () => database.close() };
  },
};

/** Keep provider parsing in the Host; WSL exposes only bounded, read-only SQL. */
export async function readWslCursorSubagents(args: Record<string, unknown>, rpc: MachineTransport): Promise<StoredCursorSubagentRun[]> {
  const { home } = await rpc.request<{ home: string }>("env.info");
  const query = async (path: string, sql: string, params: (string | number)[]) => {
    const rows = await rpc.request<Row[]>("db.query", { path, sql, params });
    return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) =>
      [key, value && typeof value === "object" && "$base64" in value ? Buffer.from(String(value.$base64), "base64") : value])));
  };
  return readCursorSubagents(args, posix.join(home, ".cursor"), {
    join: posix.join,
    async directories(path) {
      try { return (await rpc.request<{ isDirectory: boolean; path: string }[]>("fs.readdir", { path })).filter(entry => entry.isDirectory).map(entry => entry.path); }
      catch { return []; }
    },
    open: path => ({ get: async (sql, ...params) => (await query(path, sql, params))[0],
      all: (sql, ...params) => query(path, sql, params), close: () => {} }),
  });
}
const object = (value: unknown): Record<string, any> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined;
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value.map((part) => object(part)?.text ?? "").join("\n");
  return object(value)?.text ?? "";
}
function matches(stored: string, wanted: string): boolean {
  return (
    stored === wanted ||
    stored
      .split(/\s+/)
      .some((part) => part.length >= 8 && wanted.split(/\s+/).includes(part))
  );
}
function validate(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 1024 ||
    /[/\\\0]/.test(value)
  )
    throw new Error("Invalid Cursor id");
}

/** Require both the native parent and spawn identity; never pair by title. */
export async function readCursorSubagents(
  args: Record<string, unknown>,
  cursorDir = join(homedir(), ".cursor"),
  stores: CursorStores = localStores,
): Promise<StoredCursorSubagentRun[]> {
  validate(args.sessionId);
  if (!Array.isArray(args.toolCallIds) || args.toolCallIds.length > 256)
    throw new Error("Invalid Cursor tool ids");
  args.toolCallIds.forEach(validate);
  const ids = args.toolCallIds as string[];
  if (!ids.length) return [];
  const revisions = object(args.knownRevisions) ?? {};
  const runs: StoredCursorSubagentRun[] = [];
  const seen = new Set<string>();
  const roots = [
    stores.join(cursorDir, "acp-sessions"),
    ...await stores.directories(stores.join(cursorDir, "chats")),
  ];
  for (const root of roots)
    for (const directory of await stores.directories(root)) {
      const path = stores.join(directory, "store.db");
      let db: CursorDatabase | undefined;
      try {
        db = stores.open(path);
        const row = await db.get("SELECT value FROM meta WHERE key='0'");
        const raw = String(row?.value ?? "");
        if (!raw || raw.length > 64 * 1024) continue;
        const meta = JSON.parse(
          raw.startsWith("{") ? raw : Buffer.from(raw, "hex").toString("utf8"),
        );
        if (
          meta.subagentInfo?.parentAgentId !== args.sessionId ||
          typeof meta.agentId !== "string"
        )
          continue;
        const callId = ids.find(
          (id) =>
            typeof meta.subagentInfo.toolCallId === "string" &&
            matches(meta.subagentInfo.toolCallId, id),
        );
        if (!callId || seen.has(meta.agentId)) continue;
        seen.add(meta.agentId);
        const revision = String(
          (await db.get("SELECT COALESCE(MAX(rowid),0) AS revision FROM blobs"))!.revision,
        );
        if (revisions[meta.agentId] === revision) continue;
        const run: StoredCursorSubagentRun = {
          toolCallId: callId,
          agentId: meta.agentId,
          revision,
          agentType: meta.subagentInfo.typeName,
          steps: [],
        };
        const tools = new Map<
          string,
          StoredCursorSubagentRun["steps"][number]
        >();
        const results = new Map<string, { output: string; failed: boolean }>();
        let cursor = 0;
        while (true) {
          const batch = await db.all(
              "SELECT rowid, id, CASE WHEN length(data)<=? THEN data END AS data FROM blobs WHERE rowid>? AND substr(data,1,1)=x'7b' ORDER BY rowid LIMIT 256",
              MAX_MESSAGE_BYTES, cursor);
          if (!batch.length) break;
          for (const blob of batch) {
            cursor = Number(blob.rowid);
            if (!blob.data) {
              run.partial = true;
              continue;
            }
            let message: Record<string, any>;
            try {
              message = JSON.parse(
                Buffer.from(blob.data as Uint8Array).toString("utf8"),
              );
            } catch {
              run.partial = true;
              continue;
            }
            if (message.role === "assistant")
              run.model =
                message.providerOptions?.cursor?.systemPromptFingerprint
                  ?.model ?? run.model;
            if (message.role === "user" && !run.prompt) {
              const query = text(message.content).split("<user_query>")[1];
              if (query) run.prompt = query.split("</user_query>")[0].trim();
            }
            if (!Array.isArray(message.content)) continue;
            message.content.forEach(
              (part: Record<string, any>, index: number) => {
                if (
                  message.role === "assistant" &&
                  (part.type === "text" || part.type === "reasoning") &&
                  typeof part.text === "string"
                ) {
                  run.steps.push({
                    id: `${run.agentId}:${blob.id}:${index}`,
                    kind: part.type === "text" ? "message" : "reasoning",
                    text: part.text,
                  });
                } else if (
                  message.role === "assistant" &&
                  part.type === "tool-call" &&
                  typeof part.toolCallId === "string"
                ) {
                  if (tools.has(part.toolCallId)) return;
                  const step: StoredCursorSubagentRun["steps"][number] = {
                    id: `${run.agentId}:tool:${part.toolCallId}`,
                    kind: "tool",
                    text: "",
                    toolCallId: part.toolCallId,
                    toolName: part.toolName,
                    args: part.args,
                    status: "in_progress",
                  };
                  tools.set(part.toolCallId, step);
                  run.steps.push(step);
                } else if (
                  message.role === "tool" &&
                  part.type === "tool-result" &&
                  typeof part.toolCallId === "string"
                ) {
                  results.set(part.toolCallId, {
                    output: text(part.result),
                    failed: part.isError === true,
                  });
                }
              },
            );
          }
        }
        for (const [id, outcome] of results) {
          const step = tools.get(id);
          if (step) {
            step.status = outcome.failed ? "failed" : "completed";
            step.output = outcome.output;
          }
        }
        runs.push(run);
      } catch {
        /* Stores being initialized are retried by the provider poll. */
      } finally {
        db?.close();
      }
    }
  return runs;
}
