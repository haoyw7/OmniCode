import { dirname, join } from "node:path";
import type { HostEngine } from "../engine";
import { BotThreadRuntime, type BotThreadRuntimeOptions } from "./thread";
import { BotThreadStore, signature } from "./thread/store";
import { fields, id, object } from "./thread/policy";
import { BotStore } from "./store";
import { HostResourceGuard } from "./resources";
import { DelegationService } from "./delegations";
import { RoomService } from "./rooms";
import { TeamService } from "./teams";
import type { BotThreadRecord } from "./thread/store";
import type { BotRun, BotScope, BotsSnapshot } from "../../src/features/bots/model/bots";
import type { HostModelCatalog, HostSession, RemoteProvider } from "../../src/features/connections/model/protocol";
import type { TurnOrigin } from "../../src/features/sessions/model/session";

const BOT_CONTROLS = new Set(["pause", "resume", "disable", "enable"]);
const PASSIVE_SESSION_EVENTS = new Set(["message.delta", "reasoning.delta", "context", "turn.metrics"]);

function passiveSessionBatch(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  const batch = event as { type?: unknown; events?: unknown };
  return batch.type === "events" && Array.isArray(batch.events) && batch.events.length > 0 &&
    batch.events.every(value => value && typeof value === "object" && PASSIVE_SESSION_EVENTS.has(value.type));
}

/** Owns Host callbacks and routes every runtime through its durable Bot/Thread scope. */
export class BotManager {
  readonly store: BotStore;
  readonly defaultAssistant: BotThreadRuntime;
  readonly delegations: DelegationService;
  readonly rooms: RoomService;
  readonly teams: TeamService;
  readonly ready: Promise<void>;
  private readonly runtimes = new Map<string, BotThreadRuntime>();
  private readonly leases = new Map<string, Map<string, string>>();
  private readonly resources: HostResourceGuard;
  private readonly blocked = new Set<string>();
  private readonly blockedThreads = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private closing = false;
  private mutations: Promise<unknown> = Promise.resolve();
  private available?: () => Promise<RemoteProvider[]>;
  private catalog?: (projectId?: string) => Promise<HostModelCatalog>;
  private readonly observeSession = (previous: HostSession | undefined, next: HostSession, event: unknown) => {
    // Ordinary streamed text/usage cannot create Bot sources or change followed
    // cards. Bot brains still need their durable message projection on every save.
    if (previous && !previous.session.assistantOwnerId && !next.session.assistantOwnerId &&
      previous.status === next.status && previous.lastCompletedRunId === next.lastCompletedRunId &&
      previous.session.queuedMessages === next.session.queuedMessages && passiveSessionBatch(event)) return;
    const errors: unknown[] = [];
    for (const runtime of this.runtimes.values()) {
      try { runtime.observe(previous, next, event); } catch (error) { errors.push(error); }
    }
    // Every observer gets the event; a failed durable projection still rolls back
    // the surrounding Host transaction instead of committing a missing journal.
    if (errors.length) throw errors[0];
  };
  private readonly authorizeQueued = (origin: TurnOrigin, projectId: string, sessionId: string): boolean => {
    if (this.closing || (origin.botId !== undefined && origin.botId !== origin.assistantId)) return false;
    const bot = this.store.getBot(origin.assistantId);
    if (!bot?.enabled || bot.archivedAt !== undefined) return false;
    const scopes = origin.threadId
      ? [{ botId: bot.id, threadId: origin.threadId }]
      : this.store.listThreads(bot.id, true).map(thread => ({ botId: bot.id, threadId: thread.id }));
    for (const scope of scopes) {
      const thread = this.store.getThread(scope.botId, scope.threadId);
      if (!thread || thread.archivedAt !== undefined) continue;
      if (!this.rooms.authorizeQueued(scope, origin.wakeupId) || !this.delegations.authorizeQueued(scope, origin.wakeupId)) continue;
      const runtime = this.assistant(scope);
      if (!origin.threadId && !runtime.store.wakeup(origin.wakeupId)) continue;
      try { runtime.checkSessionAccess("sessions.send", projectId, sessionId); return true; }
      catch { /* Another legacy thread may own this trusted origin. */ }
    }
    return false;
  };

