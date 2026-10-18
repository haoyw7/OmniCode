import type { HostSessionSummary } from "../features/connections/model/protocol";

export type ActivityEntry = {
  revision: number;
  read: number;
  reply: number;
  finished: string | null;
  input: string | null;
  /** An explicit sidebar action, independent of received-reply cursors. */
  manualUnread?: boolean;
};
export type ActivityState = {
  initialized: boolean;
  entries: Record<string, ActivityEntry>;
};
export type ActivityNotice = {
  session: HostSessionSummary;
  kind: "reply" | "input";
};

export class MobileActivity {
  constructor(
    readonly state: ActivityState = { initialized: false, entries: {} },
  ) {}

  observe(
    sessions: readonly HostSessionSummary[],
    visibleId?: string,
  ): ActivityNotice[] {
    const notices: ActivityNotice[] = [];
    const ids = new Set<string>();
    for (const session of sessions) {
      ids.add(session.id);
      let entry = this.state.entries[session.id];
      if (entry && entry.revision > session.revision) continue;
      if (session.archived) {
        this.markRead(session.id, session.revision);
        const archived = this.state.entries[session.id];
        archived.revision = Math.max(archived.revision, session.revision);
        archived.finished = session.lastCompletedRunId ?? archived.finished;
        archived.input = session.pendingInputKey ?? archived.input;
        continue;
      }
      const reply = session.lastReplyRevision ?? 0;
      if (!entry) {
        entry = this.state.entries[session.id] = {
          revision: session.revision,
          read: this.state.initialized ? 0 : session.revision,
          reply: 0,
          finished: null,
          input: null,
        };
        if (!this.state.initialized) {
          entry.finished = session.lastCompletedRunId ?? null;
          entry.input = session.pendingInputKey ?? null;
        }
      }
      entry.revision = session.revision;
      entry.reply = Math.max(entry.reply, reply);
      const finished = session.lastCompletedRunId ?? null;
      const input = session.pendingInputKey ?? null;
      const newFinish = !!finished && finished !== entry.finished;
      const newInput = !!input && input !== entry.input;
      if (finished) entry.finished = finished;
      if (input) entry.input = input;
      if (
        entry.reply > entry.read &&
        session.id !== visibleId &&
        (newFinish || newInput)
      )
        notices.push({ session, kind: newInput ? "input" : "reply" });
    }
    for (const id of Object.keys(this.state.entries))
      if (!ids.has(id)) delete this.state.entries[id];
    this.state.initialized = true;
    return notices;
  }

  markRead(
    id: string,
    revision: number,
    cursors?: { finished?: string | null; input?: string | null },
  ): void {
    const entry = this.state.entries[id];
    if (entry) {
      delete entry.manualUnread;
      if (revision >= entry.revision) {
        if (cursors?.finished) entry.finished = cursors.finished;
        if (cursors?.input) entry.input = cursors.input;
      }
      entry.revision = Math.max(entry.revision, revision);
      entry.read = Math.max(entry.read, revision);
    } else {
      this.state.entries[id] = {
        revision,
        read: revision,
        reply: 0,
        finished: cursors?.finished ?? null,
        input: cursors?.input ?? null,
      };
    }
  }

  markUnread(id: string, revision: number): void {
    if (!this.state.entries[id]) this.markRead(id, revision);
    this.state.entries[id].manualUnread = true;
  }

  manualUnreadIds(): string[] {
    return Object.keys(this.state.entries).filter(
      (id) => this.state.entries[id].manualUnread,
    );
  }

  unreadIds(): string[] {
    return Object.keys(this.state.entries).filter((id) => {
      const entry = this.state.entries[id];
      return !!entry.manualUnread || entry.reply > entry.read;
    });
  }
}

const key = (environmentId: string) =>
  `monocode.mobileActivity:${environmentId}`;
export function loadMobileActivity(environmentId: string): MobileActivity {
  try {
    const state = JSON.parse(
      localStorage.getItem(key(environmentId)) ?? "null",
    ) as ActivityState | null;
    if (
      state &&
      typeof state.initialized === "boolean" &&
      state.entries &&
      typeof state.entries === "object"
    ) {
      const valid: Record<string, ActivityEntry> = {};
      for (const [id, entry] of Object.entries(state.entries)) {
        if (
          entry &&
          [entry.revision, entry.read, entry.reply].every(
            (value) => Number.isSafeInteger(value) && value >= 0,
          ) &&
          (entry.finished === null || typeof entry.finished === "string") &&
          (entry.input === null || typeof entry.input === "string")
        )
          valid[id] = {
            ...entry,
            manualUnread: entry.manualUnread === true || undefined,
          };
      }
      return new MobileActivity({
        initialized: state.initialized,
        entries: valid,
      });
    }
  } catch {
    /* Storage failure keeps the current runtime usable. */
  }
  return new MobileActivity();
}
export function saveMobileActivity(
  environmentId: string,
  activity: MobileActivity,
): void {
  try {
    localStorage.setItem(key(environmentId), JSON.stringify(activity.state));
  } catch {
    /* Runtime state survives. */
  }
}
