import { sanitizeTitleState } from "../src/features/sessions/model/titlePolicy";
import { restoreContextBreakdown } from "../src/integrations/harness/core/contextUsage";
import { DatabaseSync } from "node:sqlite";
import { retainTurnOrigins } from "../src/features/sessions/model/turnOrigins";
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
import type { Block, Session } from "../src/features/sessions/model/session";
import { isRemoteProvider, type HostSession } from "../src/features/connections/model/protocol";
import { attachmentPath, MAX_REMOTE_ATTACHMENT_BYTES } from "./attachments";
import { migrateNativeLink } from "./native/migrate";
import type { HostStore } from "./store";

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
      if (
        store.db.prepare("SELECT 1 FROM metadata WHERE key=?").get(`desktop-retired:${sourceKey}:${reference.id}`) ||
        store.db.prepare("SELECT 1 FROM metadata WHERE key=?").get(marker)
      )
        continue;
      const row = source
        .prepare("SELECT * FROM sessions WHERE id=?")
        .get(reference.id)!;
      if (
        !isRemoteProvider(row.harness) ||
        typeof row.cwd !== "string" ||
        row.cwd === "~" ||
        row.cwd.startsWith("remote://") ||
        row.inbox_ask
      )
        continue;
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
          if (store.db.prepare("SELECT 1 FROM metadata WHERE key=?").get(marker))
            return;
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
          } else {
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
            .prepare("INSERT OR IGNORE INTO metadata VALUES (?, ?)")
            .run(marker, "1");
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