  constructor(
    readonly engine: HostEngine,
    private readonly providers: RemoteProvider[],
    private readonly parentReady: Promise<void>,
    private readonly options: Pick<BotThreadRuntimeOptions, "entry" | "node"> = {},
  ) {
    this.store = new BotStore(engine.store);
    this.resources = new HostResourceGuard(engine.store);
    this.teams = new TeamService(this);
    this.delegations = new DelegationService(this);
    this.rooms = new RoomService(this);
    this.defaultAssistant = this.createRuntime(this.store.defaultScope());
    for (const bot of this.store.listBots(true))
      for (const thread of this.store.listThreads(bot.id, true))
        this.createRuntime({ botId: bot.id, threadId: thread.id });
    engine.authorizeAssistantQueued = this.authorizeQueued;
    engine.store.onSessionSave = this.observeSession;
    this.ready = Promise.all([...this.runtimes.values()].map(runtime => runtime.ready)).then(() => {
      if (this.closing) return;
      this.delegations.recover();
      this.rooms.recover();
      this.timer = setInterval(() => this.tick(), 1000);
      this.timer.unref?.();
      this.tick();
    });
  }

  private key(scope: BotScope): string { return JSON.stringify([scope.botId, scope.threadId]); }

  private createRuntime(scope: BotScope): BotThreadRuntime {
    const key = this.key(scope);
    const existing = this.runtimes.get(key);
    if (existing) return existing;
    const runtime = new BotThreadRuntime(this.engine, this.providers, this.parentReady, {
      ...this.options,
      store: new BotThreadStore(this.engine.store, this.store.getThread(scope.botId, scope.threadId) ? scope : undefined),
      managed: {
        automatic: () => this.store.getBot(scope.botId)?.defaultThreadId === scope.threadId,
        acquire: (run, config) => this.acquire(scope, run, config),
        authorizeRun: run => this.delegations.authorizeRun(run) && this.rooms.authorizeRun(run),
        stopping: run => this.delegations.parentEnded(run.id),
        release: () => {
          const owners = this.leases.get(scope.botId), runId = owners?.get(scope.threadId);
          if (!runId) return;
          this.resources.release(runId);
          owners!.delete(scope.threadId);
          if (!owners!.size) this.leases.delete(scope.botId);
          if (!this.closing) setImmediate(() => { this.delegations.reconcile(); this.rooms.reconcile(); this.tick(); });
        },
      },
    });
    if (this.available && this.catalog) runtime.setCatalog(this.available, this.catalog);
    else if (this.defaultAssistant) runtime.setCatalog(
      () => this.defaultAssistant.providers(), projectId => this.defaultAssistant.models(projectId),
    );
    this.runtimes.set(key, runtime);
    return runtime;
  }

  private acquire(scope: BotScope, run: BotRun, config: BotThreadRecord, admitting = false): boolean {
    const bot = this.store.getBot(scope.botId), thread = this.store.getThread(scope.botId, scope.threadId);
    if (this.closing || this.blocked.has(scope.botId) || this.blockedThreads.has(this.key(scope)) || !bot?.enabled || bot.paused ||
        !thread || bot.archivedAt !== undefined || thread.archivedAt !== undefined ||
        (!admitting && (!this.delegations.authorizeRun(run) || !this.rooms.authorizeRun(run)))) return false;
    const owners = this.leases.get(scope.botId) ?? new Map<string, string>(), previous = owners.get(scope.threadId);
    if (previous) return previous === run.id;
    if (owners.size >= (bot.maxConcurrentRuns ?? 3)) return false;
    const workingDirectory = config.workingDirectory ?? join(dirname(this.engine.store.attachmentDir), "bots", scope.botId, "threads", scope.threadId);
    if (!this.resources.acquire(run.id, { workingDirectory, computer: config.tools?.computer === true }).acquired) return false;
    owners.set(scope.threadId, run.id);
    this.leases.set(scope.botId, owners);
    return true;
  }

  hasDelegationSlot(botId: string): boolean {
    const bot = this.store.getBot(botId);
    return !this.closing && !this.blocked.has(botId) && !!bot?.enabled && !bot.paused && bot.archivedAt === undefined &&
      (this.leases.get(botId)?.size ?? 0) < (bot.maxConcurrentRuns ?? 3);
  }

