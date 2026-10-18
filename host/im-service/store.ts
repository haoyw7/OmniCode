import { randomUUID } from "node:crypto";
import type { BotScope } from "../../src/features/bots/model/bots";
import type { HostStore } from "../store";
import type { ImIncomingMessage } from "../im/core/types";
import type { RemoteAttachment } from "../../src/features/connections/model/protocol";

export type ImSettings = {
  bindingId: string;
  /** Default Bot/Thread target; journals retain their existing binding identity. */
  scope: BotScope;
  appId: string;
  appSecret: string;
  ownerOpenId: string;
  language: "en" | "zh-CN";
  enabled: boolean;
  activated: boolean;
  cursor: number;
};
export type InboxEntry = {
  id: string;
  bindingId: string;
  message: ImIncomingMessage;
  attachmentIds: string[];
  attachments: RemoteAttachment[];
  state: "pending" | "accepted" | "failed" | "discarded";
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  wakeupId?: string;
  error?: string;
};
export type OutboxEntry = {
  id: string;
  bindingId: string;
  key: string;
  text: string;
  attachment?: RemoteAttachment;
  assistantMessageId?: string;
  threadId?: string;
  replyToMessageId?: string;
  state: "pending" | "sending" | "sent" | "failed" | "unknown" | "discarded";
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  messageId?: string;
  error?: string;
};

/** IM journals share the Host transaction boundary, but contain no brain data. */
export class ImStore {
  constructor(readonly host: HostStore, readonly scope: BotScope) {
    host.db.exec(`
      CREATE TABLE IF NOT EXISTS im_settings (singleton INTEGER PRIMARY KEY CHECK(singleton=1), payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS im_inbox (id TEXT PRIMARY KEY, binding_id TEXT NOT NULL, message_id TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(binding_id,message_id));
      CREATE INDEX IF NOT EXISTS im_inbox_state ON im_inbox(binding_id,state);
      CREATE TABLE IF NOT EXISTS im_outbox (id TEXT PRIMARY KEY, binding_id TEXT NOT NULL, item_key TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(binding_id,item_key));
      CREATE INDEX IF NOT EXISTS im_outbox_state ON im_outbox(binding_id,state);
    `);
    // Upgrade metadata in place: no new binding, cursor reset or journal rewrite.
    const settings = this.settings();
    if (settings && !settings.scope)
      this.host.db.prepare("UPDATE im_settings SET payload=? WHERE singleton=1").run(JSON.stringify({ ...settings, scope }));
  }
  settings(): ImSettings | undefined {
    const row = this.host.db.prepare("SELECT payload FROM im_settings WHERE singleton=1").get();
    return row ? JSON.parse(String(row.payload)) : undefined;
  }
  configure(value: Omit<ImSettings, "scope"> & { scope?: BotScope }): void {
    this.host.transaction(() => {
      const old = this.settings();
      if (old && old.bindingId !== value.bindingId) {
        for (const entry of this.inbox(old.bindingId))
          if (entry.state === "pending" || entry.state === "failed") this.saveInbox({ ...entry, state: "discarded" });
        for (const entry of this.outbox(old.bindingId))
          if (!["sent", "discarded"].includes(entry.state)) this.saveOutbox({ ...entry, state: "discarded" });
      }
      this.host.db.prepare("INSERT INTO im_settings VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET payload=excluded.payload").run(JSON.stringify({ ...value, scope: this.scope }));
    });
  }
  receive(bindingId: string, message: ImIncomingMessage): InboxEntry {
    return this.host.transaction(() => {
      const old = this.host.db.prepare("SELECT payload FROM im_inbox WHERE binding_id=? AND message_id=?").get(bindingId, message.messageId);
      if (old) return JSON.parse(String(old.payload));
      const entry: InboxEntry = {
        id: randomUUID(), bindingId, message,
        attachmentIds: (message.attachments ?? []).map(() => randomUUID()),
        attachments: [], state: "pending", attempts: 0, nextAttemptAt: 0, createdAt: Date.now(),
      };
      this.host.db.prepare("INSERT INTO im_inbox VALUES(?,?,?,?,?)").run(entry.id, bindingId, message.messageId, entry.state, JSON.stringify(entry));
      return entry;
    });
  }
  inbox(bindingId: string, state?: InboxEntry["state"]): InboxEntry[] {
    const rows = state
      ? this.host.db.prepare("SELECT payload FROM im_inbox WHERE binding_id=? AND state=? ORDER BY rowid").all(bindingId, state)
      : this.host.db.prepare("SELECT payload FROM im_inbox WHERE binding_id=? ORDER BY rowid").all(bindingId);
    return rows.map(row => JSON.parse(String(row.payload)));
  }
  saveInbox(entry: InboxEntry): void {
    this.host.db.prepare("UPDATE im_inbox SET state=?,payload=? WHERE id=?").run(entry.state, JSON.stringify(entry), entry.id);
  }
  replyTo(bindingId: string, wakeupId: string): InboxEntry | undefined {
    // Accepted input count is small for a personal channel; the message body
    // stays out of separate indexes and is never exposed by im.get.
    return this.inbox(bindingId, "accepted").find(entry => entry.wakeupId === wakeupId);
  }
  enqueue(value: Omit<OutboxEntry, "id" | "state" | "attempts" | "nextAttemptAt" | "createdAt">): void {
    const entry: OutboxEntry = { ...value, id: randomUUID(), state: "pending", attempts: 0, nextAttemptAt: 0, createdAt: Date.now() };
    this.host.db.prepare("INSERT OR IGNORE INTO im_outbox VALUES(?,?,?,?,?)").run(entry.id, entry.bindingId, entry.key, entry.state, JSON.stringify(entry));
  }
  outbox(bindingId: string, state?: OutboxEntry["state"]): OutboxEntry[] {
    const rows = state
      ? this.host.db.prepare("SELECT payload FROM im_outbox WHERE binding_id=? AND state=? ORDER BY rowid").all(bindingId, state)
      : this.host.db.prepare("SELECT payload FROM im_outbox WHERE binding_id=? ORDER BY rowid").all(bindingId);
    return rows.map(row => JSON.parse(String(row.payload)));
  }
  saveOutbox(entry: OutboxEntry): void {
    this.host.db.prepare("UPDATE im_outbox SET state=?,payload=? WHERE id=?").run(entry.state, JSON.stringify(entry), entry.id);
  }
  recover(): void {
    const settings = this.settings();
    if (!settings) return;
    for (const entry of this.outbox(settings.bindingId, "sending"))
      this.saveOutbox({ ...entry, state: "unknown", error: "Host restarted before delivery was confirmed." });
  }
}
