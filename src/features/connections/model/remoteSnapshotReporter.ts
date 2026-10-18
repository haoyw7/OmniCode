import type { HostSession } from "./protocol";
import type { Block } from "../../sessions/model/session";

function metadata(value: HostSession): string {
  return JSON.stringify({
    ...value,
    revision: undefined, updatedAt: undefined, lastReplyRevision: undefined,
    blockRevisions: undefined, clockOffsetMs: undefined,
    session: { ...value.session, blocks: undefined, context: undefined, updatedAt: undefined },
  });
}

function blockMetadata(block: Block): string {
  return JSON.stringify({ ...block, text: undefined, sentAt: undefined, turnMetrics: undefined });
}

/** Only live prose and usage may lag in the workspace's copy. The pane owns live text. */
export function canCoalesceRemoteSnapshot(previous: HostSession, next: HostSession): boolean {
  if (!next.session.busy || metadata(previous) !== metadata(next)) return false;
  const before = previous.session.blocks;
  const after = next.session.blocks;
  if (before.length !== after.length) return false;
  return after.every((block, index) => {
    const old = before[index];
    if (block === old) return true;
    if (block.id !== old.id || blockMetadata(block) !== blockMetadata(old)) return false;
    return block.text === old.text ||
      ((block.role === "assistant" || block.role === "reasoning") && block.streaming === true);
  });
}

/** Avoid rerendering the whole workspace for every streamed text batch. */
export class RemoteSnapshotReporter {
  private reported?: HostSession;
  private pending?: HostSession;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly report: (snapshot: HostSession) => void) {}

  update(value: HostSession | undefined): void {
    if (!value) { this.dispose(); this.reported = undefined; return; }
    if (value === this.reported) return;
    this.pending = value;
    if (!this.reported || !canCoalesceRemoteSnapshot(this.reported, value)) this.flush();
    else this.timer ??= setTimeout(() => this.flush(), 500);
  }

  private flush(): void {
    const value = this.pending;
    this.dispose();
    if (!value) return;
    this.reported = value;
    this.report(value);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }
}