  /** Synchronous slot reservation prevents a delegation from entering an ordinary queue. */
  reserveDelegation(botId: string, delegationId: string, prompt: string, sourceName: string): (BotScope & { runId: string }) | undefined {
    if (!this.hasDelegationSlot(botId)) return;
    const busy = new Error("Delegation admission is busy");
    try {
      return this.engine.store.transaction(() => {
        const scope = this.store.createThread(botId, { kind: "delegation", title: `From ${sourceName}` });
        const assistant = new BotThreadStore(this.engine.store, scope);
        const receipt = assistant.receive(`delegation:${delegationId}`, prompt, [], { kind: "automatic" });
        const run = this.store.queuedRun(scope, assistant.wakeup(receipt.wakeupId!)!);
        if (!this.acquire(scope, run, assistant.get()!, true)) throw busy;
        return { ...scope, runId: run.id };
      });
    } catch (error) {
      if (error === busy) return;
      throw error;
    }
  }

  releaseDelegationReservation(scope: BotScope & { runId: string }): void {
    const owners = this.leases.get(scope.botId);
    if (owners?.get(scope.threadId) !== scope.runId) return;
    this.resources.release(scope.runId); owners.delete(scope.threadId);
    if (!owners.size) this.leases.delete(scope.botId);
  }
  startDelegation(scope: BotScope): void { void this.assistant(scope).managedTick(); }

  assistant(scope: BotScope): BotThreadRuntime {
    if (!this.store.getThread(scope.botId, scope.threadId)) throw new Error("Thread does not belong to this Bot");
    return this.createRuntime({ botId: scope.botId, threadId: scope.threadId });
  }

  setCatalog(available: () => Promise<RemoteProvider[]>, catalog: (projectId?: string) => Promise<HostModelCatalog>): void {
    this.available = available;
    this.catalog = catalog;
    for (const runtime of this.runtimes.values()) runtime.setCatalog(available, catalog);
  }

  environment(brainSessionId: string): Record<string, string> {
    for (const runtime of this.runtimes.values()) {
      if (runtime.store.get()?.brainSessionId === brainSessionId) return runtime.environment(brainSessionId);
    }
    return {};
  }

  private tick(): void {
    if (this.closing) return;
    this.delegations.reconcile();
    this.rooms.reconcile();
    for (const runtime of this.runtimes.values()) void runtime.managedTick();
  }

  private snapshot(includeArchived: boolean): BotsSnapshot {
    const bots = this.store.listBots(includeArchived).map(bot => {
      const threads = this.store.listThreads(bot.id, includeArchived);
      const lifecycle = !bot.enabled ? "disabled" : bot.paused ? "paused"
        : threads.some(thread => thread.lifecycle === "running") ? "running" : bot.lifecycle;
      return { ...bot, lifecycle } as typeof bot;
    }), scope = this.store.defaultScope();
    return {
      revision: this.store.revision(), bots,
      threads: bots.flatMap(bot => this.store.listThreads(bot.id, includeArchived)),
      ...(this.store.getBot(scope.botId) ? { defaultBotId: scope.botId, defaultThreadId: scope.threadId } : {}),
    };
  }

  private scope(raw: Record<string, unknown>): BotScope {
    const scope = { botId: id(raw.botId, "Bot"), threadId: id(raw.threadId, "thread") };
    if (!this.store.getThread(scope.botId, scope.threadId)) throw new Error("Thread does not belong to this Bot");
    return scope;
  }

  private botScope(raw: Record<string, unknown>): BotScope {
    const botId = id(raw.botId, "Bot"), bot = this.store.getBot(botId);
    if (!bot) throw new Error("Bot not found");
    return { botId, threadId: bot.defaultThreadId };
  }

  private assertWritable(scope: BotScope): void {
    if (this.store.getBot(scope.botId)?.archivedAt !== undefined ||
        this.store.getThread(scope.botId, scope.threadId)?.archivedAt !== undefined)
      throw new Error("Restore the archived Bot or thread before changing it");
  }

