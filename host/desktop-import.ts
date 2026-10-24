import { sanitizeTitleState } from "../src/domain/titlePolicy";
import { restoreContextBreakdown } from "../src/integrations/harness/core/contextUsage";
import { DatabaseSync } from "node:sqlite";
import { retainTurnOrigins } from "../src/domain/turnOrigins";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  statSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Block, Session } from "../src/contracts/session";
import { isRemoteProvider } from "../src/contracts/provider";
import { type HostSession } from "../src/contracts/protocol";
import { attachmentPath, MAX_REMOTE_ATTACHMENT_BYTES } from "./attachments";
import { migrateNativeLink } from "./native/migrate";
import type { HostStore } from "./store";

type DesktopRow = Record<string, unknown>;
type ImportReceipt = { version: 2; fingerprint: string; sourceUpdatedAt: number };
export type DesktopImportAudit = { version: 2; rows: { id: string; fingerprint: string; sourceUpdatedAt: number }[] };

/** Sorted raw SQLite columns are also hashed by the native bootstrap. */
function rowFingerprint(row: DesktopRow): string {
  return createHash("sha256").update(JSON.stringify(Object.keys(row).sort().map(key => [key, row[key]]))).digest("hex");
}

function importableRow(row: DesktopRow): boolean {
  return typeof row.cwd === "string" && row.cwd !== "~" && !row.cwd.startsWith("remote://") && !row.inbox_ask;
}

function receipt(row: DesktopRow): string {
  return JSON.stringify({ version: 2, fingerprint: rowFingerprint(row), sourceUpdatedAt: Number(row.updated_at) } satisfies ImportReceipt);
}

function verifiedReceipt(raw: unknown, row: DesktopRow): boolean {
  if (typeof raw !== "string" || raw === "1") return false;
  let value: ImportReceipt;
  try { value = JSON.parse(raw); } catch { return false; }
  if (value.version !== 2 || value.fingerprint !== rowFingerprint(row) || value.sourceUpdatedAt !== Number(row.updated_at)) {
    throw new Error(`Desktop conversation changed after import: ${row.id}. The original database was preserved; resolve the import conflict before retrying.`);
  }
  return true;
}

/** Older receipts lack a source revision. Only upgrade when the whole source
 * transcript is demonstrably retained, including copied attachment identity. */
function sourceTranscriptRetained(store: HostStore, sourceKey: string, row: DesktopRow, value: HostSession): boolean {
  if (Number(row.updated_at) > value.updatedAt) return false;
  const blocks = JSON.parse(String(row.blocks_json ?? "[]")) as Block[];
  if (!Array.isArray(blocks)) return false;
  for (const block of blocks) {
    const copied = (originalId: string) => {
      const key = `desktop-file:${sourceKey}:${row.id}:${createHash("sha256").update(originalId).digest("hex")}`;
      const entry = store.db.prepare("SELECT value FROM metadata WHERE key=?").get(key);
      if (!entry) return undefined;
      const id = String(entry.value);
      const path = attachmentPath(store, id);
      return existsSync(path) ? { id, path, size: statSync(path).size } : undefined;
    };
    for (const file of block.attachments ?? []) {
      const entry = copied(file.id);
      if (!entry) return false;
      Object.assign(file, entry);
      delete file.previewUrl;
      delete file.data;
      if (block.image) block.image.path = entry.path;
    }
    if (block.image && !block.attachments?.length) {
      const originalPath = block.image.path;
      const entry = copied(originalPath);
      if (!entry) return false;
      block.image.path = entry.path;
      block.attachments = [{ ...entry, name: basename(originalPath), kind: "image", mimeType: block.image.mimeType }];
    }
  }
  const canonical = retainTurnOrigins([], blocks);
  return isDeepStrictEqual(canonical, retainTurnOrigins([], value.session.blocks.slice(0, blocks.length)));
}

/** Includes ignored/retired rows so the native side can detect every concurrent
 * source mutation. No transcript bytes leave the bootstrap in this manifest. */
