import { randomUUID } from "node:crypto";
import { mkdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { HostEngine } from "../../engine";
import { HostControl } from "../../control";
import {
  BotThreadStore,
  EVENT_FOOTER,
  receiveSignature,
  signature,
  wakeupSource,
  type BotThreadRecord,
  type Wakeup,
  type WakeupSource,
} from "./store";
import { eventBriefs, importantSources } from "./events";
import { enqueueSchedules, retryDelay } from "./scheduler";
import { checkPolicy, fields, id, object, validatePolicy } from "./policy";
import { followSession, hasBotPermission, isExplicitlyWatchedSession, isWatchedSession, watchIncludesSession } from "../../../src/features/bots/model/botSessions";
import { executeBotAction, BOT_ACTIONS } from "./control";
import { modelsFor } from "../../../src/features/sessions/model/models";
import { RUNTIME_MODES, type TurnOrigin } from "../../../src/features/sessions/model/session";
import {
  isRemoteProvider,
  type HostModelCatalog,
  type HostSession,
  type RemoteProvider,
  type RemoteAttachment,
} from "../../../src/features/connections/model/protocol";
import {
  BOT_PERSONA_PRESETS,
  type BotEventKind,
  type BotPermission,
  type BotPatch,
  type BotMessage,
  type BotReceipt,
} from "../../../src/features/bots/model/botView";
import { parseRemoteAttachments, resolveAttachments } from "../../attachments";
import { rotationReason } from "./rotation";
import { recallBotMemory } from "../recall";
import type { BotDelegation, BotRun, BotRunStatus } from "../../../src/features/bots/model/bots";
import { matchPlaybook } from "./playbooks";
import { dueDiaryDays, enqueueDiaries } from "./diary";
import {
  createHabit,
  deleteHabit,
  habitWakeupText,
  updateHabit,
} from "./habits";
import {
  addMemoryEntry,
  archiveMemoryEntries,
  fitMemoryBudget,
  memoryDate,
  memoryEntry,
  memoryLines,
  topicName,
  withLineEdited,
  withoutLine,
} from "./memory";
import {
  buildBrainPrompt,
  privateReplyPart,
  STEER_PREFIX,
  PERSONA_PRESETS,
  replyMessageId,
  splitReply,
} from "./prompt";

/** Bounds one merged event turn; matches the per-tick source batch. */
const MAX_JOINED_EVENTS = 20;
const MAX_EVENT_REFS = 50;
const MAX_EVENT_BRIEFS = 12;
const STOP_COMMANDS = new Set(["停止", "停", "stop", "/stop"]);
/** A message that is only a stop word ends the turn instead of starting one. */
export function isStopCommand(text: string): boolean {
  return STOP_COMMANDS.has(text.trim().toLowerCase());
}
export type BotThreadRuntimeOptions = {
  entry?: string;
  node?: string;
  store?: BotThreadStore;
  managed?: {
    acquire: (run: BotRun, config: BotThreadRecord) => boolean;
    release: () => void;
    automatic: () => boolean;
    authorizeRun?: (run: BotRun) => boolean;
    stopping?: (run: BotRun) => void;
  };
};
function providerConfiguration(value: { harness: string; model: string; runtimeMode?: string; modelSettings?: Record<string, string> }): string {
  return signature([value.harness, value.model, value.runtimeMode, value.modelSettings ?? {}]);
}
function runtimeConfiguration(value: BotThreadRecord): string {
  return signature([providerConfiguration(value), value.workingDirectory, value.tools]);
}
export class BotThreadRuntime {
  readonly store: BotThreadStore;
  readonly control: HostControl;
  readonly ready: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private active?: Wakeup;
  private activeRun?: BotRun;
  get currentRun(): BotRun | undefined { return this.activeRun && this.store.bots.run(this.store.scope, this.activeRun.id); }
  /** Retains attribution when finalizing a turn throws after clearing active. */
  private tickingWakeupId?: string;
  /** The memory version shown to the brain in the running turn, if any. */
  private injectedMemory?: { generation: number; revision: number; hash: string };
  private diaryCheckedFor?: string;
  private closing = false;
  private ticking = false;
  private epoch = 0;
  private mutations: Promise<unknown> = Promise.resolve();
  /** User inputs currently being delivered into the running turn. */
  private steering = new Set<string>();
  private available: () => Promise<RemoteProvider[]>;
  private catalog: (projectId?: string) => Promise<HostModelCatalog>;
  private catalogs = new Map<
    string,
    { until: number; value: Promise<HostModelCatalog> }
  >();
  private entry?: string;
  private senderName?: string;
  constructor(
    readonly engine: HostEngine,
    providers: RemoteProvider[],
    parentReady: Promise<void>,
    private readonly options: BotThreadRuntimeOptions,
  ) {
    this.entry = options.entry;
    this.store = options.store ?? new BotThreadStore(engine.store);
    this.available = async () => providers;
    this.catalog = async () => ({
      models: Object.fromEntries(providers.map((p) => [p, modelsFor(p)])),
      errors: {},
    });
    this.control = new HostControl(
      async (brain, request, action, input, authorize) => {
        const config = this.store.get();
        if (
          !config ||
          brain !== config.brainSessionId ||
          !this.active ||
          config.lifecycle !== "running" ||
          !config.enabled ||
          (this.currentRun && this.options.managed?.authorizeRun?.(this.currentRun) === false) ||
          !authorize()
        )
          throw new Error("Assistant control is inactive");
        this.assertActionEnabled(action);
        return executeBotAction(this, request, action, input, () => {
          const current = this.store.get();
          return (
            !this.closing &&
            authorize() &&
            !!current?.enabled &&
            (!this.currentRun || this.options.managed?.authorizeRun?.(this.currentRun) !== false) &&
            current.lifecycle === "running" &&
            current.brainSessionId === brain &&
            !!this.active
          );
        });
      },
      { namespace: "assistant", actions: BOT_ACTIONS },
    );
    if (!options.managed) engine.authorizeAssistantQueued = (origin, project, sessionId) => {
      const current = this.store.get();
      if (!current?.enabled || current.id !== origin.assistantId) return false;
      try {
        this.checkSessionAccess("sessions.send", project, sessionId);
        return true;
      } catch {
        return false;
      }
    };
    if (!options.managed) engine.store.onSessionSave = (previous, next, event) =>
      this.observe(previous, next, event);
    this.ready = Promise.all([parentReady, this.control.ready]).then(() => {
      this.store.host.transaction(() => {
        this.store.bots.interruptRuns(this.store.scope);
        this.store.recover();
        const config = this.store.get();
        if (config?.lifecycle === "interrupted" && config.enabled && !config.paused &&
            this.store.wakeups().some(wakeup => wakeup.state === "pending" || wakeup.state === "backoff"))
          this.store.update({ lifecycle: "idle", brainSessionId: undefined, brainBaseline: undefined, brainGeneration: config.brainGeneration + 1 });
        this.syncQueuedRuns();
      });
      if (options.managed) return;
      this.timer = setInterval(() => {
        void this.tick().catch((error) => this.fail(error));
      }, 1000);
      this.timer.unref?.();
    });
  }
  agentBots(authorize: () => boolean = () => true) {
    if (!authorize()) throw new Error("Assistant control is inactive");
    return this.engine.bots.delegations.listBots(this);
  }
  async askBot(requestId: string, input: Record<string, unknown>, authorize: () => boolean): Promise<BotDelegation> {
    if (!authorize()) throw new Error("Assistant control is inactive");
    const value = await this.engine.bots.delegations.submit(this, requestId, input);
    const result = value.status === "running" ? await this.engine.bots.delegations.wait(this, value.id) : value;
    if (!authorize()) throw new Error("Assistant control is inactive");
    return result;
  }
  assertActionEnabled(action: string): void {
    const enabled = this.currentRun?.config?.tools?.enabledActions;
    if (enabled && !enabled.includes(action)) throw new Error("This action is not enabled for the current Bot run");
  }
  setCatalog(
    available: () => Promise<RemoteProvider[]>,
    catalog: (projectId?: string) => Promise<HostModelCatalog>,
  ): void {
    this.available = available;
    this.catalog = catalog;
    this.catalogs.clear();
  }
  models(projectId?: string) {
    const key = projectId ?? "";
    const cached = this.catalogs.get(key);
    if (cached && cached.until > Date.now()) return cached.value;
    const value = this.catalog(projectId).catch((error) => {
      this.catalogs.delete(key);
      throw error;
    });
    this.catalogs.set(key, { until: Date.now() + 300000, value });
    return value;
  }
  providers() {
    return this.available();
  }
  /** Manager ticks every thread; each Bot shares one execution lease in phase 2. */
  async managedTick(): Promise<void> {
    try { await this.ready; await this.tick(); } catch (error) { this.fail(error); }
  }
  environment(brain: string): Record<string, string> {
    const value = this.store.get();
    return value?.brainSessionId === brain &&
      value.enabled &&
      value.lifecycle === "running"
      ? this.control.environment(brain)
      : {};
  }
  currentWakeup(): Wakeup {
    if (!this.active) throw new Error("Assistant turn is inactive");
    return this.active;
  }
  async rpc(method: string, raw: Record<string, unknown>): Promise<unknown> {
    await this.ready;
    if (method === "assistant.get") {
      fields(raw, []);
      return this.store.view();
    }
    if (method === "assistant.messages") {
      fields(raw, ["afterRevision", "limit", "latest", "before"]);
      if (raw.latest !== undefined) {
        if (raw.latest !== true || raw.afterRevision !== undefined)
          throw new Error("Invalid history cursor");
        const before = raw.before === undefined ? undefined : object(raw.before);
        if (before) fields(before, ["createdAt", "id"]);
        return this.store.history(
          before ? { createdAt: before.createdAt as number, id: before.id as string } : undefined,
          raw.limit === undefined ? 30 : Number(raw.limit),
        );
      }
      if (raw.before !== undefined) throw new Error("Invalid history cursor");
      return this.store.messages(
        raw.afterRevision === undefined ? 0 : Number(raw.afterRevision),
        raw.limit === undefined ? 50 : Number(raw.limit),
      );
    }
    if (method === "assistant.memory") {
      fields(raw, []);
      if (!this.store.get()) return null;
      const doc = this.store.memoryDoc("memory");
      return {
        revision: doc.revision,
        facts: memoryLines(doc.text),
        topics: this.store.memoryTopics(),
      };
    }
    if (method === "assistant.memoryTopic") {
      fields(raw, ["topic"]);
      const name = topicName(id(raw.topic, "topic", 80));
      if (!this.store.get()) return null;
      const doc = this.store.memoryDoc(`topic:${name}`);
      return doc.text ? { name, ...doc } : null;
    }
    return this.mutate(() => this.mutateRpc(method, raw));
  }
  private mutate<T>(run: () => Promise<T>): Promise<T> {
    const next = this.mutations.then(run);
    this.mutations = next.catch(() => undefined);
    return next;
  }
  /** Only the Host's authenticated IM binding may assign this trusted source. */
  async receiveImMessage(input: {
    commandId: string;
    text: string;
    attachments?: RemoteAttachment[];
    bindingId: string;
  }): Promise<BotReceipt> {
    await this.ready;
    fields(input, ["commandId", "text", "attachments", "bindingId"]);
    const { bindingId, ...message } = input;
    const source: WakeupSource = { kind: "im", bindingId: id(bindingId, "IM binding") };
    return this.mutate(() => this.receiveMessage(message, source));
  }
  private async receiveMessage(
    raw: Record<string, unknown>,
    source: WakeupSource,
  ): Promise<BotReceipt> {
    fields(raw, ["commandId", "text", "attachments"]);
    const text =
      typeof raw.text === "string" &&
      raw.text.length <= 1000000 &&
      !raw.text.includes("\0")
        ? raw.text
        : undefined;
    const attachments = parseRemoteAttachments(raw.attachments);
    if (text === undefined || (!text.trim() && !attachments.length))
      throw new Error("Write a message");
    const previous = this.store.receipt(
      id(raw.commandId),
      receiveSignature(text, attachments, source),
    );
    if (previous) return previous as BotReceipt;
    const config = this.store.get();
    if (this.closing || !config?.enabled || !config.triggers.user)
      throw new Error("Assistant messaging is disabled");
    if (!attachments.length && isStopCommand(text) && this.hasWorkToStop()) {
      const receipt = this.store.receive(id(raw.commandId), text, attachments, source, {
        enqueue: false,
      });
      await this.cancelTurn();
      return receipt;
    }
    resolveAttachments(this.engine.store, attachments);
    const receipt = this.store.receive(id(raw.commandId), text, attachments, source);
    if (!config.paused && ["interrupted", "failed"].includes(config.lifecycle))
      this.store.update({ lifecycle: "idle", error: undefined, brainSessionId: undefined, brainBaseline: undefined, brainGeneration: config.brainGeneration + 1 });
    this.syncQueuedRuns();
    // Attachments keep the queued path; provider steering differs for files.
    if (!attachments.length && receipt.wakeupId)
      await this.steerInput(receipt.wakeupId, text);
    void this.tick().catch((error) => this.fail(error));
    return receipt;
  }
  private async mutateRpc(
    method: string,
    raw: Record<string, unknown>,
  ): Promise<unknown> {
    if (method === "assistant.configure") return this.configure(raw);
    if (method === "assistant.send")
      return this.receiveMessage(raw, { kind: "client" });
    if (method === "assistant.respond") {
      fields(raw, [
        "commandId",
        "messageId",
        "brainGeneration",
        "runId",
        "requestId",
        "decision",
        "reply",
      ]);
      const commandId = id(raw.commandId),
        sig = signature({ method, raw });
      const previous = this.store.receipt(commandId, sig);
      if (previous) return previous;
      const config = this.store.get(),
        message = this.store
          .latestMessages()
          .find((m) => m.id === raw.messageId);
      if (
        !config ||
        !message ||
        message.kind !== "input" ||
        message.resolved ||
        config.brainGeneration !== raw.brainGeneration ||
        message.brainGeneration !== raw.brainGeneration ||
        message.runId !== raw.runId ||
        message.requestId !== raw.requestId
      )
        throw new Error("This input is no longer pending");
      return this.store.host.transaction(() => {
        const result = this.engine.assistantCommand({
          type: message.inputKind === "approval" ? "approve" : "answer",
          commandId: this.options.managed
            ? `assistant:human:${signature({ scope: this.store.scope, commandId })}`
            : `assistant:human:${commandId}`,
          sessionId: config.brainSessionId,
          runId: raw.runId,
          requestId: raw.requestId,
          ...(message.inputKind === "approval"
            ? { decision: raw.decision }
            : { reply: raw.reply }),
        });
        this.store.recordReceipt(commandId, sig, result);
        return result;
      });
    }
    if (method === "assistant.control") {
      if (raw.action === "delegateSession") return this.delegateSession(raw);
      fields(raw, [
        "commandId",
        "action",
        "expectedGeneration",
        "reminderId",
        "fact",
        "index",
        "expectedRevision",
        "habitId",
        "habit",
      ]);
      const commandId = id(raw.commandId),
        sig = signature({ method, raw });
      const previous = this.store.receipt(commandId, sig);
      if (previous) return previous;
      const config = this.store.get();
      if (!config) throw new Error("Assistant is not configured");
      if (
        raw.expectedGeneration !== undefined &&
        raw.expectedGeneration !== config.brainGeneration
      )
        throw new Error("Assistant generation changed");
      if (
        raw.action === "addMemory" ||
        raw.action === "editMemory" ||
        raw.action === "forgetMemory"
      )
        return this.store.host.transaction(() => {
          const date = memoryDate(new Date(), config.timezone ?? "UTC");
          const doc = this.store.memoryDoc("memory");
          if (
            raw.action !== "addMemory" &&
            raw.expectedRevision !== doc.revision
          )
            throw new Error("Memory changed elsewhere. Reload before saving.");
          const index = Number(raw.index);
          if (
            raw.action !== "addMemory" &&
            !memoryLines(doc.text).some((line) => line.index === index)
          )
            throw new Error("Memory entry not found");
          let text: string, keep: string | undefined;
          if (raw.action === "forgetMemory") text = withoutLine(doc.text, index);
          else {
            const fact = id(raw.fact, "fact", 1000);
            if (raw.action === "addMemory") {
              keep = memoryEntry(fact, date);
              text = addMemoryEntry(doc.text, keep).text;
            } else {
              text = withLineEdited(doc.text, index, fact, date);
              keep = text.split("\n")[index];
            }
          }
          const fitted = fitMemoryBudget(text, keep, date);
          if (fitted.moved.length)
            this.store.writeMemoryDoc(
              "archive",
              archiveMemoryEntries(
                this.store.memoryDoc("archive").text,
                fitted.moved,
                date,
              ),
            );
          const memoryRevision = this.store.writeMemoryDoc(
            "memory",
            fitted.text,
            doc.revision,
          );
          const receipt = {
            commandId,
            revision: this.store.get()!.revision,
            memoryRevision,
          };
          this.store.recordReceipt(commandId, sig, receipt);
          return receipt;
        });
      if (
        ["createHabit", "updateHabit", "deleteHabit", "runHabit"].includes(
          String(raw.action),
        )
      )
        return this.store.host.transaction(() => {
          const current = this.store.get()!,
            habits = current.habits ?? [],
            now = Date.now(),
            timeZone = current.timezone ?? "UTC";
          if (raw.action === "createHabit")
            this.store.update({
              habits: createHabit(habits, raw.habit, now, timeZone).habits,
            });
          else {
            const habitId = id(raw.habitId, "habit ID");
            const habit = habits.find((h) => h.id === habitId);
            if (!habit) throw new Error("Habit not found");
            if (raw.action === "updateHabit")
              this.store.update({
                habits: updateHabit(habits, habitId, raw.habit, now, timeZone),
              });
            else if (raw.action === "deleteHabit")
              this.store.update({ habits: deleteHabit(habits, habitId) });
            else {
              // An extra run now; the schedule stays as it is.
              const rootCauseId = `habit:${habitId}:run:${commandId}`;
              this.store.enqueue(
                {
                  id: randomUUID(),
                  kind: "schedule",
                  text: habitWakeupText(habit),
                  rootCauseId,
                  state: "pending",
                  createdAt: now,
                  attempts: 0,
                  habitId,
                },
                rootCauseId,
              );
            }
          }
          const receipt = { commandId, revision: this.store.get()!.revision };
          this.store.recordReceipt(commandId, sig, receipt);
          return receipt;
        });
      if (raw.action === "cancelReminder") {
        const reminderId = id(raw.reminderId, "reminder ID");
        return this.store.host.transaction(() => {
          const current = this.store.get()!;
          if (
            !current.reminders?.some(
              (r) => r.id === reminderId && r.state === "pending",
            )
          )
            throw new Error("Reminder is not pending");
          this.store.update({
            reminders: current.reminders.map((r) =>
              r.id === reminderId ? { ...r, state: "cancelled" as const } : r,
            ),
          });
          const receipt = { commandId, revision: this.store.get()!.revision };
          this.store.recordReceipt(commandId, sig, receipt);
          return receipt;
        });
      }
      if (
        !["pause", "resume", "disable", "enable", "cancelTurn"].includes(
          String(raw.action),
        )
      )
        throw new Error("Unsupported assistant control");
      if (raw.action === "cancelTurn") {
        await this.cancelTurn();
        const receipt = { commandId, revision: this.store.get()!.revision };
        this.store.recordReceipt(commandId, sig, receipt);
        void this.tick().catch((error) => this.fail(error));
        return receipt;
      }
      if (["pause", "disable"].includes(String(raw.action)))
        await this.stopBrain();
      this.store.host.transaction(() => {
        const lifecycle =
          raw.action === "disable"
            ? "disabled"
            : raw.action === "pause"
              ? "paused"
              : "idle";
        this.store.update({
          enabled: raw.action !== "disable",
          lifecycle,
          error: undefined,
          nextRetryAt: undefined,
        });
        if ((raw.action === "resume" || raw.action === "enable") &&
            !["delegation", "room"].includes(this.store.bots.getThread(this.store.botId, this.store.threadId)?.kind ?? "direct")) {
          this.store.resumeChains();
          const recovery = ["interrupted", "paused", "failed"].includes(
            config.lifecycle,
          )
            ? this.store
                .wakeups()
                .filter((w) => w.state === "interrupted")
                .at(-1)
            : undefined;
          if (recovery) {
            const next = randomUUID();
            this.store.enqueue(
              {
                ...recovery,
                source: wakeupSource(recovery),
                id: next,
                kind: "user",
                state: "pending",
                text: `Explicitly resume this interrupted task. Inspect actions.get and existing sessions before doing anything. Do not replay unknown effects.\n${recovery.text}`,
                createdAt: Date.now(),
                attempts: 0,
              },
              `recovery:${next}`,
            );
            this.store.saveWakeup({ ...recovery, state: "completed" });
            this.store.writeChain(recovery.rootCauseId, {
              count: 0,
              paused: false,
              startedAt: Date.now(),
            });
          }
        }
        const receipt = { commandId, revision: this.store.get()!.revision };
        this.store.recordReceipt(commandId, sig, receipt);
      });
      void this.tick().catch((error) => this.fail(error));
      return this.store.receipt(commandId, sig);
    }
    throw new Error("Unsupported assistant RPC");
  }
  /** Human-created conversations are read-only until explicitly followed. */
  canManageSession(projectId: string, sessionId: string): boolean {
    const config = this.store.get();
    if (!config) return false;
    let session: HostSession;
    try { session = this.engine.store.session(sessionId); } catch { return false; }
    if (session.projectId !== projectId || session.session.assistantOwnerId) return false;
    if (isWatchedSession(config.policy, config.watches, projectId, sessionId) || this.store.createdSession(sessionId)) return true;
    const leadId = session.session.orchestrationLeadId;
    return !!leadId && (this.store.createdSession(leadId) ||
      (!config.policy.excludedSessionIds?.includes(sessionId) && isWatchedSession(config.policy, config.watches, projectId, leadId)));
  }
  checkSessionAccess(permission: BotPermission, projectId?: string, sessionId?: string): void {
    checkPolicy(this.store.get()!.policy, permission, projectId);
    if (projectId && sessionId &&
        ((permission.startsWith("sessions.") && !["sessions.read", "sessions.create"].includes(permission)) || permission === "orchestration.control") &&
        !this.canManageSession(projectId, sessionId))
      throw new Error("Conversation is read-only until the user hands it over to the assistant");
  }
  private delegateSession(raw: Record<string, unknown>): unknown {
    fields(raw, ["action", "commandId", "environmentId", "projectId", "sessionId"]);
    const commandId = id(raw.commandId);
    const sig = signature({ method: "delegateSession", raw });
    const previous = this.store.receipt(commandId, sig);
    if (previous) return previous;
    const config = this.store.get();
    if (!config?.enabled || config.lifecycle === "paused")
      throw new Error("Enable or resume the assistant before handing over a conversation.");
    if (raw.environmentId !== this.engine.store.environmentId)
      throw new Error("Wrong Host environment");
    const projectId = id(raw.projectId), sessionId = id(raw.sessionId);
    const session = this.engine.store.session(sessionId);
    if (session.projectId !== projectId) throw new Error("Session does not belong to this project");
    if (session.session.assistantOwnerId || this.engine.store.project(projectId).kind)
      throw new Error("Assistant brain is private");
    checkPolicy(config.policy, "sessions.read", projectId);
    const grants = config.policy.followedSessions ?? [];
    if (grants.length >= 10000 && !isExplicitlyWatchedSession(config.policy, projectId, sessionId))
      throw new Error("Too many delegated conversations");
    const result = this.engine.store.transaction(() => {
      const wakeupId = randomUUID();
      this.store.update({
        policy: followSession(config.policy, projectId, sessionId),
        policyVersion: config.policyVersion + 1,
        triggers: { ...config.triggers, event: true },
      }, true);
      this.store.enqueue({
        id: wakeupId, kind: "user", source: { kind: "client" },
        text: `The user handed this conversation to you: projectId=${projectId}, sessionId=${sessionId}. It is now followed and can use the permissions enabled in your settings. Start from its latest page (sessions.get with latest:true) and page back through earlier blocks (smaller offsets) only until the user's goals and the current state are clear, then continue those goals. Handle its messages, approvals and questions within your configured permissions. Do not invent a new task if the conversation is already complete.`,
        rootCauseId: wakeupId, state: "pending", createdAt: Date.now(), attempts: 0, refs: [sessionId],
      }, `delegate:${commandId}`);
      const receipt = { commandId, revision: this.store.get()!.revision, wakeupId };
      this.store.recordReceipt(commandId, sig, receipt);
      return receipt;
    });
    void this.tick().catch((error) => this.fail(error));
    return result;
  }
  async validatePatch(rawPatch: unknown, current: BotThreadRecord | null = this.store.get()): Promise<BotPatch> {
    const patch = { ...object(rawPatch) };
    fields(patch, [
      "name",
      "avatar",
      "persona",
      "timezone",
      "harness",
      "model",
      "modelSettings",
      "workingDirectory",
      "maxConcurrentRuns",
      "tools",
      "callableBotIds",
      "runtimeMode",
      "targetRuntimeMode",
      "policy",
      "triggers",
      "schedules",
      "watches",
      "maxAutoTurns",
      "chainWindowMinutes",
    ]);
    if (patch.name !== undefined) id(patch.name, "name", 100);
    if (patch.avatar !== undefined) {
      if (typeof patch.avatar !== "string" || /[\u0000-\u001f\u007f-\u009f]/u.test(patch.avatar) || [...patch.avatar.trim()].length > 8)
        throw new Error("Avatar must be at most 8 characters without control characters");
      patch.avatar = patch.avatar.trim() || undefined;
    }
    if (patch.maxConcurrentRuns !== undefined && (!Number.isSafeInteger(patch.maxConcurrentRuns) || Number(patch.maxConcurrentRuns) < 1 || Number(patch.maxConcurrentRuns) > 10))
      throw new Error("Concurrent run limit must be between 1 and 10");
    if (patch.workingDirectory !== undefined && patch.workingDirectory !== null) {
      const directory = id(patch.workingDirectory, "working directory", 4000);
      if (!isAbsolute(directory) || !(await stat(directory)).isDirectory()) throw new Error("Working directory must be an existing absolute directory");
      patch.workingDirectory = await realpath(directory);
    }
    if (patch.callableBotIds !== undefined && (!Array.isArray(patch.callableBotIds) ||
        patch.callableBotIds.length > 100 || new Set(patch.callableBotIds).size !== patch.callableBotIds.length ||
        patch.callableBotIds.some(botId => typeof botId !== "string" || botId === current?.id || !this.store.bots.getBot(botId))))
      throw new Error("Callable Bots must be existing Bots on this Host and cannot include this Bot");
    if (patch.tools !== undefined) {
      const tools = object(patch.tools);
      fields(tools, ["enabledActions", "computer"]);
      if ((tools.computer !== undefined && typeof tools.computer !== "boolean") ||
          (tools.enabledActions !== undefined && (!Array.isArray(tools.enabledActions) ||
            tools.enabledActions.some(action => !BOT_ACTIONS.includes(action as never)) ||
            new Set(tools.enabledActions).size !== tools.enabledActions.length))) throw new Error("Invalid Bot tools configuration");
    }
    if (patch.persona !== undefined) {
      const persona = object(patch.persona);
      fields(persona, ["preset", "style", "userName"]);
      if (
        !BOT_PERSONA_PRESETS.includes(persona.preset as never) ||
        typeof persona.style !== "string" ||
        persona.style.length > 4000 ||
        persona.style.includes("\0") ||
        (persona.userName !== undefined &&
          (typeof persona.userName !== "string" ||
            persona.userName.length > 100 ||
            persona.userName.includes("\0")))
      )
        throw new Error("Invalid personality");
    }
    if (patch.timezone !== undefined)
      new Intl.DateTimeFormat("en", {
        timeZone: id(patch.timezone, "timezone"),
      });
    if (patch.harness !== undefined && !isRemoteProvider(patch.harness))
      throw new Error("Agent is unavailable");
    if (patch.model !== undefined) id(patch.model, "model", 200);
    const harness = patch.harness ?? current?.harness;
    const model = patch.model ?? current?.model;
    if (
      (!current || harness !== current.harness || model !== current.model) &&
      (!harness ||
        !model ||
        !(await this.providers()).includes(harness as RemoteProvider) ||
        !(await this.models()).models[harness as RemoteProvider]?.some(
          (m) => m.id === model,
        ))
    )
      throw new Error("Choose an available agent and model");
    for (const key of ["runtimeMode", "targetRuntimeMode"])
      if (
        patch[key] !== undefined &&
        !RUNTIME_MODES.includes(patch[key] as never)
      )
        throw new Error("Invalid execution permission mode");
    if (patch.modelSettings !== undefined) {
      const settings = object(patch.modelSettings);
      if (
        Object.entries(settings).some(
          ([key, value]) =>
            !/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(key) ||
            typeof value !== "string" ||
            value.length > 128,
        )
      )
        throw new Error("Invalid model settings");
    }
    if (patch.policy !== undefined) {
      patch.policy = validatePolicy(patch.policy);
      const scope = (patch.policy as BotPatch["policy"])!.allowedProjects;
      if (scope !== "all")
        for (const project of scope)
          if (this.engine.store.project(project).kind)
            throw new Error("Invalid project scope");
      const followedProjects = (patch.policy as BotPatch["policy"])!.followedProjects;
      if (followedProjects && followedProjects !== "all")
        for (const project of followedProjects)
          if (this.engine.store.project(project).kind) throw new Error("Invalid followed projects");
      for (const ref of (patch.policy as BotPatch["policy"])!.followedSessions ?? []) {
        if (current && isExplicitlyWatchedSession(current.policy, ref.projectId, ref.sessionId)) continue;
        const target = this.engine.store.session(ref.sessionId);
        if (target.projectId !== ref.projectId || target.session.assistantOwnerId || this.engine.store.project(ref.projectId).kind)
          throw new Error("Invalid conversation grant");
      }
    }
    if (patch.triggers !== undefined) {
      const triggers = object(patch.triggers);
      fields(triggers, ["user", "event", "schedule"]);
      if (
        ["user", "event", "schedule"].some(
          (k) => typeof triggers[k] !== "boolean",
        )
      )
        throw new Error("Invalid triggers");
    }
    for (const [key, max] of [
      ["maxAutoTurns", 100],
      ["chainWindowMinutes", 1440],
    ] as const)
      if (
        patch[key] !== undefined &&
        (!Number.isSafeInteger(patch[key]) ||
          Number(patch[key]) < 1 ||
          Number(patch[key]) > max)
      )
        throw new Error("Invalid automatic chain limit");
    if (patch.schedules !== undefined) {
      if (!Array.isArray(patch.schedules) || patch.schedules.length > 20)
        throw new Error("Invalid schedules");
      for (const s of patch.schedules) {
        const schedule = object(s);
        fields(schedule, [
          "id",
          "enabled",
          "intervalMinutes",
          "prompt",
          "timezone",
          "nextRunAt",
        ]);
        id(schedule.id);
        id(schedule.prompt, "scheduled prompt", 10000);
        new Intl.DateTimeFormat("en", {
          timeZone: id(schedule.timezone, "timezone"),
        });
        if (
          typeof schedule.enabled !== "boolean" ||
          !Number.isSafeInteger(schedule.intervalMinutes) ||
          Number(schedule.intervalMinutes) < 1 ||
          Number(schedule.intervalMinutes) > 10080 ||
          !Number.isSafeInteger(schedule.nextRunAt) ||
          Number(schedule.nextRunAt) < 0
        )
          throw new Error("Invalid schedule");
      }
    }
    if (patch.watches !== undefined) {
      if (!Array.isArray(patch.watches) || patch.watches.length > 50)
        throw new Error("Invalid watches");
      for (const s of patch.watches) {
        const watch = object(s);
        fields(watch, [
          "id",
          "enabled",
          "projectIds",
          "sessionIds",
          "eventKinds",
          "prompt",
        ]);
        id(watch.id);
        id(watch.prompt, "watch prompt", 10000);
        if (
          typeof watch.enabled !== "boolean" ||
          !Array.isArray(watch.projectIds) ||
          !Array.isArray(watch.sessionIds) ||
          !Array.isArray(watch.eventKinds) ||
          watch.eventKinds.some(
            (k) =>
              ![
                "completed",
                "failed",
                "approval",
                "question",
                "interrupted",
              ].includes(String(k)),
          )
        )
          throw new Error("Invalid watch");
        for (const project of watch.projectIds)
          this.engine.store.project(id(project));
        for (const session of watch.sessionIds)
          this.engine.store.session(id(session));
      }
    }
    return patch as BotPatch;
  }
  private async configure(raw: Record<string, unknown>): Promise<unknown> {
    fields(raw, ["commandId", "expectedRevision", "patch"]);
    const commandId = id(raw.commandId),
      sig = signature({ method: "configure", raw });
    const previous = this.store.receipt(commandId, sig);
    if (previous) return previous;
    const current = this.store.get();
    if ((current?.revision ?? 0) !== raw.expectedRevision)
      throw new Error("Assistant settings changed. Reload before saving.");
    const defaults = this.options.managed && current ? this.store.bots.getBot(current.id) : null;
    const patch = await this.validatePatch(raw.patch, defaults && current
      ? { ...current, harness: defaults.harness, model: defaults.model, modelSettings: defaults.modelSettings }
      : current);
    if ((this.store.get()?.revision ?? 0) !== raw.expectedRevision)
      throw new Error("Assistant settings changed. Reload before saving.");
    if (
      current && !this.options.managed &&
      ((patch.harness !== undefined && patch.harness !== current.harness) ||
        (patch.model !== undefined && patch.model !== current.model) ||
        (patch.runtimeMode !== undefined &&
          patch.runtimeMode !== current.runtimeMode) ||
        (patch.modelSettings !== undefined &&
          signature(patch.modelSettings) !== signature(current.modelSettings)))
    ) {
      await this.stopBrain();
      const now = this.store.get()!;
      this.store.update({
        brainSessionId: undefined,
        brainBaseline: undefined,
        brainGeneration: now.brainGeneration + 1,
        lifecycle: now.enabled ? "idle" : "disabled",
      });
    }
    return this.engine.store.transaction(() => {
      const { workingDirectory, ...configuration } = patch;
      if (!current) this.store.initialize(patch as BotPatch);
      else
        this.store.update(
          {
            ...configuration,
            ...("workingDirectory" in patch ? { workingDirectory: workingDirectory ?? undefined } : {}),
            policyVersion:
              this.store.get()!.policyVersion + (patch.policy ? 1 : 0),
          },
          true,
        );
      const result = { commandId, revision: this.store.get()!.revision };
      this.store.recordReceipt(commandId, sig, result);
      return result;
    });
  }
  private async brain(): Promise<string | undefined> {
    const config = this.store.get()!;
    if (config.brainSessionId) return config.brainSessionId;
    const cwd = config.workingDirectory ?? (this.options.managed
      ? join(dirname(this.engine.store.attachmentDir), "bots", config.id, "threads", this.store.threadId, String(config.brainGeneration))
      : join(dirname(this.engine.store.attachmentDir), "assistant-workspace", config.id, String(config.brainGeneration)));
    if (!config.workingDirectory) await mkdir(cwd, { recursive: true, mode: 0o700 });
    const current = this.store.get();
    if (
      !current?.enabled ||
      current.paused ||
      current.brainGeneration !== config.brainGeneration ||
      runtimeConfiguration(current) !== runtimeConfiguration(config) ||
      ["paused", "disabled", "interrupted", "failed"].includes(
        current.lifecycle,
      )
    )
      return undefined;
    return this.engine.store.transaction(() => {
      const project = this.engine.store.addProject(
        cwd,
        "Assistant",
        "assistant",
      );
      const receipt = this.engine.assistantCommand({
        type: "create",
        commandId: this.options.managed
          ? `assistant:brain:${config.id}:${this.store.threadId}:${config.brainGeneration}`
          : `assistant:brain:${config.id}:${config.brainGeneration}`,
        projectId: project.id,
        harness: config.harness,
        model: config.model,
        runtimeMode: config.runtimeMode,
        modelSettings: config.modelSettings,
      });
      const session = this.engine.store.session(receipt.sessionId);
      this.engine.store.save(
        {
          ...session,
          revision: session.revision + 1,
          session: {
            ...session.session,
            assistantOwnerId: config.id,
            title: "Assistant",
          },
        },
        { type: "assistant.brain" },
      );
      this.store.update({ brainSessionId: receipt.sessionId });
      return receipt.sessionId;
    });
  }
  /** Archival ends old queued work; restoration only permits new work. */
  discardArchivedWork(): void {
    this.store.host.transaction(() => {
      this.store.discardPendingUserInput();
      for (const wakeup of this.store.wakeups())
        if (["pending", "backoff"].includes(wakeup.state))
          this.store.saveWakeup({ ...wakeup, state: "completed" });
      this.syncQueuedRuns();
    });
  }
  private syncQueuedRuns(): void {
    if (!this.store.get()) return;
    this.store.host.transaction(() => {
      const wakeups = new Map(this.store.wakeups().map(wakeup => [wakeup.id, wakeup]));
      for (const wakeup of wakeups.values())
        if (wakeup.state === "pending" || wakeup.state === "backoff") this.store.bots.queuedRun(this.store.scope, wakeup);
      for (const run of this.store.bots.queuedRuns(this.store.scope)) {
        const wakeup = wakeups.get(run.wakeupId);
        if (wakeup && ["pending", "backoff", "running"].includes(wakeup.state)) continue;
        this.store.bots.updateRun(this.store.scope, run.id, {
          status: wakeup?.mergedInto ? "completed" : wakeup?.state === "interrupted" ? "interrupted" : "cancelled",
          mergedInto: wakeup?.mergedInto, endedAt: Date.now(),
        });
      }
    });
  }
  private updateRun(patch: Parameters<BotThreadStore["bots"]["updateRun"]>[2]): void {
    if (this.activeRun) this.activeRun = this.store.bots.updateRun(this.store.scope, this.activeRun.id, patch);
  }
  private finishRun(status: BotRunStatus, error?: string): void {
    this.updateRun({ status, endedAt: Date.now(), error });
    if (this.activeRun) this.options.managed?.stopping?.(this.activeRun);
    this.activeRun = undefined;
  }
  async tick(): Promise<void> {
    if (this.closing || this.ticking) return;
    this.ticking = true;
    this.tickingWakeupId = this.active?.id;
    const epoch = this.epoch;
    try {
      let config = this.store.get();
      this.syncQueuedRuns();
      if (config) {
        const senderName = JSON.stringify([config.id, config.name]);
        if (this.senderName !== senderName) {
          this.engine.refreshAssistantSenderName(config.id, config.name);
          this.senderName = senderName;
        }
      }
      if (
        !config?.enabled ||
        ["paused", "disabled", "interrupted", "failed"].includes(
          config.lifecycle,
        )
      )
        return;
      if (this.active) {
        const brain = this.engine.store.session(config.brainSessionId!);
        if (brain.status === "running") return;
        const wakeup = this.active;
        this.active = undefined;
        this.control.disable(config.brainSessionId!);
        // Steered follow-ups are part of the same turn as the wakeup prompt.
        const turn = brain.session.blocks.slice(
          brain.session.blocks.findLastIndex(
            (b) => b.role === "user" && !b.text.startsWith(STEER_PREFIX),
          ) + 1,
        );
        // An explicit attachment publication is meaningful even if the final
        // model text is the quiet marker (there is nothing else to add).
        let posted = this.store.latestMessages().some((message) =>
          message.kind === "assistant" && message.wakeupId === wakeup.id &&
          (!!message.text.trim() || !!message.attachments?.length));
        if (wakeup.kind !== "user") {
          const reply = turn.findLast(
            (b) => b.role === "assistant" && b.text.trim(),
          );
          if (reply)
            splitReply(reply.text).forEach((part, index) => {
              if (privateReplyPart(part, false)) return;
              posted = true;
              this.store.message({
                id: replyMessageId(config!.brainGeneration, reply.id, index),
                kind: "assistant",
                text: part,
                streaming: false,
                wakeupId: wakeup.id,
              });
            });
        }
        this.store.update({ activity: undefined });
        let error =
          turn.findLast((b) => b.notice === "error")?.text ??
          (brain.status === "interrupted"
            ? (brain.session.blocks.at(-1)?.text ??
              "Assistant turn interrupted")
            : undefined);
        const actions = this.store
          .actions()
          .filter((a) => a.origin.wakeupId === wakeup.id);
        const hasExecution =
          actions.length ||
          turn.some((b) => b.role === "tool" || b.role === "assistant");
        if (brain.session.usageLimit && !hasExecution) {
          const retryAt = Math.max(
            Date.now() + retryDelay(wakeup.attempts),
            brain.session.usageLimit.resetsAt ?? 0,
          );
          this.store.saveWakeup({ ...wakeup, state: "backoff", retryAt });
          this.store.update({
            lifecycle: "backoff",
            nextRetryAt: retryAt,
            error: error ?? "Usage limit reached",
          });
          this.finishRun("interrupted", error ?? "Usage limit reached before execution; retry queued.");
          return;
        }
        if (brain.session.usageLimit && hasExecution)
          error ??=
            "Usage limit reached after partial execution. Continue after inspecting its actions.";
        this.store.saveWakeup({
          ...wakeup,
          state: error ? "interrupted" : "completed",
        });
        if (wakeup.habitId)
          this.store.update({
            habits: (this.store.get()!.habits ?? []).map((habit) =>
              habit.id === wakeup.habitId
                ? {
                    ...habit,
                    lastRunAt: wakeup.createdAt,
                    lastOutcome: error ? "failed" : posted ? "posted" : "quiet",
                  }
                : habit,
            ),
          });
        this.store.update({
          lifecycle: error ? "interrupted" : "idle",
          error,
          // Memory shown in a finished turn is part of the brain's context now.
          ...(!error && this.injectedMemory
            ? { brainMemory: this.injectedMemory }
            : {}),
          // The first reading of a generation is the closest to an empty brain.
          ...(config.brainBaseline == null && brain.session.context?.used
            ? { brainBaseline: brain.session.context.used }
            : {}),
        });
        this.finishRun(error ? "interrupted" : "completed", error);
        this.options.managed?.release();
        if (error) {
          this.store.message({
            id: randomUUID(),
            kind: "status",
            code: "interrupted",
            text: error,
            wakeupId: wakeup.id,
          });
          return;
        }
        config = this.store.get()!;
      }
      const automatic = this.options.managed?.automatic() ?? true;
      if (automatic) enqueueSchedules(this.store);
      // Finished days are checked once per day, not on every tick.
      const diaryDay = dueDiaryDays(Date.now(), config.timezone ?? "UTC").at(-1);
      if (automatic && diaryDay !== this.diaryCheckedFor && enqueueDiaries(this.store))
        this.diaryCheckedFor = diaryDay;
      config = this.store.get()!;
      if (automatic && config.triggers.event)
        this.engine.store.transaction(() => {
          const sources = this.store
            .sources(config!.sourceCursor, 50)
            .filter((s) => s.createdAt <= Date.now() - 2000);
          if (!sources.length) return;
          const groups = new Map<string, typeof sources>();
          for (const source of sources) {
            if (config!.policy.excludedSessionIds?.includes(source.sessionId)) continue;
            const managed = isWatchedSession(config!.policy, config!.watches, source.projectId, source.sessionId);
            const watches = config!.watches.filter((w) =>
              w.eventKinds.includes(source.kind as BotEventKind) &&
              watchIncludesSession(w, source.projectId, source.sessionId, managed));
            if (!hasBotPermission(config!.policy, "sessions.read", source.projectId) ||
                !watches.length) continue;
            const group = groups.get(source.rootCauseId) ?? [];
            group.push(source);
            groups.set(source.rootCauseId, group);
          }
          for (const [root, group] of groups) {
            const wakeupId = randomUUID();
            const prompts = new Set(
              config!.watches
                .filter(
                  (w) =>
                    w.enabled &&
                    group.some(
                      (s) =>
                        w.eventKinds.includes(s.kind as BotEventKind) &&
                        watchIncludesSession(w, s.projectId, s.sessionId, isWatchedSession(config!.policy, config!.watches, s.projectId, s.sessionId)),
                    ),
                )
                .map((w) => w.prompt),
            );
            this.store.enqueue(
              {
                id: wakeupId,
                kind: "event",
                text: `${[...prompts].join("\n")}\n${group.map((s) => `${s.kind}: projectId=${s.projectId}, sessionId=${s.sessionId}`).join("\n")}\n${EVENT_FOOTER}`,
                rootCauseId: root,
                state: "pending",
                createdAt: group[0].createdAt,
                attempts: 0,
                refs: [...new Set(group.map((s) => s.sessionId))],
              },
              `events:${group.map((s) => s.eventKey).join(":")}`,
            );
          }
          this.store.update({ sourceCursor: sources.at(-1)!.seq });
        });
      const wakeup = this.store.pending().find((w) => !this.steering.has(w.id));
      if (!wakeup) return;
      this.syncQueuedRuns();
      const run = this.store.bots.queuedRun(this.store.scope, wakeup);
      if (this.options.managed && !this.options.managed.acquire(run, config)) return;
      this.activeRun = run;
      this.tickingWakeupId = wakeup.id;
      const preparedConfiguration = runtimeConfiguration(config);
      // Markdown is authoritative. Capture one immutable context for this turn;
      // edits during execution are loaded at the next turn boundary.
      const memory = this.store.memory.loadContext();
      const topics = this.store.memory.topicDocuments();
      const contextHash = signature({
        // Compare what the user requested, not provider-normalized live model
        // names/settings (for example Pi resolving its default model alias).
        providerConfiguration: providerConfiguration(config),
        memory: memory.hash, topics: topics.map(topic => [topic.path, topic.hash]),
        name: config.name, persona: config.persona, policyVersion: config.policyVersion,
        workingDirectory: config.workingDirectory, tools: config.tools, callableBotIds: config.callableBotIds,
        playbooks: this.store.playbookRevision(),
      });
      const chain = this.liveChain(wakeup.rootCauseId, config);
      if (
        wakeup.kind !== "user" &&
        (chain.paused || chain.count >= config.maxAutoTurns)
      ) {
        this.store.saveWakeup({ ...wakeup, state: "failed" });
        if (!chain.paused)
          this.store.message({
            id: randomUUID(),
            kind: "status",
            code: "cycle-limit",
            text: "Automatic follow-up limit reached. Send a message to continue this task.",
            wakeupId: wakeup.id,
          });
        this.store.writeChain(wakeup.rootCauseId, { ...chain, paused: true });
        this.finishRun("cancelled", "Automatic follow-up limit reached");
        return;
      }
      if (config.brainSessionId) {
        let brain: HostSession | undefined;
        try { brain = this.engine.store.session(config.brainSessionId); } catch { /* Replace a missing cache from the durable public Thread. */ }
        if (
          !brain || (brain.status !== "running" &&
          (brain.status === "interrupted" || rotationReason(brain.session, Date.now(), config.brainBaseline) ||
            config.brainMemory?.hash !== contextHash))
        )
          // A fresh generation is briefed from the public chat on its first turn.
          this.store.update({
            brainSessionId: undefined,
            brainBaseline: undefined,
            brainGeneration: config.brainGeneration + 1,
          });
      }
      const brainId = await this.brain();
      if (!brainId) return;
      const fresh = !this.engine.store
        .session(brainId)
        .session.blocks.some((b) => b.role === "user");
      await this.engine.refreshAssistantBrainProcess(brainId);
      config = this.store.get()!;
      if (
        epoch !== this.epoch ||
        !config.enabled ||
        config.paused ||
        runtimeConfiguration(config) !== preparedConfiguration ||
        ["paused", "disabled", "interrupted", "failed"].includes(
          config.lifecycle,
        )
      )
        return;
      const joining = wakeup.kind === "event" ? this.joiningEvents(wakeup, config) : new Map();
      this.active = this.store.claim(wakeup.id, this.steering, new Set(joining.keys()));
      this.updateRun({ status: "running", startedAt: Date.now(), brainSessionId: brainId, config: {
        revision: config.revision, harness: config.harness, model: config.model, modelSettings: config.modelSettings,
        runtimeMode: config.runtimeMode, policyVersion: config.policyVersion,
        workingDirectory: this.engine.store.session(brainId).session.cwd, tools: config.tools, contextHash,
      }, capabilities: this.engine.botCapabilities(config.harness) });
      this.store.writeChain(wakeup.rootCauseId, {
        ...chain,
        count: chain.count + (wakeup.kind === "user" ? 0 : 1),
      });
      // A merged event still counts as an automatic turn for its own task.
      const counted = new Set([wakeup.rootCauseId]);
      for (const [joinedId, joined] of joining)
        if (
          this.store.wakeup(joinedId)?.mergedInto === this.active.id &&
          !counted.has(joined.rootCauseId)
        ) {
          counted.add(joined.rootCauseId);
          this.store.writeChain(joined.rootCauseId, {
            ...joined.chain,
            count: joined.chain.count + 1,
          });
        }
      this.control.enable(brainId);
      const launcher = this.entry
        ? await this.control.launcher(
            join(dirname(this.engine.store.attachmentDir), "assistant-control"),
            this.entry,
          )
        : "monocode-host";
      if (
        epoch !== this.epoch ||
        !this.active ||
        !this.store.get()?.enabled ||
        this.store.get()?.lifecycle !== "running"
      )
        return;
      if (this.engine.store.session(brainId).session.usageLimit)
        this.engine.assistantCommand({
          type: "queue",
          action: "resume",
          commandId: `assistant:retry:${wakeup.id}:${this.active.attempts}`,
          sessionId: brainId,
        });
      const ledger = this.store
        .actions()
        .filter((a) => a.rootCauseId === wakeup.rootCauseId)
        .slice(-100)
        .map((a) => ({
          requestId: a.requestId,
          action: a.action,
          state: a.state,
          ...(a.targetRef &&
          (config.policy.allowedProjects === "all" ||
            config.policy.allowedProjects.includes(a.targetRef.projectId))
            ? { targetRef: a.targetRef }
            : {}),
        }));
      this.injectedMemory = { generation: config.brainGeneration, revision: memory.revision, hash: contextHash };
      const messages = this.store.latestMessages();
      const playbooks = this.store.playbooks();
      const prompt = buildBrainPrompt({
        config,
        launcher,
        actions: config.tools?.enabledActions ?? BOT_ACTIONS,
        // The claimed wakeup also carries queued messages merged into it.
        wakeup: this.active.kind === "event" ? this.withEventBriefs(this.active, config) : this.active,
        messages,
        ledger,
        now: Date.now(),
        fresh,
        playbooks: playbooks.map(({ body: _body, ...summary }) => summary),
        ...(this.active.kind === "user"
          ? { playbook: matchPlaybook(playbooks, this.active.text) }
          : {}),
        recall: recallBotMemory(this.engine.store, this.store.scope, topics, this.active.text, {
          threadKind: this.store.bots.getThread(this.store.botId, this.store.threadId)!.kind,
          directInput: this.active.kind === "user" && wakeupSource(this.active).kind !== "automatic",
        }),
        memory,
      });
      const persona = config.persona;
      const systemInstructions = [
        `You are ${config.name}, the user's Monocode Bot. Your identity is scoped to this Bot and Thread.`,
        persona?.preset && persona.preset !== "custom" ? PERSONA_PRESETS[persona.preset] : "",
        persona?.style ?? "", persona?.userName ? `Address the user as ${JSON.stringify(persona.userName)}.` : "",
        memory.soul ? `User-authored Bot identity (SOUL.md):\n${memory.soul}` : "",
        `Host permissions are enforced by the Host. Current policy: ${JSON.stringify(config.policy)}.`,
      ].filter(Boolean).join("\n");
      const botContext = { scope: { ...this.store.scope, runId: run.id }, systemInstructions, contextFingerprint: contextHash,
        tools: config.tools, controlCli: { command: launcher },
        ...(this.entry ? { agentsMcp: { command: this.options.node ?? process.execPath, args: [this.entry, "agents-mcp"] } } : {}) };
      this.updateRun({ capabilities: this.engine.botCapabilities(config.harness, botContext) });
      this.engine.assistantCommand({
        type: "send",
        commandId: `assistant:wake:${wakeup.id}:${this.active.attempts}`,
        sessionId: brainId,
        text: prompt,
        attachments: this.active.attachments,
      }, undefined, botContext);
    } finally {
      this.ticking = false;
      if (!this.active) {
        this.activeRun = undefined;
        this.options.managed?.release();
      }
    }
  }
  private liveChain(
    root: string,
    config: BotThreadRecord,
  ): ReturnType<BotThreadStore["chain"]> {
    const chain = this.store.chain(root);
    return !chain.paused &&
      Date.now() - chain.startedAt >= config.chainWindowMinutes * 60000
      ? { count: 0, paused: false, startedAt: Date.now() }
      : chain;
  }
  /** Other pending events that may share this turn without exceeding their own task limits. */
  private joiningEvents(
    wakeup: Wakeup,
    config: BotThreadRecord,
  ): Map<string, { rootCauseId: string; chain: ReturnType<BotThreadStore["chain"]> }> {
    const joining = new Map<string, { rootCauseId: string; chain: ReturnType<BotThreadStore["chain"]> }>();
    const chains = new Map<string, ReturnType<BotThreadStore["chain"]>>();
    let refs = wakeup.refs?.length ?? 0;
    for (const other of this.store.pending()) {
      if (joining.size >= MAX_JOINED_EVENTS) break;
      if (
        other.id === wakeup.id ||
        other.kind !== "event" ||
        other.state !== "pending" ||
        this.steering.has(other.id) ||
        refs + (other.refs?.length ?? 0) > MAX_EVENT_REFS
      )
        continue;
      if (!chains.has(other.rootCauseId))
        chains.set(other.rootCauseId, this.liveChain(other.rootCauseId, config));
      const chain = chains.get(other.rootCauseId)!;
      if (other.rootCauseId !== wakeup.rootCauseId &&
          (chain.paused || chain.count >= config.maxAutoTurns))
        continue;
      refs += other.refs?.length ?? 0;
      joining.set(other.id, { rootCauseId: other.rootCauseId, chain });
    }
    return joining;
  }
  /** Adds the followed conversations' current outcome; not persisted, so retries read fresh state. */
  private withEventBriefs(wakeup: Wakeup, config: BotThreadRecord): Wakeup {
    const sessions: HostSession[] = [];
    for (const sessionId of (wakeup.refs ?? []).slice(0, MAX_EVENT_BRIEFS)) {
      try {
        const target = this.engine.store.session(sessionId);
        if (
          !target.session.assistantOwnerId &&
          !config.policy.excludedSessionIds?.includes(sessionId) &&
          hasBotPermission(config.policy, "sessions.read", target.projectId)
        )
          sessions.push(target);
      } catch {
        /* Deleted target. */
      }
    }
    const briefs = eventBriefs(sessions);
    return briefs ? { ...wakeup, text: `${wakeup.text}\n${briefs}` } : wakeup;
  }
  observe(
    previous: HostSession | undefined,
    next: HostSession,
    _event: unknown,
  ): void {
    const config = this.store.get();
    if (!config) return;
    if (
      next.session.assistantOwnerId === config.id &&
      next.session.id === config.brainSessionId
    ) {
      const activeRun = this.currentRun;
      if (activeRun && this.active && next.status === "running") {
        const status = next.session.blocks.some(block => block.approval && !block.approval.decided) ? "waiting_approval" : "running";
        const providerSessionId = next.session.providerSessionId ?? undefined;
        if (activeRun.status !== status || activeRun.hostRunId !== next.runId || activeRun.providerSessionId !== providerSessionId)
          this.updateRun({ status, hostRunId: next.runId, providerSessionId });
      }
      // Finish the turn and start queued work now instead of on the next poll;
      // deferred so it runs after the save that reported the stop.
      if (previous?.status === "running" && next.status !== "running" && (this.timer || this.options.managed))
        setImmediate(() => void this.tick().catch((error) => this.fail(error)));
      const before = new Map(previous?.session.blocks.map((b) => [b.id, b]));
      for (const block of next.session.blocks) {
        const old = before.get(block.id);
        if (
          block.role !== "assistant" ||
          this.active?.kind !== "user" ||
          !block.text ||
          (old?.streaming === block.streaming && old?.text === block.text)
        )
          continue;
        const parts = splitReply(block.text, !!block.streaming),
          oldParts = old ? splitReply(old.text, !!old.streaming) : [];
        parts.forEach((part, index) => {
          // Only the final bubble of a streaming block is still growing.
          const streaming = !!block.streaming && index === parts.length - 1,
            wasStreaming = !!old?.streaming && index === oldParts.length - 1;
          // Hold possible quiet-marker prefixes until they become public text.
          if (
            privateReplyPart(part, streaming) ||
            (oldParts[index] === part && wasStreaming === streaming)
          )
            return;
          this.store.message({
            id: replyMessageId(config.brainGeneration, block.id, index),
            kind: "assistant",
            text: part,
            streaming,
            wakeupId: this.active!.id,
          });
        });
      }
      const inputs = this.store
        .latestMessages()
        .filter(
          (m): m is Extract<BotMessage, { kind: "input" }> =>
            m.kind === "input" && !m.resolved,
        );
      for (const input of inputs)
        if (
          input.runId !== next.runId ||
          (input.inputKind === "approval"
            ? !next.session.blocks.some(
                (b) =>
                  b.approval?.requestId === input.requestId &&
                  !b.approval.decided,
              )
            : next.session.pendingQuestion?.requestId !== input.requestId)
        )
          this.store.message({ ...input, resolved: true });
      for (const block of next.session.blocks)
        if (
          block.approval &&
          !block.approval.decided &&
          !inputs.some(
            (m) =>
              m.runId === next.runId &&
              m.requestId === block.approval!.requestId &&
              m.inputKind === "approval",
          )
        )
          this.store.message({
            id: `input:${next.runId}:approval:${block.approval.requestId}`,
            kind: "input",
            wakeupId: this.active?.id,
            text: block.text,
            brainGeneration: config.brainGeneration,
            runId: next.runId!,
            requestId: block.approval.requestId,
            inputKind: "approval",
            resolved: false,
          });
      const question = next.session.pendingQuestion;
      if (
        question &&
        !inputs.some(
          (m) =>
            m.runId === next.runId &&
            m.requestId === question.requestId &&
            m.inputKind === "question",
        )
      )
        this.store.message({
          id: `input:${next.runId}:question:${question.requestId}`,
          kind: "input",
          wakeupId: this.active?.id,
          text: question.title ?? "Assistant needs your input",
          brainGeneration: config.brainGeneration,
          runId: next.runId!,
          requestId: question.requestId,
          inputKind: "question",
          question,
          resolved: false,
        });
      return;
    }
    if ((this.options.managed?.automatic() ?? true) && config.enabled && config.triggers.event)
      for (const source of importantSources(previous, next)) {
        let origin = [...next.session.blocks]
          .reverse()
          .find((b) => b.role === "user")?.origin;
        if (!origin && next.session.orchestrationLeadId) {
          try {
            origin = [
              ...this.engine.store.session(next.session.orchestrationLeadId)
                .session.blocks,
            ]
              .reverse()
              .find((b) => b.role === "user")?.origin;
          } catch {
            /* Lead was removed. */
          }
        }
        const root = origin
          ? this.store.wakeup(origin.wakeupId)?.rootCauseId
          : undefined;
        this.store.source({
          ...source,
          rootCauseId: root ?? source.rootCauseId,
        });
      }
    if (
      previous?.status !== next.status ||
      previous?.lastCompletedRunId !== next.lastCompletedRunId ||
      previous?.session.queuedMessages !== next.session.queuedMessages
    )
      this.refreshCards(next);
  }
  refreshCards(value?: HostSession): void {
    for (const message of this.store.latestMessages())
      if (
        message.kind === "session-card" &&
        (!value || message.ref.sessionId === value.session.id)
      ) {
        let target: HostSession | undefined;
        try {
          target = value ?? this.engine.store.session(message.ref.sessionId);
        } catch {
          /* Deleted target. */
        }
        const queued = target?.session.queuedMessages?.some(
          (q) => !q.blocked && q.origin?.actionId === message.actionId,
        );
        const blocked =
          target?.session.queuedMessages?.some(
            (q) => q.blocked && q.origin?.actionId === message.actionId,
          ) ||
          target?.session.blocks.some(
            (b) => b.id === `blocked:assistant:${message.actionId}`,
          );
        const status = !target
          ? "unavailable"
          : blocked
            ? "failed"
            : queued
              ? "queued"
              : target.status === "running"
                ? "running"
                : target.status === "interrupted"
                  ? "failed"
                  : target.lastCompletedRunId
                    ? "completed"
                    : "accepted";
        if (status !== message.status)
          this.store.message({ ...message, status });
      }
  }
  /** Delivers a user message into the running user turn, as a person would read it immediately. */
  private async steerInput(wakeupId: string, text: string): Promise<void> {
    const config = this.store.get(),
      active = this.active,
      incoming = this.store.wakeup(wakeupId);
    if (
      !config?.brainSessionId ||
      active?.kind !== "user" ||
      config.lifecycle !== "running" ||
      incoming?.state !== "pending" ||
      signature(wakeupSource(active)) !== signature(wakeupSource(incoming))
    )
      return;
    this.steering.add(wakeupId);
    try {
      if (
        !(await this.engine.assistantBrainSteer(
          config.brainSessionId,
          `${STEER_PREFIX}\n${text}`,
        )) ||
        this.active !== active
      )
        return;
      this.store.host.transaction(() => {
        const current = this.store.wakeup(wakeupId);
        if (current?.state !== "pending") return;
        this.store.saveWakeup({
          ...current,
          state: "completed",
          mergedInto: active.id,
        });
        const message = this.store
          .latestMessages()
          .find((m) => m.kind === "user" && m.wakeupId === wakeupId);
        if (message?.kind === "user" && message.readAt == null)
          this.store.message({ ...message, readAt: Date.now() });
      });
    } catch {
      /* The input stays queued for the next turn. */
    } finally {
      this.steering.delete(wakeupId);
    }
  }
  private hasWorkToStop(): boolean {
    return (
      this.store.get()?.lifecycle === "running" ||
      this.store.pending().some((w) => w.kind === "user")
    );
  }
  /** Stops the current turn and drops queued input; the assistant stays available. */
  private async cancelTurn(): Promise<void> {
    const stopped = this.active;
    await this.stopBrain("cancelled");
    if (stopped) this.stopDelegated(stopped.rootCauseId);
    this.store.host.transaction(() => {
      // The user ended this turn on purpose, so a later resume must not replay it.
      const current = stopped && this.store.wakeup(stopped.id);
      if (current?.state === "interrupted")
        this.store.saveWakeup({ ...current, state: "completed" });
      this.store.discardPendingUserInput();
      this.store.finishStreaming();
      this.store.update({
        lifecycle: "idle",
        error: undefined,
        nextRetryAt: undefined,
      });
      this.store.message({
        id: randomUUID(),
        kind: "status",
        code: "stopped",
        text: "Stopped",
      });
      this.syncQueuedRuns();
    });
  }
  /**
   * Stopping a task also stops the conversations it delegated: running turns the
   * task started are cancelled and its still-queued messages are removed. Turns
   * started by the user or by other tasks stay untouched.
   */
  private stopDelegated(rootCauseId: string): void {
    const actions = this.store
      .actions()
      .filter((a) => a.rootCauseId === rootCauseId && a.targetRef);
    const actionIds = new Set(actions.map((a) => a.id));
    const sessionIds = new Set(actions.map((a) => a.targetRef!.sessionId));
    const ours = (origin?: TurnOrigin) =>
      origin?.kind === "assistant" && actionIds.has(origin.actionId);
    for (const sessionId of sessionIds) {
      let target: HostSession;
      try {
        target = this.engine.store.session(sessionId);
      } catch {
        continue;
      }
      for (const queued of target.session.queuedMessages ?? [])
        if (ours(queued.origin))
          try {
            this.engine.assistantCommand({
              type: "queue",
              action: "remove",
              commandId: `assistant:stop:${queued.id}`,
              sessionId,
              messageId: queued.id,
            });
          } catch {
            /* Already dispatched or being edited. */
          }
      const turn = target.session.blocks.findLast((b) => b.role === "user");
      if (target.status === "running" && target.runId && ours(turn?.origin))
        try {
          this.engine.assistantCommand({
            type: "cancel",
            commandId: `assistant:stop:${target.runId}`,
            sessionId,
            runId: target.runId,
          });
        } catch {
          /* The turn finished meanwhile. */
        }
    }
  }
  private async stopBrain(status: "interrupted" | "cancelled" = "interrupted"): Promise<void> {
    this.epoch++;
    if (this.currentRun) this.options.managed?.stopping?.(this.currentRun);
    const config = this.store.get();
    if (!config) return;
    this.store.update({ lifecycle: "paused", activity: undefined });
    if (config.brainSessionId) {
      this.control.disable(config.brainSessionId);
      const brain = this.engine.store.session(config.brainSessionId);
      if (brain.status === "running")
        await this.engine.stopAssistantBrain(brain.session.id);
    }
    if (this.active)
      this.store.saveWakeup({ ...this.active, state: "interrupted" });
    this.finishRun(status);
    this.active = undefined;
    this.options.managed?.release();
    for (const message of this.store.latestMessages())
      if (message.kind === "input" && !message.resolved)
        this.store.message({ ...message, resolved: true });
  }
  private fail(error: unknown): void {
    const wakeupId = this.active?.id ?? this.tickingWakeupId;
    const config = this.store.get();
    if (config?.brainSessionId) this.control.disable(config.brainSessionId);
    try {
      if (config) {
        this.finishRun("failed", error instanceof Error ? error.message : "Assistant failed");
        this.store.finishStreaming();
        this.store.update({
          lifecycle: "failed",
          activity: undefined,
          error: error instanceof Error ? error.message : "Assistant failed",
        });
        this.store.message({
          id: randomUUID(),
          kind: "status",
          code: "failed",
          text: error instanceof Error ? error.message : "Assistant failed",
          ...(wakeupId ? { wakeupId } : {}),
        });
      }
    } catch {
      /* Persisting failed: retain journal for recovery. */
    } finally {
      this.active = undefined;
      this.activeRun = undefined;
      this.options.managed?.release();
    }
  }
  async close(): Promise<void> {
    this.closing = true;
    clearInterval(this.timer);
    await this.control.close();
    if (this.activeRun?.status === "running" || this.activeRun?.status === "waiting_approval")
      this.finishRun("interrupted", "Host stopped before the run finished");
    if (!this.options.managed) this.engine.store.onSessionSave = undefined;
    this.options.managed?.release();
  }
}