  async rpc(method: string, raw: Record<string, unknown>): Promise<unknown> {
    await this.ready;
    if (this.closing) throw new Error("Bots are closing");
    if (method.startsWith("assistant.")) {
      if (method === "assistant.control" && BOT_CONTROLS.has(String(raw.action)))
        return this.mutate(() => this.controlBot(this.store.defaultScope(), raw));
      const result = await this.defaultAssistant.rpc(method, raw);
      if (method === "assistant.configure") this.delegations.reconcile();
      return result;
    }
    if (method.startsWith("botDelegations.")) return this.delegations.rpc(method, raw);
    if (method.startsWith("botTeams.")) return this.teams.rpc(method, raw);
    if (method.startsWith("botRooms.")) return this.rooms.rpc(method, raw);
    if (method === "bots.list") {
      fields(raw, ["includeArchived"]);
      if (raw.includeArchived !== undefined && typeof raw.includeArchived !== "boolean") throw new Error("Invalid archive filter");
      return this.snapshot(raw.includeArchived === true);
    }
    if (method === "bots.get") {
      fields(raw, ["botId"]);
      return this.store.getBot(this.botScope(raw).botId);
    }
    if (method === "botThreads.list") {
      fields(raw, ["botId", "includeArchived"]);
      if (raw.includeArchived !== undefined && typeof raw.includeArchived !== "boolean") throw new Error("Invalid archive filter");
      return this.store.listThreads(this.botScope(raw).botId, raw.includeArchived === true);
    }
    if (method === "botThreads.runs") {
      fields(raw, ["botId", "threadId", "limit", "before"]);
      const scope = this.scope(raw);
      const before = raw.before === undefined ? undefined : object(raw.before);
      if (before) fields(before, ["createdAt", "id"]);
      return this.store.runs(scope, raw.limit as number | undefined, before as { createdAt: number; id: string } | undefined);
    }
    if (["botMemory.list", "botMemory.read", "botMemory.log"].includes(method)) {
      fields(raw, method === "botMemory.list" ? ["botId"] : method === "botMemory.read" ? ["botId", "path"] : ["botId", "path", "limit"]);
      const memory = this.assistant(this.botScope(raw)).store.memory;
      if (method === "botMemory.list") return memory.list();
      if (method === "botMemory.read") return memory.read(id(raw.path, "memory path", 500));
      if (raw.limit !== undefined && (!Number.isSafeInteger(raw.limit) || Number(raw.limit) < 1 || Number(raw.limit) > 200))
        throw new Error("Invalid memory log limit");
      return memory.log(raw.path === undefined ? undefined : id(raw.path, "memory path", 500), raw.limit as number | undefined);
    }
    if (["botThreads.get", "botThreads.messages", "botMemory.get", "botMemory.topic"].includes(method)) {
      const scope = this.scope(raw), { botId: _bot, threadId: _thread, ...params } = raw;
      const target = method === "botMemory.get" ? "memory" : method === "botMemory.topic" ? "memoryTopic" : method.slice("botThreads.".length);
      const result = await this.assistant(scope).rpc(`assistant.${target}`, params);
      if (method === "botThreads.get") {
        const thread = this.store.getThread(scope.botId, scope.threadId)!;
        return { ...(result as object), ...scope, title: thread.title, archivedAt: thread.archivedAt };
      }
      return result;
    }
    return this.mutate(() => this.mutateRpc(method, raw));
  }

  private mutate<T>(run: () => Promise<T>): Promise<T> {
    const next = this.mutations.then(run);
    this.mutations = next.catch(() => undefined);
    return next;
  }

  private command<T>(scopeKey: string, method: string, raw: Record<string, unknown>, effect: () => T): T {
    const commandId = id(raw.commandId), sig = signature({ method, raw });
    const previous = this.store.commandReceipt(scopeKey, commandId, sig);
    if (previous !== undefined) return previous as T;
    return this.engine.store.transaction(() => {
      const result = effect();
      this.store.recordCommandReceipt(scopeKey, commandId, sig, result);
      return result;
    });
  }

  /** Persist prevalidation before a cancellation whose effects cannot be rolled back. */
  private prepareArchive(scopeKey: string, method: string, raw: Record<string, unknown>, revision: number): void {
    const commandId = id(raw.commandId), sig = signature({ method, raw }), intent = `archive-intent:${scopeKey}`;
    if (this.store.commandReceipt(intent, commandId, sig) !== undefined) return;
    if (raw.expectedRevision !== undefined && raw.expectedRevision !== revision)
      throw new Error("Settings changed elsewhere. Reload before saving.");
    this.engine.store.transaction(() => this.store.recordCommandReceipt(intent, commandId, sig, { acceptedRevision: revision }));
  }

