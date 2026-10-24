import type { CheckpointStatus } from "../src/contracts/checkpoint";
import type { Session } from "../src/contracts/session";
import type { HarnessEvent } from "../src/contracts/harness";
import type { HostStore } from "./store";
import type { HostProvider } from "./providers";

export type CheckpointRestoration<Prepared = unknown> = {
  phase: "prepared" | "provider-uncertain" | "provider-rewound" | "workspace-failed" | "completed";
  turnId: string;
  createdAt: number;
  before: Session;
  prepared: Prepared;
  providerEvents: HarnessEvent[];
  error?: string;
};

/** The SQLite journal survives a provider timeout or partial filesystem restore. */
export class CheckpointRestorations {
  constructor(private readonly store: HostStore) {}

  read<Prepared>(sessionId: string): CheckpointRestoration<Prepared> | undefined {
    const row = this.store.db.prepare("SELECT value FROM metadata WHERE key=?").get(`checkpoint-restore:${sessionId}`);
    return row ? JSON.parse(String(row.value)) as CheckpointRestoration<Prepared> : undefined;
  }

  write<Prepared>(sessionId: string, value: CheckpointRestoration<Prepared>): void {
    this.store.transaction(() => this.store.db.prepare("INSERT INTO metadata VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(`checkpoint-restore:${sessionId}`, JSON.stringify(value)));
  }

  /** Sessions with a journal, for startup recovery. */
  sessions(): string[] {
    return this.store.db.prepare("SELECT key FROM metadata WHERE key LIKE 'checkpoint-restore:%'").all()
      .map(row => String(row.key).slice("checkpoint-restore:".length));
  }

  /** A finished restoration needs no evidence; its transcript copy is dropped. */
  clear(sessionId: string): void {
    this.store.transaction(() => this.store.db.prepare("DELETE FROM metadata WHERE key=?").run(`checkpoint-restore:${sessionId}`));
  }

  pending(sessionId: string): boolean {
    const value = this.read(sessionId);
    return !!value && value.phase !== "completed";
  }
}

/** A latest checkpoint can only remove the matching, latest provider turn. */
export function checkpointUndoReason(session: Session, status: CheckpointStatus, provider: HostProvider): string | undefined {
  // OpenCode's session revert also rewrites files, so it is not a pure
  // conversation rollback; it and other providers without one are refused.
  if (!provider.checkpointRewind) return "This provider cannot safely roll back conversation history. Workspace files were not changed.";
  if (!session.providerSessionId) return "The provider conversation identity is unavailable. Workspace files were not changed.";
  if (status.undoUnavailableReason) return status.undoUnavailableReason;
  if (!status.turnId) return "This checkpoint has no verified conversation turn boundary. Workspace files were not changed.";
  const start = session.blocks.findIndex(block => block.role === "user" && block.checkpointTurnId === status.turnId);
  if (start < 0) return "This checkpoint has no verified conversation turn boundary. Workspace files were not changed.";
  const later = session.blocks.slice(start + 1).filter(block => block.role === "user");
  if (later.some(block => block.checkpointTurnId && block.checkpointTurnId !== status.turnId))
    return "Only the latest conversation turn can be restored. Workspace files were not changed.";
  if (session.harness === "codex" && !session.blocks[start].providerTurnId)
    return "The provider turn identity is unavailable. Workspace files were not changed.";
  if (session.harness !== "codex" && later.length)
    return "This provider cannot roll back a turn with follow-up messages. Workspace files were not changed.";
  // Undo all restores only this session's own files; external files are never
  // in scope, so only a non-undoable owned file blocks the turn.
  if (status.workspaceShared || status.files.some(file => !file.external && !file.undoable))
    return "The complete turn cannot be safely restored because its files changed outside this conversation.";
  return undefined;
}