export function desktopImportAudit(store: HostStore, path: string): DesktopImportAudit {
  if (!existsSync(path)) return { version: 2, rows: [] };
  const sourceKey = createHash("sha256").update(resolve(path)).digest("hex");
  const source = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = source.prepare("SELECT * FROM sessions ORDER BY id").all();
    for (const row of rows) {
      if (!importableRow(row) || store.db.prepare("SELECT 1 FROM metadata WHERE key=?").get(`desktop-retired:${sourceKey}:${row.id}`)) continue;
      const imported = store.db.prepare("SELECT value FROM metadata WHERE key=?").get(`desktop-import:${sourceKey}:${row.id}`);
      if (!verifiedReceipt(imported?.value, row)) throw new Error(`Desktop conversation import is not verified: ${row.id}`);
    }
    return { version: 2, rows: rows.map(row => ({ id: String(row.id), fingerprint: rowFingerprint(row), sourceUpdatedAt: Number(row.updated_at) })) };
  } finally { source.close(); }
}

/** Import once per source row, including a tombstone after Host deletion.
 * Never modify the source or replace an existing canonical conversation. */
export function importDesktopSessions(
  store: HostStore,
  path: string,
): number {
  if (!existsSync(path)) return 0;
  const sourceKey = createHash("sha256").update(resolve(path)).digest("hex");
  const source = new DatabaseSync(path, { readOnly: true });
  let imported = 0;
  try {
    const rows = source.prepare("SELECT id, cwd, harness FROM sessions").all();
    for (const reference of rows) {
      const marker = `desktop-import:${sourceKey}:${reference.id}`;
      if (store.db.prepare("SELECT 1 FROM metadata WHERE key=?").get(`desktop-retired:${sourceKey}:${reference.id}`))
        continue;
      const row = source
        .prepare("SELECT * FROM sessions WHERE id=?")
        .get(reference.id)!;
      if (!importableRow(row)) continue;
      if (!isRemoteProvider(row.harness) || typeof row.cwd !== "string")
        throw new Error(`Desktop conversation cannot be imported: ${row.id}`);
      const priorReceipt = store.db.prepare("SELECT value FROM metadata WHERE key=?").get(marker);
      if (verifiedReceipt(priorReceipt?.value, row)) continue;
      const id = String(row.id);
      const cwd = existsSync(row.cwd) ? realpathSync(row.cwd) : row.cwd;
      const harness = row.harness;
      const nativeSession = row.native_session_json
        ? (JSON.parse(
            String(row.native_session_json),
          ) as Session["nativeSession"])
        : undefined;
      if (
        nativeSession &&
        (nativeSession.provider !== harness ||
          nativeSession.providerSessionId !== row.provider_session_id)
      )
        throw new Error("Native session binding changed");
      const copied: string[] = [];
      try {
        store.transaction(() => {
          const currentReceipt = store.db.prepare("SELECT value FROM metadata WHERE key=?").get(marker);
          if (verifiedReceipt(currentReceipt?.value, row)) return;
          const existing = store.db
            .prepare("SELECT snapshot FROM sessions WHERE id=?")
            .get(id);
          if (existing) {
            const value = JSON.parse(String(existing.snapshot)) as HostSession;
            if (
              value.session.harness !== harness ||
              store.project(value.projectId).cwd !== cwd
            )
              throw new Error(
                `Conversation ID collision while importing ${id}`,
              );
            if (!sourceTranscriptRetained(store, sourceKey, row, value))
              throw new Error(`Desktop conversation import conflicts with Host history: ${id}. Neither history was overwritten.`);
          } else {
            if (currentReceipt)
              throw new Error(`Deleted desktop conversation has an unverified legacy import: ${id}. The deletion and source database were preserved.`);
            const copy = (
              originalPath: string | undefined,
              originalId: string,
            ) => {
              const key = `desktop-file:${sourceKey}:${id}:${createHash("sha256").update(originalId).digest("hex")}`;
              const cached = store.db
                .prepare("SELECT value FROM metadata WHERE key=?")
                .get(key);
              if (cached) {
                const path = attachmentPath(store, String(cached.value));
                if (existsSync(path))
                  return {
                    id: String(cached.value),
                    path,
                    size: statSync(path).size,
                  };
              }
              if (!originalPath || !existsSync(originalPath))
                throw new Error(
                  `Cannot import missing image or attachment: ${originalPath}`,
                );
              const size = statSync(originalPath).size;
              if (size > MAX_REMOTE_ATTACHMENT_BYTES)
                throw new Error("Attachment is too large to import");
              const attachmentId = randomUUID();
              const path = attachmentPath(store, attachmentId);
              mkdirSync(store.attachmentDir, { recursive: true, mode: 0o700 });
              copyFileSync(originalPath, path);
              copied.push(path);
              store.db
                .prepare("INSERT OR REPLACE INTO metadata VALUES (?, ?)")
                .run(key, attachmentId);
              return { id: attachmentId, path, size };
            };
            const blocks = JSON.parse(
              String(row.blocks_json ?? "[]"),
            ) as Block[];
            if (!Array.isArray(blocks))
              throw new Error(`Invalid transcript for ${id}`);
            for (const block of blocks) {
              for (const file of block.attachments ?? []) {
                const copiedFile = copy(file.path, file.id);
                Object.assign(file, copiedFile);
                // Device-specific preview URLs are rebuilt from Host bytes.
                delete file.previewUrl;
                delete file.data;
                if (block.image) block.image.path = copiedFile.path;
              }
              if (block.image && !block.attachments?.length) {
                const imagePath = block.image.path;
                const file = copy(imagePath, imagePath);
                block.image.path = file.path;
                block.attachments = [
                  {
                    ...file,
                    name: basename(imagePath),
                    kind: "image",
                    mimeType: block.image.mimeType,
                  },
                ];
              }
            }
            const project = store.addProject(cwd, basename(cwd) || cwd);
            // Read either database generation; never write the legacy column back.
            const executionPath = String(row.execution_cwd || row.worktree_cwd || cwd);
            const session: Session = {
              id,
              cwd:
                existsSync(executionPath) ? realpathSync(executionPath) : executionPath,
              executionCwd: existsSync(executionPath) ? realpathSync(executionPath) : executionPath,
              harness,
              title: String(row.title),
              titleState: row.title_state_json ? sanitizeTitleState(JSON.parse(String(row.title_state_json))) : undefined,
              model: String(row.model),
              modelSettings: JSON.parse(String(row.model_settings ?? "{}")),
              runtimeMode: row.runtime_mode as Session["runtimeMode"],
              // Desktop rows never carry trusted turn origins.
              blocks: retainTurnOrigins([], blocks),
              busy: false,
              nativeSession,
              providerSessionId: row.provider_session_id
                ? String(row.provider_session_id)
                : undefined,
              providerAccountId: row.provider_account_id
                ? String(row.provider_account_id)
                : undefined,
              branch: row.branch ? String(row.branch) : undefined,
              worktreeRemoved: !!row.worktree_removed,
              linkedWorkItem: row.linked_work_item_json
                ? JSON.parse(String(row.linked_work_item_json))
                : undefined,
              automationId: row.automation_id
                ? String(row.automation_id)
                : undefined,
              ...(row.context_used != null
                ? {
                    context: {
                      used: Number(row.context_used),
                      ...(row.context_breakdown_json ? { breakdown: restoreContextBreakdown(JSON.parse(String(row.context_breakdown_json))) } : {}),
                      ...(row.context_window != null
                        ? { window: Number(row.context_window) }
                        : {}),
                    },
                  }
                : {}),
            };
            const value: HostSession = {
              session,
              projectId: project.id,
              revision: 1,
              status: "idle",
              createdAt: Number(row.created_at),
              updatedAt: Number(row.updated_at),
              archived: !!row.archived,
              pinned: !!row.pinned,
            };
            // Imported native links are Host-managed from the start.
            store.save(migrateNativeLink(value) ?? value, { type: "desktop.import" });
            imported++;
          }
          store.db
            .prepare("INSERT OR REPLACE INTO metadata VALUES (?, ?)")
            .run(marker, receipt(row));
        });
      } catch (error) {
        for (const file of copied) {
          try {
            unlinkSync(file);
          } catch {
            /* Keep the import error. */
          }
        }
        throw error;
      }
    }
    return imported;
  } finally {
    source.close();
  }
}