  private async controlBot(scope: BotScope, raw: Record<string, unknown>): Promise<unknown> {
    const runtime = this.assistant(scope);
    if (!BOT_CONTROLS.has(String(raw.action))) return runtime.rpc("assistant.control", raw);
    const commandId = id(raw.commandId), sig = signature({ method: "bots.control", scope, raw });
    const controlScope = `control:${this.key(scope)}`;
    const previous = this.store.commandReceipt(controlScope, commandId, sig);
    if (previous !== undefined) return previous;
    this.blocked.add(scope.botId);
    try {
      const result = await runtime.rpc("assistant.control", raw);
      for (const thread of this.store.listThreads(scope.botId, true)) {
        if (thread.id === scope.threadId) continue;
        const { expectedGeneration: _generation, ...params } = raw;
        await this.assistant({ botId: scope.botId, threadId: thread.id }).rpc("assistant.control", {
          ...params, commandId: `bot-control:${signature({ scope, commandId })}`,
        });
      }
      this.engine.store.transaction(() => {
        this.store.updateBot(scope.botId, { paused: raw.action === "pause" });
        this.store.recordCommandReceipt(controlScope, commandId, sig, result);
      });
      return result;
    } finally {
      this.blocked.delete(scope.botId);
      this.tick();
    }
  }

