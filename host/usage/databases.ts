import { DatabaseSync } from "node:sqlite";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { UsageRecord } from "../../src/integrations/harness/core/usage";
import { parseOpenCodeMessage } from "../../src/integrations/harness/providers/opencode/opencodeUsage";
import {
  blob,
  metadata,
  trajectoryTimestamp,
  usageCandidates,
  mergeAntigravityCandidates,
} from "../../src/integrations/harness/providers/antigravity/antigravityUsage";
import { fingerprint, usageFiles, yieldUsage } from "./files";

export class UsageDatabaseCache {
  private entries = new Map<
    string,
    { fingerprint: string; records: UsageRecord[] }
  >();

  async read(
    path: string,
    provider: "opencode" | "antigravity",
  ): Promise<UsageRecord[]> {
    const key = `${await fingerprint(path)}/${await fingerprint(`${path}-wal`).catch(() => "-")}`;
    const previous = this.entries.get(path);
    if (previous?.fingerprint === key) return previous.records;
    const db = new DatabaseSync(path, { readOnly: true });
    let records: UsageRecord[];
    try {
      db.exec("PRAGMA busy_timeout = 100; BEGIN");
      records =
        provider === "opencode"
          ? await readOpenCode(db)
          : await readAntigravity(
              db,
              basename(path, ".db"),
              (await stat(path)).mtimeMs,
            );
      db.exec("COMMIT");
    } finally {
      db.close();
    }
    const after = `${await fingerprint(path)}/${await fingerprint(`${path}-wal`).catch(() => "-")}`;
    if (after === key) this.entries.set(path, { fingerprint: key, records });
    return records;
  }
}
function tables(db: DatabaseSync) {
  return new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  );
}
async function* pages(db: DatabaseSync, query: string, count = 64) {
  let after = -Number.MAX_VALUE;
  while (true) {
    const rows = db.prepare(query).all(after, count);
    for (const row of rows) yield row;
    if (rows.length < count) return;
    after = Number(rows[rows.length - 1].row_id);
    await yieldUsage();
  }
}
async function readOpenCode(db: DatabaseSync): Promise<UsageRecord[]> {
  const names = tables(db),
    records: UsageRecord[] = [];
  if (!names.has("message") && !names.has("session_message"))
    throw new Error("Unsupported OpenCode history database");
  for (const table of ["message", "session_message"]) {
    if (!names.has(table)) continue;
    const columns = new Set(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => row.name),
    );
    const created = columns.has("time_created") ? "time_created" : "NULL";
    for await (const row of pages(
      db,
      `SELECT rowid AS row_id, id, session_id, data, ${created} AS created FROM ${table} WHERE rowid > ? ${table === "session_message" && columns.has("type") ? "AND type = 'assistant'" : ""} ORDER BY rowid LIMIT ?`,
    )) {
      const record = parseOpenCodeMessage(String(row.data), {
        id: String(row.id),
        sessionId: String(row.session_id),
        ...(typeof row.created === "number"
          ? { timestampMs: row.created }
          : {}),
      });
      if (record) records.push(record);
    }
  }
  return records;
}
async function readAntigravity(
  db: DatabaseSync,
  session: string,
  fallback: number,
): Promise<UsageRecord[]> {
  const names = tables(db);
  if (!names.has("gen_metadata") && !names.has("steps"))
    throw new Error("Unsupported Antigravity history database");
  const read = async (step: boolean) => {
    const entries: { idx: number; entry: ReturnType<typeof metadata> }[] = [];
    const table = step ? "steps" : "gen_metadata";
    if (!names.has(table)) return entries;
    for await (const row of pages(
      db,
      `SELECT rowid AS row_id, idx, ${step ? "metadata" : "data"} AS data FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ?`,
      step ? 64 : 1,
    )) {
      if (step && row.data === null) continue;
      if (typeof row.idx !== "number")
        throw new Error("Invalid Antigravity row");
      entries.push({ idx: row.idx, entry: metadata(blob(row.data), step) });
    }
    return entries.sort((a, b) => a.idx - b.idx);
  };
  const generations = await read(false),
    steps = await read(true);
  let timestamp: number | null = null;
  if (names.has("trajectory_metadata_blob"))
    for (const row of db
      .prepare("SELECT data FROM trajectory_metadata_blob")
      .all())
      timestamp ??= trajectoryTimestamp(blob(row.data));
  return mergeAntigravityCandidates(
    usageCandidates(session, generations, steps, timestamp, fallback),
  );
}

export async function scanUsageDatabase(
  root: string,
  provider: "opencode" | "antigravity",
  cache: UsageDatabaseCache,
) {
  const records: UsageRecord[] = [];
  let files = 0,
    failed = false;
  const accept =
    provider === "opencode"
      ? (name: string) =>
          /^opencode(?:-[\w-]+)?\.db$/.test(name) || name.endsWith(".json")
      : (name: string) => name.endsWith(".db");
  for await (const path of usageFiles(root, accept)) {
    // OpenCode JSON history is under storage/message; auth/config files never enter the parser.
    if (path.endsWith(".json") && !/[\\/]storage[\\/]message[\\/]/.test(path))
      continue;
    files++;
    try {
      if (path.endsWith(".db"))
        records.push(...(await cache.read(path, provider)));
      else {
        const record = parseOpenCodeMessage(await readFile(path, "utf8"), {
          id: basename(path, ".json"),
        });
        if (record) records.push(record);
      }
    } catch {
      failed = true;
    }
  }
  return { records, files, failed };
}
