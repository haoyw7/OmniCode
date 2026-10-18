import { createHash, randomUUID } from "node:crypto";
import { botNotificationActivity } from "../../../src/features/bots/model/botNotifications";
import { followSession } from "../../../src/features/bots/model/botSessions";
import type { HostStore } from "../../store";
import { BotStore } from "../store";
import { FileMemoryService } from "../memory";
import type { BotScope } from "../../../src/features/bots/model/bots";
import {
  type BotAction,
  type BotHistory,
  type BotHistoryCursor,
  type BotMessage,
  type BotMessages,
  type BotPatch,
  type BotReceipt,
  type BotConfiguration,
} from "../../../src/features/bots/model/botView";
import { memoryLines } from "./memory";
import { parsePlaybook, type Playbook } from "./playbooks";
import type { RemoteAttachment } from "../../../src/features/connections/model/protocol";

export function signature(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export type BotThreadRecord = BotConfiguration & {
  createdSessionWatchesMigrated?: boolean;
  brainSessionId?: string;
  /** Context a fresh brain of this generation used on its first turn. */
  brainBaseline?: number;
  /** The memory version the brain of this generation last saw in a finished turn. */
  brainMemory?: { generation: number; revision: number; hash?: string };
  sourceCursor: number;
};
export type Wakeup = {
  id: string;
  kind: "user" | "event" | "schedule";
  text: string;
  rootCauseId: string;
  state:
    "pending" | "running" | "completed" | "interrupted" | "failed" | "backoff";
  createdAt: number;
  retryAt?: number;
  attempts: number;
  refs?: string[];
  attachments?: RemoteAttachment[];
  /** The habit this run belongs to, for recording its outcome. */
  habitId?: string;
  /** The running wakeup that took over this input (steering or a merged turn). */
  mergedInto?: string;
  /** Trusted input origin; preserved when an interrupted wakeup is resumed. */
  source?: WakeupSource;
};
export const EVENT_FOOTER = "Re-read current state before acting.";
/** Watch prompts and the footer repeat across event wakeups; keep each once. */
function mergeEventText(texts: string[]): string {
  const lines = new Set(
    texts.flatMap((text) => text.split("\n")).filter((l) => l.trim() && l !== EVENT_FOOTER),
  );
  return [...lines, EVENT_FOOTER].join("\n");
}
export type WakeupSource =
  | { kind: "client" }
  | { kind: "im"; bindingId: string }
  | { kind: "automatic" };
export function wakeupSource(wakeup: Pick<Wakeup, "kind" | "source">): WakeupSource {
  return wakeup.source ?? { kind: wakeup.kind === "user" ? "client" : "automatic" };
}
function withSource(wakeup: Wakeup): Wakeup {
  return { ...wakeup, source: wakeupSource(wakeup) };
}
/** Keep pre-IM client receipt signatures compatible with saved retries. */
export function receiveSignature(
  text: string,
  attachments: RemoteAttachment[],
  source: WakeupSource,
): string {
  return signature({ text, attachments, ...(source.kind === "client" ? {} : { source }) });
}
export type Source = {
  eventKey: string;
  sessionId: string;
  projectId: string;
  kind: string;
  rootCauseId: string;
  createdAt: number;
};
type NewMessage = BotMessage extends infer M
  ? M extends BotMessage
    ? Omit<M, "revision" | "createdAt"> & { createdAt?: number }
    : never
  : never;
export class BotThreadStore {
  readonly bots: BotStore;
  readonly scope: BotScope;
  readonly botId: string;
  readonly threadId: string;
  constructor(readonly host: HostStore, scope?: BotScope) {
    this.bots = new BotStore(host);
    const identity = scope ?? this.bots.defaultScope();
    this.scope = Object.freeze({ botId: identity.botId, threadId: identity.threadId });
    this.botId = this.scope.botId;
    this.threadId = this.scope.threadId;
    if (scope && !this.bots.getThread(scope.botId, scope.threadId))
      throw new Error("Thread does not belong to this Bot");
  }
  /**
   * A memory document: `memory` (resident), `archive`, or `topic:<name>`.
   * Missing documents read as empty at revision 0.
   */
  get memory(): FileMemoryService {
    return FileMemoryService.forBot(this.host, this.botId);
  }
  memoryDoc(name: string): { text: string; revision: number } {
    return this.get() ? this.memory.legacyRead(name) : { text: "", revision: 0 };
  }
  /** Legacy controls retain their revision CAS, redaction and budget handling. */
  writeMemoryDoc(name: string, text: string, expected?: number): number {
    return this.memory.legacyWrite(name, text, expected);
  }
  playbooks(): Playbook[] {
    return this.get() ? this.memory.legacyDocuments("playbook:").filter(doc => doc.text).map(doc => parsePlaybook(doc.name, doc.text)) : [];
  }
  playbookRevision(): number {
    return this.get() ? this.memory.legacyDocuments("playbook:").reduce((sum, doc) => sum + doc.revision, 0) : 0;
  }
  memoryTopics(): string[] {
    return this.get() ? this.memory.legacyDocuments("topic:").filter(doc => doc.text).map(doc => doc.name) : [];
  }
  get(): BotThreadRecord | null {
    return this.bots.record(this.scope);
  }
  view(): BotConfiguration | null {
    const value = this.get();
    if (!value) return null;
    const {
      brainSessionId: _brain,
      brainBaseline: _baseline,
      brainMemory: _memory,
      sourceCursor: _cursor,
      createdSessionWatchesMigrated: _createdSessionWatchesMigrated,
      ...publicValue
    } = value;
    const sources = this.host.db
      .prepare("SELECT COUNT(*) AS count FROM bot_sources WHERE bot_id=? AND thread_id=? AND seq>?")
      .get(this.botId, this.threadId, value.sourceCursor)!;
    const inputs = this.host.db
      .prepare(
        "SELECT COUNT(*) AS count FROM bot_wakeups WHERE bot_id=? AND thread_id=? AND json_extract(payload, '$.state') IN ('pending', 'backoff')",
      )
      .get(this.botId, this.threadId)!;
    const memory = this.memoryDoc("memory");
    return {
      ...publicValue,
      lifecycle: !value.enabled ? "disabled" : value.paused ? "paused" : value.lifecycle,
      backlog: Number(sources.count) > 100 || Number(inputs.count) > 100,
      memory: {
        revision: memory.revision,
        lines: memoryLines(memory.text).filter((line) => !line.struck).length,
      },
      playbooks: {
        revision: this.playbookRevision(),
        count: this.playbooks().length,
      },
    };
  }
  initialize(patch: BotPatch): BotThreadRecord {
    const scope = this.bots.defaultScope();
    if (this.botId !== scope.botId || this.threadId !== scope.threadId)
      throw new Error("Only the default assistant can be initialized through the compatibility API");
    return this.bots.initializeDefault(patch);
  }
  write(value: BotThreadRecord): void {
    // A full effective Thread snapshot is safe only for runtime persistence.
    // Shared configuration must use update(patch), never stale projected data.
    this.bots.writeRuntime(this.scope, value);
  }
  update(patch: Partial<BotThreadRecord>, configuration = false): BotThreadRecord {
    return this.bots.updateRecord(this.scope, patch, configuration);
  }
  messageById(id: string): BotMessage | undefined {
    const row = this.host.db.prepare("SELECT payload FROM bot_messages WHERE bot_id=? AND thread_id=? AND id=? ORDER BY revision DESC LIMIT 1").get(this.botId, this.threadId, id);
    return row ? JSON.parse(String(row.payload)) : undefined;
  }
  message(input: NewMessage): BotMessage {
    return this.host.transaction(() => this.saveMessage(input));
  }
  private saveMessage(input: NewMessage): BotMessage {
    const config = this.get();
    if (!config) throw new Error("Assistant is not configured");
    const row = this.host.db
      .prepare(
        "SELECT payload FROM bot_messages WHERE bot_id=? AND thread_id=? AND id=? ORDER BY revision DESC LIMIT 1",
      )
      .get(this.botId, this.threadId, input.id);
    const previous: BotMessage | undefined = row
      ? JSON.parse(String(row.payload))
      : undefined;
    const message = {
      ...input,
      revision: config.chatRevision + 1,
      createdAt: previous?.createdAt ?? input.createdAt ?? Date.now(),
    } as BotMessage;
    // A newer full snapshot supersedes a partial one. Keep monotonic cursors
    // without retaining a copy of the growing reply for every stream update.
    if (previous?.kind === "assistant" && previous.streaming)
      this.host.db
        .prepare("DELETE FROM bot_messages WHERE bot_id=? AND thread_id=? AND revision=?")
        .run(this.botId, this.threadId, previous.revision);
    this.host.db
      .prepare("INSERT INTO bot_messages VALUES (?, ?, ?, ?, ?)")
      .run(this.botId, this.threadId, message.revision, message.id, JSON.stringify(message));
    this.update({ chatRevision: message.revision });
    return message;
  }
  messages(after = 0, limit = 50): BotMessages {
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error("Invalid message cursor or limit");
    const rows = this.host.db
      .prepare(
        "SELECT payload FROM bot_messages WHERE bot_id=? AND thread_id=? AND revision>? ORDER BY revision LIMIT ?",
      )
      .all(this.botId, this.threadId, after, limit + 1);
    const entries: BotMessage[] = rows
      .slice(0, limit)
      .map((row) => JSON.parse(String(row.payload)));
    return {
      revision: this.get()?.chatRevision ?? 0,
      entries,
      hasMore: rows.length > limit,
      nextRevision: entries.at(-1)?.revision ?? after,
    };
  }
  latestMessages(): BotMessage[] {
    return this.host.db
      .prepare(
        "SELECT payload FROM bot_messages WHERE bot_id=? AND thread_id=? AND revision IN (SELECT MAX(revision) FROM bot_messages WHERE bot_id=? AND thread_id=? GROUP BY id) ORDER BY revision",
      )
      .all(this.botId, this.threadId, this.botId, this.threadId)
      .map((row) => JSON.parse(String(row.payload)));
  }
  history(before?: BotHistoryCursor, limit = 30): BotHistory {
    if (
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      (before && (!Number.isSafeInteger(before.createdAt) || before.createdAt < 0 ||
        typeof before.id !== "string" || !before.id.length))
    )
      throw new Error("Invalid history cursor or limit");
    // Seek by creation order, not the latest revision: updates to an old card
    // must neither move it into the newest page nor skip it in older pages.
    // The scalar timestamp bound lets SQLite seek its expression index.
    const query = this.host.db.prepare(`
      SELECT message.payload FROM bot_messages AS message
      WHERE message.bot_id=? AND message.thread_id=? AND ${before ? "json_extract(message.payload, '$.createdAt') <= ? AND (json_extract(message.payload, '$.createdAt'), message.id) < (?, ?) AND" : ""}
        NOT EXISTS (
          SELECT 1 FROM bot_messages AS newer
          WHERE newer.bot_id=message.bot_id AND newer.thread_id=message.thread_id AND newer.id = message.id AND newer.revision > message.revision
        )
      ORDER BY json_extract(message.payload, '$.createdAt') DESC, message.id DESC
      LIMIT ?
    `);
    const rows = before
      ? query.all(this.botId, this.threadId, before.createdAt, before.createdAt, before.id, limit + 1)
      : query.all(this.botId, this.threadId, limit + 1);
    const entries: BotMessage[] = rows.slice(0, limit)
      .map((row) => JSON.parse(String(row.payload))).reverse();
    const oldest = entries[0];
    return {
      assistant: this.view(),
      entries,
      hasMore: rows.length > limit,
      nextCursor: oldest && { createdAt: oldest.createdAt, id: oldest.id },
    };
  }
  notificationActivity() {
    const assistant = this.get();
    if (!assistant) return null;
    const row = this.host.db.prepare(`
      SELECT payload FROM bot_messages AS message
      WHERE message.bot_id=? AND message.thread_id=? AND NOT EXISTS (
        SELECT 1 FROM bot_messages AS newer
        WHERE newer.bot_id=message.bot_id AND newer.thread_id=message.thread_id AND newer.id = message.id AND newer.revision > message.revision
      ) AND (
        (json_extract(payload, '$.kind') = 'assistant'
          AND COALESCE(json_extract(payload, '$.streaming'), 0) = 0
          AND (length(trim(json_extract(payload, '$.text'), char(9, 10, 13, 32))) > 0
            OR json_array_length(payload, '$.attachments') > 0))
        OR (json_extract(payload, '$.kind') = 'input'
          AND COALESCE(json_extract(payload, '$.resolved'), 0) = 0)
      ) ORDER BY revision DESC LIMIT 1
    `).get(this.botId, this.threadId);
    return botNotificationActivity(assistant, row ? [JSON.parse(String(row.payload))] : []);
  }
  receipt(id: string, sig: string): unknown | undefined {
    const row = this.host.db
      .prepare("SELECT * FROM bot_receipts WHERE bot_id=? AND thread_id=? AND id=?")
      .get(this.botId, this.threadId, id);
    if (!row) return undefined;
    if (row.signature !== sig)
      throw new Error("Command ID was already used with different input");
    return JSON.parse(String(row.payload));
  }
  recordReceipt(id: string, sig: string, result: unknown): void {
    this.host.db
      .prepare("INSERT INTO bot_receipts VALUES (?, ?, ?, ?, ?)")
      .run(this.botId, this.threadId, id, sig, JSON.stringify(result));
  }
  receive(
    commandId: string,
    text: string,
    attachments: RemoteAttachment[],
    source: WakeupSource = { kind: "client" },
    { enqueue = true }: { enqueue?: boolean } = {},
  ): BotReceipt {
    return this.host.transaction(() => {
      const sig = receiveSignature(text, attachments, source),
        existing = this.receipt(commandId, sig);
      if (existing) return existing as BotReceipt;
      const id = randomUUID();
      if (!enqueue) {
        // A control input (such as a stop command) is read immediately and never starts a turn.
        this.message({ id, kind: "user", text, attachments, readAt: Date.now() });
        const result = { commandId, messageId: id, revision: this.get()!.chatRevision };
        this.recordReceipt(commandId, sig, result);
        return result;
      }
      const wakeupId = randomUUID();
      this.message({
        id,
        kind: "user",
        text,
        attachments,
        wakeupId,
        readAt: null,
      });
      this.enqueue(
        {
          id: wakeupId,
          kind: "user",
          text,
          rootCauseId: wakeupId,
          state: "pending",
          createdAt: Date.now(),
          attempts: 0,
          attachments,
          source,
        },
        `user:${commandId}`,
      );
      this.resumeChains();
      const result = {
        commandId,
        messageId: id,
        wakeupId,
        revision: this.get()!.chatRevision,
      };
      this.recordReceipt(commandId, sig, result);
      return result;
    });
  }
  enqueue(value: Wakeup, dedupe: string): void {
    this.host.db
      .prepare("INSERT OR IGNORE INTO bot_wakeups VALUES (?, ?, ?, ?, ?)")
      .run(this.botId, this.threadId, value.id, dedupe, JSON.stringify(withSource(value)));
  }
  wakeups(): Wakeup[] {
    return this.host.db
      .prepare("SELECT payload FROM bot_wakeups WHERE bot_id=? AND thread_id=?")
      .all(this.botId, this.threadId)
      .map((r) => withSource(JSON.parse(String(r.payload))));
  }
  wakeup(id: string): Wakeup | undefined {
    const row = this.host.db
      .prepare("SELECT payload FROM bot_wakeups WHERE bot_id=? AND thread_id=? AND id=?")
      .get(this.botId, this.threadId, id);
    return row ? withSource(JSON.parse(String(row.payload))) : undefined;
  }
  pending(): Wakeup[] {
    return this.host.db
      .prepare(
        `SELECT payload FROM bot_wakeups WHERE bot_id=? AND thread_id=? AND (json_extract(payload,'$.state')='pending' OR (json_extract(payload,'$.state')='backoff' AND json_extract(payload,'$.retryAt')<=?)) ORDER BY CASE json_extract(payload,'$.kind') WHEN 'user' THEN 0 WHEN 'event' THEN 1 ELSE 2 END, json_extract(payload,'$.createdAt') LIMIT 100`,
      )
      .all(this.botId, this.threadId, Date.now())
      .map((r) => withSource(JSON.parse(String(r.payload))));
  }
  saveWakeup(w: Wakeup): void {
    this.host.db
      .prepare("UPDATE bot_wakeups SET payload=? WHERE bot_id=? AND thread_id=? AND id=?")
      .run(JSON.stringify(withSource(w)), this.botId, this.threadId, w.id);
  }
  private markRead(wakeupIds: string[]): void {
    const ids = new Set(wakeupIds);
    for (const message of this.latestMessages())
      if (
        message.kind === "user" &&
        message.wakeupId &&
        ids.has(message.wakeupId) &&
        message.readAt == null
      )
        this.message({ ...message, readAt: Date.now() });
  }
  /** A stop drops queued user input so it is neither answered nor resumed later. */
  discardPendingUserInput(): void {
    this.host.transaction(() => {
      const queued = this.pending().filter((w) => w.kind === "user");
      for (const w of queued) this.saveWakeup({ ...w, state: "completed" });
      this.markRead(queued.map((w) => w.id));
    });
  }
  /** `events` names other pending event wakeups the caller allows to join this turn. */
  claim(
    id: string,
    skip: ReadonlySet<string> = new Set(),
    events: ReadonlySet<string> = new Set(),
  ): Wakeup {
    return this.host.transaction(() => this.claimPending(id, skip, events));
  }
  private claimPending(
    id: string,
    skip: ReadonlySet<string>,
    events: ReadonlySet<string>,
  ): Wakeup {
    const pending = this.pending();
    const wakeup = pending.find((w) => w.id === id);
    if (!wakeup) throw new Error("Wakeup is not pending");
    // Queued messages from the same sender are answered together in one turn,
    // and so are followed events that arrived while the brain was busy.
    const merged = pending
      .filter(
        (w) =>
          w.id !== id &&
          w.kind === wakeup.kind &&
          w.state === "pending" &&
          !skip.has(w.id) &&
          (wakeup.kind === "user"
            ? signature(wakeupSource(w)) === signature(wakeupSource(wakeup))
            : wakeup.kind === "event" && events.has(w.id)),
      )
      .sort((a, b) => a.createdAt - b.createdAt);
    const ordered = [wakeup, ...merged].sort((a, b) => a.createdAt - b.createdAt);
    const next: Wakeup = {
      ...wakeup,
      state: "running",
      attempts: wakeup.attempts + 1,
      ...(merged.length
        ? {
            text:
              wakeup.kind === "event"
                ? mergeEventText(ordered.map((w) => w.text))
                : ordered.map((w) => w.text).filter(Boolean).join("\n"),
            attachments: ordered.flatMap((w) => w.attachments ?? []),
            refs: [...new Set(ordered.flatMap((w) => w.refs ?? []))],
          }
        : {}),
    };
    this.saveWakeup(next);
    for (const w of merged)
      this.saveWakeup({ ...w, state: "completed", mergedInto: id });
    if (wakeup.kind === "user") this.markRead([id, ...merged.map((w) => w.id)]);
    this.update({
      lifecycle: "running",
      nextRetryAt: undefined,
      error: undefined,
    });
    return next;
  }
  action(requestId: string): BotAction | undefined {
    const row = this.host.db
      .prepare("SELECT payload FROM bot_actions WHERE bot_id=? AND thread_id=? AND request_id=?")
      .get(this.botId, this.threadId, requestId);
    return row ? JSON.parse(String(row.payload)) : undefined;
  }
  actions(): BotAction[] {
    return this.host.db
      .prepare("SELECT payload FROM bot_actions WHERE bot_id=? AND thread_id=?")
      .all(this.botId, this.threadId)
      .map((r) => JSON.parse(String(r.payload)));
  }
  /** Committed in the same transaction as conversation creation and its ledger. */
  followCreatedSession(projectId: string, sessionId: string): void {
    const config = this.get()!;
    this.update({
      policy: followSession(config.policy, projectId, sessionId),
      policyVersion: config.policyVersion + 1,
    }, true);
  }
  /** Bot-wide permissions use trusted creation provenance; action listings remain Thread-scoped. */
  createdSession(sessionId: string): boolean {
    const assistantId = this.get()?.id;
    return !!assistantId && !!this.host.db.prepare(`
      SELECT 1 FROM bot_actions
      WHERE bot_id=? AND json_extract(payload, '$.action') = 'sessions.create'
        AND json_extract(payload, '$.origin.assistantId') = ?
        AND json_extract(payload, '$.targetRef.sessionId') = ?
        AND json_extract(payload, '$.state') IN ('accepted', 'completed')
      LIMIT 1
    `).get(this.botId, assistantId, sessionId);
  }
  putAction(action: BotAction): void {
    this.host.db
      .prepare(
        "INSERT INTO bot_actions VALUES (?, ?, ?, ?) ON CONFLICT(bot_id,thread_id,request_id) DO UPDATE SET payload=excluded.payload",
      )
      .run(this.botId, this.threadId, action.requestId, JSON.stringify(action));
  }
  source(value: Source): void {
    this.host.transaction(() => {
      this.host.db.prepare("INSERT OR IGNORE INTO bot_sources(bot_id,thread_id,seq,event_key,payload) SELECT ?,?,COALESCE(MAX(seq),0)+1,?,? FROM bot_sources WHERE bot_id=? AND thread_id=?")
        .run(this.botId, this.threadId, value.eventKey, JSON.stringify(value), this.botId, this.threadId);
    });
  }
  sources(after: number, limit = 50): (Source & { seq: number })[] {
    return this.host.db
      .prepare(
        "SELECT seq,payload FROM bot_sources WHERE bot_id=? AND thread_id=? AND seq>? ORDER BY seq LIMIT ?",
      )
      .all(this.botId, this.threadId, after, limit)
      .map((r) => ({ ...JSON.parse(String(r.payload)), seq: Number(r.seq) }));
  }
  chain(root: string): { count: number; paused: boolean; startedAt: number } {
    const row = this.host.db
      .prepare("SELECT payload FROM bot_chains WHERE bot_id=? AND thread_id=? AND root=?")
      .get(this.botId, this.threadId, root);
    return row
      ? JSON.parse(String(row.payload))
      : { count: 0, paused: false, startedAt: Date.now() };
  }
  writeChain(root: string, value: ReturnType<BotThreadStore["chain"]>): void {
    this.host.db
      .prepare(
        "INSERT INTO bot_chains VALUES (?,?,?,?) ON CONFLICT(bot_id,thread_id,root) DO UPDATE SET payload=excluded.payload",
      )
      .run(this.botId, this.threadId, root, JSON.stringify(value));
  }
  resumeChains(): void {
    for (const row of this.host.db
      .prepare(
        "SELECT root,payload FROM bot_chains WHERE bot_id=? AND thread_id=? AND json_extract(payload,'$.paused')=1",
      )
      .all(this.botId, this.threadId))
      this.writeChain(String(row.root), {
        ...JSON.parse(String(row.payload)),
        count: 0,
        paused: false,
        startedAt: Date.now(),
      });
  }
  finishStreaming(): void {
    this.host.transaction(() => {
      for (const message of this.latestMessages())
        if (message.kind === "assistant" && message.streaming)
          this.message({ ...message, streaming: false });
    });
  }
  recover(): void {
    this.host.transaction(() => {
      this.finishStreaming();
      let interrupted = false;
      for (const wakeup of this.wakeups())
        if (wakeup.state === "running") {
          this.saveWakeup({ ...wakeup, state: "interrupted" });
          interrupted = true;
          if (this.get())
            this.message({
              id: `restart-interrupted:${wakeup.id}`,
              kind: "status",
              code: "interrupted",
              text: "Host restarted during an assistant turn. Continue after inspecting its actions.",
              wakeupId: wakeup.id,
            });
        }
      for (const action of this.actions())
        if (action.state === "executing") {
          const row = this.host.db
            .prepare("SELECT receipt FROM receipts WHERE id=?")
            .get(`assistant:${action.id}`);
          const receipt = row
            ? (JSON.parse(String(row.receipt)) as {
                commandId: string;
                sessionId: string;
                revision: number;
              })
            : undefined;
          if (
            receipt &&
            [
              "sessions.create",
              "sessions.send",
              "sessions.configure",
              "sessions.compact",
              "sessions.cancel",
              "sessions.approve",
              "sessions.answer",
              "sessions.queue",
              "orchestration.command",
            ].includes(action.action)
          ) {
            let target;
            try {
              target = this.host.session(receipt.sessionId);
            } catch {
              /* Target may have been deleted. */
            }
            const ref = target
              ? {
                  environmentId: this.host.environmentId,
                  projectId: target.projectId,
                  sessionId: target.session.id,
                }
              : action.targetRef;
            this.putAction({
              ...action,
              state: "accepted",
              result: receipt,
              targetRef: ref,
            });
            if (action.action === "sessions.create" && target &&
                !this.get()?.policy.excludedSessionIds?.includes(target.session.id))
              this.followCreatedSession(target.projectId, target.session.id);
            if (
              target &&
              ref &&
              ["sessions.create", "sessions.send"].includes(action.action) &&
              !this.latestMessages().some((m) => m.id === `card:${action.id}`)
            )
              this.message({
                id: `card:${action.id}`,
                kind: "session-card",
                actionId: action.id,
                wakeupId: action.origin.wakeupId,
                ref,
                title: target.session.title,
                projectName: this.host.project(target.projectId).name,
                harness: target.session.harness as never,
                model: target.session.model,
                status: target.status === "interrupted" ? "failed" : "accepted",
              });
          } else
            this.putAction({
              ...action,
              state: "unknown",
              error:
                "Host restarted before the operation result was recorded. Inspect its effects before continuing.",
            });
        }
      const config = this.get();
      if (config && !config.createdSessionWatchesMigrated) {
        let policy = config.policy;
        for (const action of this.actions()) {
          if (action.action !== "sessions.create" || action.origin.assistantId !== config.id ||
              !["accepted", "completed"].includes(action.state) || !action.targetRef ||
              policy.excludedSessionIds?.includes(action.targetRef.sessionId)) continue;
          try {
            const target = this.host.session(action.targetRef.sessionId);
            if (!target.session.assistantOwnerId && !this.host.project(target.projectId).kind)
              policy = followSession(policy, target.projectId, target.session.id);
          } catch { /* Deleted conversations do not need to be followed. */ }
        }
        const changed = signature(policy) !== signature(config.policy);
        this.update({ policy, createdSessionWatchesMigrated: true,
          policyVersion: config.policyVersion + (changed ? 1 : 0) }, changed);
      }
      if (this.get() && (interrupted || this.get()!.lifecycle === "running"))
        this.update({
          lifecycle: "interrupted",
          error:
            "Host restarted during an assistant turn. Continue after inspecting its actions.",
        });
    });
  }
}