  private async mutateRpc(method: string, raw: Record<string, unknown>): Promise<unknown> {
    if (["botMemory.save", "botMemory.undo", "botMemory.rebuild"].includes(method)) {
      fields(raw, method === "botMemory.save"
        ? ["botId", "commandId", "path", "text", "expectedRevision", "expectedHash"]
        : method === "botMemory.undo" ? ["botId", "commandId", "changeId", "expectedRevision", "expectedHash"] : ["botId", "commandId"]);
      const scope = this.botScope(raw);
      this.assertWritable(scope);
      const memory = this.assistant(scope).store.memory;
      return this.command(`memory:${scope.botId}`, method, raw, () => {
        if (method === "botMemory.rebuild") return memory.rebuildIndex();
        if (!Number.isSafeInteger(raw.expectedRevision) || Number(raw.expectedRevision) < 0 || typeof raw.expectedHash !== "string")
          throw new Error("A memory revision and hash are required");
        const expected = { expectedRevision: Number(raw.expectedRevision), expectedHash: raw.expectedHash };
        if (method === "botMemory.undo") return memory.undo(id(raw.changeId, "memory change"), expected);
        if (typeof raw.text !== "string") throw new Error("Invalid memory text");
        return memory.save(id(raw.path, "memory path", 500), raw.text, expected);
      });
    }
    if (method === "bots.create") {
      fields(raw, ["commandId", "patch"]);
      const commandId = id(raw.commandId), sig = signature({ method, raw });
      const previous = this.store.commandReceipt("host", commandId, sig);
      if (previous !== undefined) return previous;
      const patch = await this.defaultAssistant.validatePatch(raw.patch, null);
      const result = this.command("host", method, raw, () => {
        const scope = this.store.createBot(patch);
        return { bot: this.store.getBot(scope.botId)!, thread: this.store.getThread(scope.botId, scope.threadId)! };
      });
      await this.assistant({ botId: result.bot.id, threadId: result.thread.id }).ready;
      return result;
    }
    if (method === "bots.configure") {
      const scope = this.botScope(raw), { botId: _bot, ...params } = raw;
      this.assertWritable(scope);
      const result = await this.assistant(scope).rpc("assistant.configure", params);
      this.delegations.reconcile();
      return result;
    }
    if (method === "bots.control") {
      const scope = this.botScope(raw), { botId: _bot, ...params } = raw;
      this.assertWritable(scope);
      return this.controlBot(scope, params);
    }
    if (method === "botThreads.create") {
      fields(raw, ["commandId", "botId", "title", "modelOverride"]);
      const scope = this.botScope(raw);
      this.assertWritable(scope);
      const title = raw.title === undefined ? undefined : id(raw.title, "title", 200);
      const override = raw.modelOverride === undefined ? undefined : object(raw.modelOverride);
      if (override) {
        fields(override, ["harness", "model", "modelSettings"]);
        await this.assistant(scope).validatePatch(override, null);
      }
      const result = this.command(scope.botId, method, raw, () => {
        const created = this.store.createThread(scope.botId, { title, modelOverride: override as never });
        return this.store.getThread(created.botId, created.threadId)!;
      });
      await this.assistant({ botId: result.botId, threadId: result.id }).ready;
      return result;
    }
    if (method === "bots.archive" || method === "bots.restore") {
      fields(raw, ["commandId", "botId", "expectedRevision"]);
      const scope = this.botScope(raw), archive = method === "bots.archive";
      const previous = this.store.commandReceipt(scope.botId, id(raw.commandId), signature({ method, raw }));
      if (previous !== undefined) return previous;
      if (archive && scope.botId === this.store.defaultScope().botId) throw new Error("The default Bot cannot be archived");
      this.prepareArchive(scope.botId, method, raw, this.store.getBot(scope.botId)!.revision);
      if (archive) {
        await this.controlBot(scope, { commandId: `archive:${signature(raw.commandId)}`, action: "pause" });
        for (const thread of this.store.listThreads(scope.botId, true))
          this.assistant({ botId: scope.botId, threadId: thread.id }).discardArchivedWork();
      }
      return this.command(scope.botId, method, raw, () => {
        if (!archive && this.store.getBot(scope.botId)!.archivedAt !== undefined)
          for (const thread of this.store.listThreads(scope.botId, true))
            this.assistant({ botId: scope.botId, threadId: thread.id }).discardArchivedWork();
        return this.store.updateBot(scope.botId, { archivedAt: archive ? Date.now() : undefined });
      });
    }
    const scope = this.scope(raw), { botId: _bot, threadId: _thread, ...params } = raw;
    const runtime = this.assistant(scope);
    if (method === "botThreads.archive" || method === "botThreads.restore") {
      fields(params, ["commandId", "expectedRevision"]);
      const archive = method === "botThreads.archive";
      const previous = this.store.commandReceipt(this.key(scope), id(raw.commandId), signature({ method, raw }));
      if (previous !== undefined) return previous;
      if (archive && scope.threadId === this.store.getBot(scope.botId)!.defaultThreadId)
        throw new Error("The default thread cannot be archived");
      this.prepareArchive(this.key(scope), method, raw, this.store.getThread(scope.botId, scope.threadId)!.revision);
      this.blockedThreads.add(this.key(scope));
      try {
        if (archive) {
          await runtime.rpc("assistant.control", { commandId: `archive:${signature(raw.commandId)}`, action: "cancelTurn" });
          // A failed metadata write must leave automatic work stopped as well.
          runtime.discardArchivedWork();
          runtime.store.update({ lifecycle: "paused" });
        }
        return this.command(this.key(scope), method, raw, () => {
          if (!archive && this.store.getThread(scope.botId, scope.threadId)!.archivedAt !== undefined) {
            // Also retire queued work left by older Hosts before making the
            // thread usable. Bot-level pause and disable gates remain intact.
            runtime.discardArchivedWork();
            runtime.store.update({ lifecycle: "idle", error: undefined, nextRetryAt: undefined });
          }
          return this.store.updateThread(scope.botId, scope.threadId,
            { archivedAt: archive ? Date.now() : undefined });
        });
      } finally {
        this.blockedThreads.delete(this.key(scope));
        this.tick();
      }
    }
    this.assertWritable(scope);
    if (method === "botThreads.configure") {
      fields(params, ["commandId", "expectedRevision", "patch"]);
      const patch = object(params.patch);
      fields(patch, ["title", "modelOverride"]);
      if (patch.title !== undefined) id(patch.title, "title", 200);
      if (patch.modelOverride !== undefined && patch.modelOverride !== null) {
        const override = object(patch.modelOverride);
        fields(override, ["harness", "model", "modelSettings"]);
        await runtime.validatePatch(override, null);
      }
      return this.command(this.key(scope), method, raw, () => this.store.updateThread(scope.botId, scope.threadId,
        patch as never, params.expectedRevision as number | undefined));
    }
    if (method === "botThreads.control") return this.controlBot(scope, params);
    if (method === "botThreads.cancel") {
      fields(params, ["commandId", "expectedGeneration"]);
      return runtime.rpc("assistant.control", { ...params, action: "cancelTurn" });
    }
    if (method === "botThreads.send" && ["delegation", "room"].includes(this.store.getThread(scope.botId, scope.threadId)!.kind))
      throw new Error("Delegation and Room threads accept only their assigned task");
    if (method === "botThreads.send" || method === "botThreads.respond")
      return runtime.rpc(`assistant.${method.slice("botThreads.".length)}`, params);
    throw new Error("Unsupported Bot RPC");
  }

  async close(): Promise<void> {
    this.closing = true;
    this.rooms.close();
    this.delegations.close();
    clearInterval(this.timer);
    if (this.engine.store.onSessionSave === this.observeSession) this.engine.store.onSessionSave = undefined;
    if (this.engine.authorizeAssistantQueued === this.authorizeQueued) this.engine.authorizeAssistantQueued = undefined;
    await Promise.all([...this.runtimes.values()].map(runtime => runtime.close()));
    this.resources.close();
    this.leases.clear();
  }
}
