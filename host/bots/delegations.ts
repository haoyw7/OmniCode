import { randomUUID } from "node:crypto";
import type { BotThreadRuntime } from "./thread";
import { BotThreadStore, signature } from "./thread/store";
import { fields, id, object } from "./thread/policy";
import type { BotManager } from "./manager";
import type { BotDelegation, BotDelegations, BotDelegationStatus, BotRun, BotScope } from "../../src/features/bots/model/bots";

const MAX_WAIT_MS = 240_000;
const terminalText: Record<BotDelegationStatus, string> = {
  running: "Bot delegation started", completed: "Bot delegation completed", busy: "The requested Bot is busy",
  failed: "Bot delegation failed", cancelled: "Bot delegation cancelled", timed_out: "Bot delegation timed out",
  interrupted: "Bot delegation interrupted",
};
const live = (run: BotRun | undefined) => !!run && ["running", "waiting_approval"].includes(run.status);

/** Durable single-hop delegation. All source identity comes from a live Host runtime. */
export class DelegationService {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly waiters = new Map<string, Set<(value: BotDelegation) => void>>();
  private closed = false;
  private reconciling = false;
  constructor(readonly manager: BotManager) {
    manager.engine.store.db.exec(`
      CREATE TABLE IF NOT EXISTS bot_delegations (
        id TEXT PRIMARY KEY, source_bot_id TEXT NOT NULL, source_thread_id TEXT NOT NULL, source_run_id TEXT NOT NULL,
        target_bot_id TEXT NOT NULL, target_thread_id TEXT, request_id TEXT NOT NULL, signature TEXT NOT NULL,
        status TEXT NOT NULL, created_at INTEGER NOT NULL, payload TEXT NOT NULL,
        UNIQUE(source_run_id,request_id));
      CREATE INDEX IF NOT EXISTS bot_delegations_active ON bot_delegations(status);
      CREATE INDEX IF NOT EXISTS bot_delegations_source ON bot_delegations(source_bot_id,source_thread_id,created_at,id);
      CREATE INDEX IF NOT EXISTS bot_delegations_target ON bot_delegations(target_bot_id,target_thread_id,created_at,id);
    `);
  }
  get(id: string): BotDelegation | undefined {
    const row = this.manager.engine.store.db.prepare("SELECT payload FROM bot_delegations WHERE id=?").get(id);
    return row && JSON.parse(String(row.payload));
  }
  private active(): BotDelegation[] {
    return this.manager.engine.store.db.prepare("SELECT payload FROM bot_delegations WHERE status='running'").all()
      .map(row => JSON.parse(String(row.payload)));
  }
  private source(runtime: BotThreadRuntime): BotRun {
    const run = runtime.currentRun, scope = runtime.store.scope;
    if (this.closed || this.manager.assistant(scope) !== runtime || !live(run) || !runtime.store.get()?.enabled || runtime.store.get()?.paused)
      throw new Error("Bot delegation requires an active Host run");
    return run!;
  }
  private permitted(value: BotDelegation): boolean {
    const bot = this.manager.store.getBot(value.source.botId);
    const parent = this.manager.store.run(value.source, value.source.runId);
    return !!bot?.enabled && !bot.paused && bot.archivedAt === undefined &&
      !!bot.callableBotIds?.includes(value.target.botId) &&
      (live(parent) || (value.mode === "background" && parent?.status === "completed")) &&
      (!value.teamId || this.manager.teams.authorizeDelegation(value));
  }
  authorizeRun(run: BotRun): boolean {
    if (this.manager.store.getThread(run.botId, run.threadId)?.kind !== "delegation") return true;
    const row = this.manager.engine.store.db.prepare("SELECT payload FROM bot_delegations WHERE target_bot_id=? AND target_thread_id=?")
      .get(run.botId, run.threadId);
    const value: BotDelegation | undefined = row && JSON.parse(String(row.payload));
    const target = this.manager.store.getBot(run.botId);
    return !this.closed && !!target?.enabled && !target.paused && target.archivedAt === undefined &&
      !!value && value.target.runId === run.id && value.status === "running" && value.deadlineAt > Date.now() && this.permitted(value);
  }
  /** Recheck delegation authority before an accepted project task leaves its queue. */
  authorizeQueued(scope: BotScope, wakeupId: string): boolean {
    const thread = this.manager.store.getThread(scope.botId, scope.threadId);
    if (thread?.kind !== "delegation") return true;
    if (this.closed || thread.archivedAt !== undefined) return false;
    const row = this.manager.engine.store.db.prepare("SELECT payload FROM bot_delegations WHERE target_bot_id=? AND target_thread_id=?")
      .get(scope.botId, scope.threadId);
    const value: BotDelegation | undefined = row && JSON.parse(String(row.payload));
    const run = value?.target.runId ? this.manager.store.run(scope, value.target.runId) : undefined;
    if (!value || !run || run.wakeupId !== wakeupId || !["running", "completed"].includes(value.status)) return false;
    if (run.status !== "completed") return thread.lifecycle === "running" && live(run) && this.authorizeRun(run);
    // Successfully accepted project work can outlive both completed Bot turns.
    // Cancellation/failure, late completion, or current policy revocation cannot.
    const target = this.manager.store.getBot(scope.botId), source = this.manager.store.getBot(value.source.botId);
    const parent = this.manager.store.run(value.source, value.source.runId);
    return (run.endedAt ?? run.updatedAt) <= value.deadlineAt && !!target?.enabled && !target.paused && target.archivedAt === undefined &&
      !!source?.enabled && !source.paused && source.archivedAt === undefined && !!source.callableBotIds?.includes(scope.botId) &&
      (live(parent) || parent?.status === "completed") && (!value.teamId || this.manager.teams.authorizeDelegation(value));
  }
  listBots(runtime: BotThreadRuntime) {
    this.source(runtime);
    if (this.manager.store.getThread(runtime.store.botId, runtime.store.threadId)?.kind === "delegation") return { bots: [] };
    const allowed = new Set(this.manager.store.getBot(runtime.store.botId)?.callableBotIds ?? []);
    const teams = this.manager.teams.forBot(runtime.store.botId).map(({ id, name, memberBotIds, chiefBotId }) => ({ id, name, memberBotIds, chiefBotId }));
    return { ...(teams.length ? { teams } : {}), bots: this.manager.store.listBots().filter(bot => allowed.has(bot.id) && bot.id !== runtime.store.botId)
      .map(bot => ({ id: bot.id, name: bot.name, avatar: bot.avatar, harness: bot.harness, model: bot.model,
        available: this.manager.hasDelegationSlot(bot.id) })) };
  }
  private publish(value: BotDelegation): void {
    const scopes: BotScope[] = [value.source];
    if (value.target.threadId) scopes.push({ botId: value.target.botId, threadId: value.target.threadId });
    for (const scope of scopes) {
      const store = new BotThreadStore(this.manager.engine.store, scope);
      const runId = scope.botId === value.source.botId && scope.threadId === value.source.threadId ? value.source.runId : value.target.runId;
      const run = runId ? this.manager.store.run(scope, runId) : undefined;
      store.message({ id: `delegation:${value.id}`, kind: "status", code: `delegation-${value.status}`,
        text: terminalText[value.status], delegationId: value.id, wakeupId: run?.wakeupId });
    }
  }
  private write(value: BotDelegation, sig?: string): BotDelegation {
    this.manager.engine.store.transaction(() => {
      if (sig !== undefined)
        this.manager.engine.store.db.prepare("INSERT INTO bot_delegations VALUES (?,?,?,?,?,?,?,?,?,?,?)")
          .run(value.id, value.source.botId, value.source.threadId, value.source.runId, value.target.botId,
            value.target.threadId ?? null, value.requestId, sig, value.status, value.createdAt, JSON.stringify(value));
      else this.manager.engine.store.db.prepare("UPDATE bot_delegations SET status=?,payload=? WHERE id=?")
        .run(value.status, JSON.stringify(value), value.id);
      this.publish(value);
    });
    if (value.status !== "running") {
      clearTimeout(this.timers.get(value.id)); this.timers.delete(value.id);
      for (const resolve of this.waiters.get(value.id) ?? []) resolve(value);
      this.waiters.delete(value.id);
    }
    return value;
  }
  async submit(runtime: BotThreadRuntime, requestId: string, raw: Record<string, unknown>, trusted?: { teamId: string; mode: "attached" | "background"; deadlineAt?: number }): Promise<BotDelegation> {
    const source = this.source(runtime);
    fields(raw, ["botId", "prompt", "timeoutMs"]);
    const targetBotId = id(raw.botId, "Bot"), prompt = id(raw.prompt, "delegation prompt", 100_000);
    id(requestId, "request ID", 200);
    const timeoutMs = raw.timeoutMs ?? MAX_WAIT_MS;
    if (!Number.isSafeInteger(timeoutMs) || Number(timeoutMs) < 1 || Number(timeoutMs) > MAX_WAIT_MS)
      throw new Error("Bot delegation timeout must be between 1 and 240000 milliseconds");
    const sig = signature({ botId: targetBotId, prompt, timeoutMs, ...(trusted ? { trusted } : {}) });
    const previous = this.manager.engine.store.db.prepare("SELECT signature,payload FROM bot_delegations WHERE source_run_id=? AND request_id=?")
      .get(source.id, requestId);
    if (previous) {
      if (previous.signature !== sig) throw new Error("Delegation request ID was already used with different input");
      this.reconcile();
      return this.get((JSON.parse(String(previous.payload)) as BotDelegation).id)!;
    }
    const now = Date.now();
    let value: BotDelegation = { id: randomUUID(), source: { ...runtime.store.scope, runId: source.id }, target: { botId: targetBotId },
      requestId, prompt, ...(trusted ? { teamId: trusted.teamId, mode: trusted.mode } : {}),
      status: "running", createdAt: now, updatedAt: now, deadlineAt: Math.min(now + Number(timeoutMs), trusted?.deadlineAt ?? Infinity) };
    const target = this.manager.store.getBot(targetBotId);
    if (targetBotId === source.botId) value = { ...value, status: "failed", error: "A Bot cannot delegate to itself" };
    else if (this.manager.store.getThread(source.botId, source.threadId)?.kind === "delegation")
      value = { ...value, status: "failed", error: "Delegated runs cannot delegate again" };
    else if (trusted && !this.manager.teams.authorizeDelegation(value))
      value = { ...value, status: "failed", error: "Only the current Chief may delegate to this team member" };
    else if (!target || !this.manager.store.getBot(source.botId)?.callableBotIds?.includes(targetBotId))
      value = { ...value, status: "failed", error: "This Bot is not an allowed delegation target" };
    if (value.status === "running" && value.deadlineAt <= now)
      value = { ...value, status: "timed_out", error: "Bot delegation exceeded its deadline" };
    let admitted: (BotScope & { runId: string }) | undefined;
    try {
      this.manager.engine.store.transaction(() => {
        if (value.status === "running") {
          admitted = this.manager.reserveDelegation(targetBotId, value.id, prompt, runtime.store.get()!.name);
          value = admitted ? { ...value, target: admitted } : { ...value, status: "busy", error: "The requested Bot has no free execution slot" };
        }
        if (value.status !== "running") value.completedAt = now;
        this.write(value, sig);
      });
    } catch (error) {
      if (admitted) this.manager.releaseDelegationReservation(admitted);
      throw error;
    }
    if (admitted) {
      const timer = setTimeout(() => this.reconcile(), Math.max(0, value.deadlineAt - Date.now()));
      timer.unref?.(); this.timers.set(value.id, timer);
      this.manager.startDelegation(admitted);
    }
    return value;
  }
  async wait(runtime: BotThreadRuntime, delegationId: string, timeoutMs = 25_000): Promise<BotDelegation> {
    const source = this.source(runtime), value = this.get(id(delegationId, "delegation"));
    if (!value || value.source.runId !== source.id) throw new Error("Delegation does not belong to this run");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 25_000) throw new Error("Invalid delegation wait duration");
    this.reconcile();
    const current = this.get(value.id)!;
    if (current.status !== "running") return current;
    return new Promise(resolve => {
      const finish = (result: BotDelegation) => { clearTimeout(timer); this.waiters.get(value.id)?.delete(finish); resolve(result); };
      const timer = setTimeout(() => { this.reconcile(); finish(this.get(value.id)!); }, Math.min(timeoutMs, Math.max(1, current.deadlineAt - Date.now())));
      timer.unref?.();
      const pending = this.waiters.get(value.id) ?? new Set(); pending.add(finish); this.waiters.set(value.id, pending);
    });
  }
  private end(delegationId: string, status: Exclude<BotDelegationStatus, "running">, error?: string): BotDelegation | undefined {
    const value = this.get(delegationId);
    if (!value || value.status !== "running") return value;
    const ended = this.write({ ...value, status, error, updatedAt: Date.now(), completedAt: Date.now() });
    if (value.target.threadId) {
      const runtime = this.manager.assistant({ botId: value.target.botId, threadId: value.target.threadId });
      // Revoke the target grant synchronously; only this delegated thread is stopped.
      if (runtime.store.get()?.brainSessionId) runtime.control.disable(runtime.store.get()!.brainSessionId!);
      runtime.discardArchivedWork();
      void runtime.rpc("assistant.control", { commandId: `delegation-end:${value.id}`, action: "cancelTurn" }).catch(failure => {
        if (this.closed) return;
        const latest = this.get(value.id)!;
        this.write({ ...latest, error: `${latest.error ?? terminalText[status]}: ${failure instanceof Error ? failure.message : String(failure)}`, updatedAt: Date.now() });
      });
    }
    return ended;
  }
  /** Publish already-durable completion without invoking or replaying the provider. */
  private collect(value: BotDelegation, run: BotRun): BotDelegation {
    const completedAt = run.endedAt ?? run.updatedAt;
    if (completedAt > value.deadlineAt)
      return this.write({ ...value, status: "timed_out", error: "Bot delegation exceeded its deadline", updatedAt: Date.now(), completedAt });
    const store = new BotThreadStore(this.manager.engine.store, { botId: run.botId, threadId: run.threadId });
    const text = store.latestMessages().filter(message => message.kind === "assistant" && message.wakeupId === run.wakeupId && !message.streaming)
      .map(message => message.kind === "assistant" ? message.text : "").join("\n\n");
    const points = Array.from(text);
    return this.write({ ...value, status: "completed", result: points.slice(0, 60_000).join(""), ...(points.length > 60_000 ? { resultTruncated: true } : {}),
      updatedAt: Date.now(), completedAt });
  }
  parentEnded(runId: string): void {
    this.reconcile();
    for (const value of this.active()) if (value.source.runId === runId &&
        !(value.mode === "background" && this.manager.store.run(value.source, runId)?.status === "completed"))
      this.end(value.id, "cancelled", "The originating Bot run stopped");
  }
  reconcile(): void {
    if (this.closed || this.reconciling) return;
    this.reconciling = true;
    try {
      for (const value of this.active()) {
        const run = value.target.threadId && value.target.runId
          ? this.manager.store.run({ botId: value.target.botId, threadId: value.target.threadId }, value.target.runId) : undefined;
        // A finished run's persisted timestamp takes precedence over a delayed
        // reconciliation timer or Host restart.
        if (run?.status === "completed") { this.collect(value, run); continue; }
        if (Date.now() >= value.deadlineAt) { this.end(value.id, "timed_out", "Bot delegation exceeded its deadline"); continue; }
        if (run && ["cancelled", "failed", "interrupted"].includes(run.status))
          this.end(value.id, run.status as "cancelled" | "failed" | "interrupted", run.error);
        else if (!this.permitted(value)) this.end(value.id, "cancelled", "Bot delegation permission was revoked or the originating run ended");
      }
    } finally { this.reconciling = false; }
  }
  recover(): void {
    for (const value of this.active()) {
      if (value.target.threadId && value.target.runId) {
        const scope = { botId: value.target.botId, threadId: value.target.threadId }, store = new BotThreadStore(this.manager.engine.store, scope);
        const run = this.manager.store.run(scope, value.target.runId);
        if (run?.status === "completed") { this.collect(value, run); continue; }
        for (const wakeup of store.wakeups())
          if (["pending", "backoff", "running"].includes(wakeup.state)) store.saveWakeup({ ...wakeup, state: "interrupted" });
        for (const pending of this.manager.store.queuedRuns(scope))
          this.manager.store.updateRun(scope, pending.id, { status: "interrupted", endedAt: Date.now(), error: "Host restarted during delegation" });
        if (run && ["running", "waiting_approval"].includes(run.status))
          this.manager.store.updateRun(scope, run.id, { status: "interrupted", endedAt: Date.now(), error: "Host restarted during delegation" });
        store.update({ lifecycle: "interrupted" });
      }
      this.write({ ...value, status: "interrupted", error: "Host restarted during delegation; inspect recorded actions before continuing",
        completedAt: Date.now(), updatedAt: Date.now() });
    }
  }
  private scoped(raw: Record<string, unknown>): BotScope {
    const scope = { botId: id(raw.botId, "Bot"), threadId: id(raw.threadId, "thread") };
    if (!this.manager.store.getThread(scope.botId, scope.threadId)) throw new Error("Thread does not belong to this Bot");
    return scope;
  }
  private belongs(value: BotDelegation, scope: BotScope): boolean {
    return (value.source.botId === scope.botId && value.source.threadId === scope.threadId) ||
      (value.target.botId === scope.botId && value.target.threadId === scope.threadId);
  }
  async rpc(method: string, raw: Record<string, unknown>): Promise<unknown> {
    if (method === "botDelegations.list") {
      fields(raw, ["botId", "threadId", "limit", "before"]);
      const scope = this.scoped(raw), limit = raw.limit ?? 30;
      if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 100) throw new Error("Invalid delegation list limit");
      const before = raw.before === undefined ? undefined : object(raw.before);
      if (before) {
        fields(before, ["createdAt", "id"]); id(before.id, "delegation cursor");
        if (!Number.isSafeInteger(before.createdAt) || Number(before.createdAt) < 0) throw new Error("Invalid delegation cursor");
        const previous = this.get(String(before.id));
        if (!previous || !this.belongs(previous, scope) || previous.createdAt !== before.createdAt) throw new Error("Invalid delegation cursor");
      }
      const rows = this.manager.engine.store.db.prepare(`SELECT payload FROM bot_delegations
        WHERE ((source_bot_id=? AND source_thread_id=?) OR (target_bot_id=? AND target_thread_id=?))
          AND (? IS NULL OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?`)
        .all(scope.botId, scope.threadId, scope.botId, scope.threadId, before ? Number(before.createdAt) : null, before ? Number(before.createdAt) : null,
          before ? Number(before.createdAt) : null, before ? String(before.id) : null, Number(limit) + 1);
      const delegations: BotDelegation[] = rows.slice(0, Number(limit)).map(row => JSON.parse(String(row.payload))), last = delegations.at(-1);
      return { revision: this.manager.store.revision(), delegations, hasMore: rows.length > Number(limit),
        ...(rows.length > Number(limit) && last ? { next: { createdAt: last.createdAt, id: last.id } } : {}) } satisfies BotDelegations;
    }
    fields(raw, method === "botDelegations.get" ? ["botId", "threadId", "delegationId"] : ["botId", "threadId", "delegationId", "commandId"]);
    const scope = this.scoped(raw), value = this.get(id(raw.delegationId, "delegation"));
    if (!value || !this.belongs(value, scope)) throw new Error("Delegation does not belong to this thread");
    if (method === "botDelegations.get") return value;
    if (method !== "botDelegations.cancel") throw new Error("Unsupported delegation operation");
    const commandId = id(raw.commandId), key = `delegation:${JSON.stringify(scope)}`, sig = signature({ method, raw });
    const previous = this.manager.store.commandReceipt(key, commandId, sig);
    if (previous !== undefined) return previous;
    const result = this.end(value.id, "cancelled", "Bot delegation cancelled by the user")!;
    this.manager.store.recordCommandReceipt(key, commandId, sig, result);
    return result;
  }
  close(): void {
    this.closed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.recover();
  }
}
