import type { HostSessionSummary } from "../../connections/model/protocol";

type Entry = {
  revision: number;
  reply: number;
  completed?: string | null;
  status: HostSessionSummary["status"];
  unread: boolean;
};

/** One Host project's reply cursors, independent of which rows are mounted. */
export class RemoteSessionUnread {
  private initialized = false;
  private entries = new Map<string, Entry>();

  observe(
    sessions: readonly HostSessionSummary[],
    focusedId?: string,
  ): Set<string> {
    const present = new Set<string>();
    const unread = new Set<string>();
    for (const session of sessions) {
      present.add(session.id);
      const previous = this.entries.get(session.id);
      const revision = session.revision ?? 0;
      const reply = session.lastReplyRevision ?? 0;
      const excluded =
        session.archived ||
        session.orchestrationLeadId ||
        session.workflowParentId ||
        session.assistantOwnerId;
      const entry =
        previous && revision < previous.revision
          ? previous
          : {
              revision,
              reply: Math.max(previous?.reply ?? 0, reply),
              completed: session.lastCompletedRunId,
              status: session.status,
              unread:
                !!previous?.unread ||
                (previous
                  ? reply > previous.reply ||
                    (!!session.lastCompletedRunId &&
                      session.lastCompletedRunId !== previous.completed) ||
                    (previous.status === "running" &&
                      session.status !== "running")
                  : this.initialized && reply > 0),
            };
      if (session.id === focusedId || excluded) entry.unread = false;
      this.entries.set(session.id, entry);
      if (entry.unread) unread.add(session.id);
    }
    for (const id of this.entries.keys()) {
      if (!present.has(id)) this.entries.delete(id);
    }
    this.initialized = true;
    return unread;
  }
}
