import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import type { BotThreadRuntime } from "../bots/thread";
import type { HostStore } from "../store";
import { fields, id } from "../bots/thread/policy";
import { assertReplyAttachmentAccess } from "../bots/thread/attachments";
import { receiveSignature, signature } from "../bots/thread/store";
import { attachmentPath, MAX_REMOTE_ATTACHMENT_BYTES } from "../attachments";
import { ImRuntime } from "../im/core/runtime";
import { FeishuRegistration, FeishuRegistrationError, type FeishuRegistrationClient, type FeishuRegistrationAttempt } from "../im/providers/feishu/registration";
import type { ImAttachmentDescriptor, ImChannel, ImOutgoingMessage } from "../im/core/types";
import type { ImBinding, ImView } from "../../src/features/bots/model/im";
import type { BotMessage, BotReceipt } from "../../src/features/bots/model/botView";
import { translate } from "../../src/shared/i18n/language";
import { ImStore, type ImSettings, type InboxEntry, type OutboxEntry } from "./store";
import { messageText, splitImText } from "./projection";

export interface HostImChannel extends ImChannel {
  status(): ImView["status"];
  sendToOwner(message: ImOutgoingMessage): Promise<void | { messageId: string }>;
  downloadAttachment(messageId: string, attachment: ImAttachmentDescriptor): Promise<{ bytes: Uint8Array; mimeType: string }>;
}
export type HostImOptions = {
  registrationClient?: FeishuRegistrationClient;
  channelFactory?: (config: { id: string; appId: string; appSecret: string; ownerOpenId: string }) => HostImChannel | Promise<HostImChannel>;
  /** Tests drive the durable worker explicitly. */
  pollMs?: number;
  sendIntervalMs?: number;
};
const retryDelay = (attempt: number) => Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6));

/** Host-owned bridge. Credentials and delivery journals never enter the brain. */
export class HostImService {
  readonly store: ImStore;
  readonly ready: Promise<void>;
  private channel?: HostImChannel;
  private runtime?: ImRuntime;
  private starting?: Promise<void>;
  private work?: Promise<void>;
  private commands: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private generation = 0;
  private closing = false;
  private error?: string;
  private connecting = false;
  private nextSendAt = 0;
  private connectionRetryAt?: number;
  private connectionAttempts = 0;
  private binding?: { view: ImBinding; controller: AbortController };
  private bindingTasks = new Set<Promise<void>>();
  constructor(readonly host: HostStore, readonly assistant: BotThreadRuntime, private options: HostImOptions = {}) {
    const scope = assistant.store.scope, defaultScope = assistant.store.bots.defaultScope();
    if (scope.botId !== defaultScope.botId || scope.threadId !== defaultScope.threadId)
      throw new Error("IM is bound to the default Bot and thread");
    this.store = new ImStore(host, scope);
    this.ready = assistant.ready.then(() => {
      this.store.recover();
      if (this.closing) return;
      if (this.store.settings()?.enabled) this.connect();
      if (options.pollMs !== 0) {
        this.timer = setInterval(() => { void this.pump().catch(error => this.recordError(error)); }, options.pollMs ?? 500);
        this.timer.unref?.();
      }
    });
  }

  private recordError(error: unknown): void { this.error = this.safeError(error); }
  private safeError(error: unknown): string {
    let text = error instanceof Error ? error.message : String(error);
    const secret = this.store.settings()?.appSecret;
    if (secret) text = text.replaceAll(secret, "[redacted]");
    return text.slice(0, 1000);
  }
  view(): ImView {
    const config = this.store.settings();
    const inbox = config ? this.store.inbox(config.bindingId) : [];
    const outbox = config ? this.store.outbox(config.bindingId) : [];
    return {
      configured: !!config,
      ...(this.binding ? { binding: { ...this.binding.view } } : {}),
      ...(config ? {
        bindingId: config.bindingId,
        scope: this.store.scope,
        config: { appId: config.appId, ownerOpenId: config.ownerOpenId, secretConfigured: !!config.appSecret, enabled: config.enabled, language: config.language },
      } : {}),
      status: {
        ...(this.channel?.status() ?? { state: this.connecting ? "connecting" : this.error ? "failed" : "stopped" }),
        ...(this.error ? { error: this.error,
          ...(this.channel?.status().state === "stopped" ? { state: "failed" as const } : {}) } : {}),
        ...(this.connectionRetryAt ? { nextRetryAt: this.connectionRetryAt } : {}),
      },
      pending: inbox.filter(entry => entry.state === "pending").length + outbox.filter(entry => entry.state === "pending" || entry.state === "sending").length,
      deliveries: [
        ...inbox.filter(entry => entry.state === "failed").map(entry => ({
          id: `in:${entry.id}`, state: "failed" as const, summary: entry.message.text.slice(0, 120) || entry.message.attachments?.[0]?.name || "Attachment", error: entry.error, createdAt: entry.createdAt,
        })),
        ...outbox.filter(entry => entry.state === "failed" || entry.state === "unknown").map(entry => ({
          id: entry.id, state: entry.state as "failed" | "unknown", summary: entry.attachment?.name ?? entry.text.slice(0, 120), error: entry.error, createdAt: entry.createdAt,
        })),
      ].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100),
    };
  }

  async rpc(method: string, raw: Record<string, unknown>): Promise<ImView> {
    await this.ready;
    if (this.closing) throw new Error("IM service is stopped");
    if (method === "im.get") { fields(raw, []); return this.view(); }
    const command = this.commands.then(() => this.mutate(method, raw));
    this.commands = command.catch(() => undefined);
    return command;
  }
  private async mutate(method: string, raw: Record<string, unknown>): Promise<ImView> {
    if (this.closing) throw new Error("IM service is stopped");
    const old = this.store.settings();
    if (method === "im.bind") {
      fields(raw, ["action", "bindingId", "language"]);
      if (raw.action === "cancel") {
        if (raw.language !== undefined) throw new Error("Invalid language");
        if (id(raw.bindingId, "binding ID") === this.binding?.view.id) this.cancelBinding();
        return this.view();
      }
      if (raw.action !== "start" || raw.bindingId !== undefined) throw new Error("Unknown IM action");
      if (raw.language !== undefined && raw.language !== "en" && raw.language !== "zh-CN") throw new Error("Invalid language");
      if (this.binding?.view.state === "pending") return this.view();
      const binding = { view: { id: randomUUID(), state: "pending" } as ImBinding, controller: new AbortController() };
      this.binding = binding;
      const client = this.options.registrationClient ?? new FeishuRegistration();
      try {
        const attempt = await client.begin(binding.controller.signal);
        if (this.closing || binding.controller.signal.aborted) return this.view();
        binding.view = { ...binding.view, verificationUrl: attempt.verificationUrl, expiresAt: attempt.expiresAt };
        const task = this.pollBinding(binding, attempt, client, raw.language as ImSettings["language"] ?? old?.language ?? "en");
        this.bindingTasks.add(task);
        void task.finally(() => this.bindingTasks.delete(task));
      } catch (error) {
        if (!binding.controller.signal.aborted) {
          // Provider requests deliberately report fixed, credential-free errors.
          binding.view = { id: binding.view.id, state: "failed", error: error instanceof FeishuRegistrationError ? error.message : "Feishu binding failed. Try again." };
        }
      }
      return this.view();
    }
    if (method === "im.configure") {
      this.cancelBinding();
      return this.configure(raw);
    }
    if (method !== "im.control") throw new Error("Unknown IM operation");
    fields(raw, ["action", "deliveryId"]);
    if (!old) throw new Error("Configure Feishu first");
    const action = id(raw.action, "action");
    if (action === "retry" || action === "discard") {
      const deliveryId = id(raw.deliveryId, "delivery ID");
      if (deliveryId.startsWith("in:")) {
        const entry = this.store.inbox(old.bindingId, "failed").find(row => row.id === deliveryId.slice(3));
        if (!entry) throw new Error("Pending message not found");
        this.store.saveInbox({ ...entry, state: action === "retry" ? "pending" : "discarded", attempts: 0, nextAttemptAt: 0, error: undefined });
      } else {
        const entry = this.store.outbox(old.bindingId).find(row => row.id === deliveryId && ["failed", "unknown"].includes(row.state));
        if (!entry) throw new Error("Pending delivery not found");
        this.store.saveOutbox({ ...entry, state: action === "retry" ? "pending" : "discarded", attempts: 0, nextAttemptAt: 0, error: undefined });
      }
      return this.view();
    }
    if (raw.deliveryId !== undefined) throw new Error("Unexpected delivery ID");
    if (!["enable", "disable", "reconnect"].includes(action)) throw new Error("Unknown IM action");
    this.cancelBinding();
    // Disable is persisted before yielding, so a worker cannot send while stop
    // waits for an SDK handshake or an in-flight attachment download.
    this.store.configure({ ...old, enabled: false });
    await this.disconnect();
    this.error = undefined;
    this.connectionAttempts = 0;
    if (action !== "disable") {
      const latest = this.store.settings()!;
      this.store.configure({ ...latest, enabled: true, activated: true,
        cursor: latest.activated ? latest.cursor : this.assistant.store.get()?.chatRevision ?? 0 });
      this.connect();
    }
    return this.view();
  }

  private async configure(raw: Record<string, unknown>, connectNow = false): Promise<ImView> {
    fields(raw, ["appId", "appSecret", "ownerOpenId", "language"]);
    const old = this.store.settings();
    const appId = id(raw.appId, "App ID").trim(), ownerOpenId = id(raw.ownerOpenId, "open_id").trim();
    if (!/^cli_[0-9a-fA-F]{16}$/.test(appId) || !/^ou_[\w-]+$/.test(ownerOpenId)) throw new Error("Invalid Feishu App ID or open_id");
    if (raw.language !== undefined && raw.language !== "en" && raw.language !== "zh-CN") throw new Error("Invalid language");
    const appSecret = raw.appSecret === undefined ? (old?.appId === appId ? old.appSecret : undefined) : id(raw.appSecret, "App Secret", 2048).trim();
    if (!appSecret) throw new Error("Enter the App Secret");
    const sameBinding = old?.appId === appId && old.ownerOpenId === ownerOpenId;
    await this.disconnect();
    // Shutdown may arrive while an SDK stop or durable worker is finishing.
    if (this.closing) throw new Error("IM service is stopped");
    this.store.configure({
      appId, appSecret, ownerOpenId, language: raw.language as ImSettings["language"] ?? old?.language ?? "en",
      bindingId: sameBinding ? old.bindingId : randomUUID(),
      enabled: connectNow || (sameBinding ? old.enabled : false),
      activated: connectNow || (sameBinding ? old.activated : false),
      cursor: sameBinding && (!connectNow || old.activated) ? this.store.settings()!.cursor : this.assistant.store.get()?.chatRevision ?? 0,
    });
    this.error = undefined;
    this.connectionAttempts = 0;
    if (this.store.settings()!.enabled) this.connect();
    return this.view();
  }

  private cancelBinding(): void {
    if (this.binding?.view.state !== "pending") return;
    this.binding.controller.abort();
    this.binding.view = { id: this.binding.view.id, state: "cancelled" };
  }

  private async pollBinding(binding: NonNullable<HostImService["binding"]>, attempt: FeishuRegistrationAttempt,
    client: FeishuRegistrationClient, language: ImSettings["language"]): Promise<void> {
    const signal = binding.controller.signal;
    const current = () => !this.closing && this.binding === binding && !signal.aborted;
    let interval = attempt.interval;
    try {
      while (current()) {
        await waitForBindingPoll(Math.min(interval, Math.max(0, attempt.expiresAt - Date.now())), signal);
        if (!current()) return;
        if (Date.now() >= attempt.expiresAt) {
          binding.view = { id: binding.view.id, state: "expired" };
          return;
        }
        const result = await client.poll(attempt.deviceCode, signal);
        if (!current()) return;
        // A response received after expiry must not install a binding either.
        if (Date.now() >= attempt.expiresAt) {
          binding.view = { id: binding.view.id, state: "expired" };
          return;
        }
        if (result.state === "pending") continue;
        if (result.state === "slow_down") { interval += 5000; continue; }
        if (result.state !== "complete") {
          binding.view = { id: binding.view.id, state: result.state };
          return;
        }
        const command = this.commands.then(async () => {
          if (!current()) return;
          await this.configure({ appId: result.appId, appSecret: result.appSecret, ownerOpenId: result.ownerOpenId, language }, true);
          if (current()) binding.view = { id: binding.view.id, state: "completed" };
        });
        this.commands = command.catch(() => undefined);
        await command;
        return;
      }
    } catch (error) {
      if (current()) binding.view = { id: binding.view.id, state: "failed", error: error instanceof FeishuRegistrationError ? error.message : "Feishu binding failed. Try again." };
    }
  }

  private connect(): void {
    const config = this.store.settings();
    if (!config?.enabled || this.closing) return;
    const generation = ++this.generation;
    this.connecting = true;
    this.connectionRetryAt = undefined;
    this.starting = (async () => {
      const factory = this.options.channelFactory ?? (async (input) => {
        const { FeishuChannel } = await import("../im/providers/feishu/channel.ts");
        return new FeishuChannel(input);
      });
      const channel = await factory({ id: config.bindingId, appId: config.appId, appSecret: config.appSecret, ownerOpenId: config.ownerOpenId });
      if (this.closing || generation !== this.generation) { await channel.stop(); return; }
      this.channel = channel;
      const runtime = new ImRuntime({ onMessage: async ({ message }) => {
        if (!this.active(config.bindingId, generation) || message.senderId !== config.ownerOpenId) throw new Error("IM source is no longer authorized");
        if (message.text.length > 1_000_000 || (message.attachments?.length ?? 0) > 20) throw new Error("IM message is too large");
        this.store.receive(config.bindingId, message);
      } });
      runtime.register(channel);
      this.runtime = runtime;
      await runtime.start();
      if (generation === this.generation) {
        this.error = undefined;
        this.connectionAttempts = 0;
      }
    })().catch(error => {
      if (generation === this.generation && !this.closing) {
        this.recordError(error);
        this.connectionRetryAt = Date.now() + retryDelay(++this.connectionAttempts);
      }
    }).finally(() => {
      if (generation === this.generation) this.connecting = false;
    });
  }
  private active(bindingId: string, generation: number): boolean {
    const config = this.store.settings();
    return !this.closing && this.generation === generation && config?.bindingId === bindingId && config.enabled;
  }
  private async disconnect(): Promise<void> {
    this.generation++;
    this.connecting = false;
    this.connectionRetryAt = undefined;
    // Direct stop aborts a pending start; ImRuntime deliberately rejects stop
    // re-entry while starting, so join startup before its final cleanup.
    await this.channel?.stop();
    await this.starting;
    if (this.runtime && this.runtime.state !== "stopped") await this.runtime.stop();
    await this.work;
    this.channel = undefined;
    this.runtime = undefined;
    this.starting = undefined;
  }

  async pump(): Promise<void> {
    await this.ready;
    if (this.work) return this.work;
    const config = this.store.settings(), channel = this.channel, generation = this.generation;
    if (config?.enabled && !this.closing && !this.connecting &&
        (this.connectionRetryAt || channel?.status().state === "failed")) {
      this.connectionRetryAt ??= Date.now() + retryDelay(++this.connectionAttempts);
      if (this.connectionRetryAt <= Date.now()) {
        this.connecting = true;
        const reconnect = this.commands.then(async () => {
          if (!this.active(config.bindingId, generation)) return;
          await this.disconnect();
          this.connect();
        });
        this.commands = reconnect.catch(error => {
          this.connecting = false;
          this.recordError(error);
          this.connectionRetryAt = Date.now() + retryDelay(++this.connectionAttempts);
        });
      }
      return;
    }
    if (!config?.enabled || !channel || this.closing || this.runtime?.state !== "running" || channel.status().state !== "connected") return;
    const work = this.process(config, channel, generation);
    this.work = work;
    try { await work; } finally { if (this.work === work) this.work = undefined; }
  }
  private async process(config: ImSettings, channel: HostImChannel, generation: number): Promise<void> {
    for (const entry of this.store.inbox(config.bindingId, "pending").slice(0, 20)) {
      if (!this.active(config.bindingId, generation)) return;
      if (entry.nextAttemptAt > Date.now()) break;
      await this.deliverInput(entry, config, channel, generation);
      if (this.store.inbox(config.bindingId, "pending").some(row => row.id === entry.id)) break;
    }
    if (!this.active(config.bindingId, generation)) return;
    this.project(config);
    const outbox = this.store.outbox(config.bindingId);
    const blocked = new Set(outbox.filter(row => ["failed", "unknown"].includes(row.state)).map(row => row.assistantMessageId).filter(Boolean));
    for (const entry of outbox.filter(row => row.state === "pending" && !blocked.has(row.assistantMessageId)).slice(0, 20)) {
      if (!this.active(config.bindingId, generation)) return;
      if (entry.nextAttemptAt > Date.now() || this.nextSendAt > Date.now()) break;
      // Do not deliver a file or a later text part ahead of an unresolved part
      // of the same reply. Independent reminders can still be delivered.
      if (entry.assistantMessageId && blocked.has(entry.assistantMessageId)) continue;
      await this.deliverOutput(entry, channel, generation);
      const delivered = this.store.outbox(config.bindingId).find(row => row.id === entry.id);
      if (delivered?.state === "pending") break;
      if (entry.assistantMessageId && delivered && ["failed", "unknown"].includes(delivered.state)) blocked.add(entry.assistantMessageId);
    }
  }

  private async deliverInput(entry: InboxEntry, config: ImSettings, channel: HostImChannel, generation: number): Promise<void> {
    // A crash can leave the assistant receipt committed while the inbox is
    // still pending. Recognize acceptance even if messaging was since disabled.
    const previous = this.assistant.store.receipt(entry.id,
      receiveSignature(entry.message.text, entry.attachments, { kind: "im", bindingId: config.bindingId })) as BotReceipt | undefined;
    if (previous) {
      this.store.saveInbox({ ...entry, state: "accepted", wakeupId: previous.wakeupId, error: undefined });
      return;
    }
    const assistant = this.assistant.store.get();
    if (!assistant?.enabled || !assistant.triggers.user) {
      this.store.saveInbox({ ...entry, state: "failed", error: "Assistant messaging is disabled" });
      this.inputError(entry, config, "Assistant messaging is disabled. Enable it in OmniCode, then send your message again.");
      return;
    }
    try {
      for (let index = entry.attachments.length; index < (entry.message.attachments?.length ?? 0); index++) {
        const descriptor = entry.message.attachments![index];
        const downloaded = await channel.downloadAttachment(entry.message.messageId, descriptor);
        if (!this.active(config.bindingId, generation)) return;
        if (downloaded.bytes.length > MAX_REMOTE_ATTACHMENT_BYTES) throw new Error("Attachments must be at most 20 MB");
        const attachment = { id: entry.attachmentIds[index], name: descriptor.name.slice(0, 255) || "attachment", kind: descriptor.kind, mimeType: downloaded.mimeType || "application/octet-stream", size: downloaded.bytes.length };
        await mkdir(this.host.attachmentDir, { recursive: true, mode: 0o700 });
        const path = attachmentPath(this.host, attachment.id), temporary = `${path}.part`;
        try {
          const file = await open(temporary, "w", 0o600);
          try { await file.writeFile(downloaded.bytes); await file.sync(); } finally { await file.close(); }
          await rename(temporary, path);
        } finally { await unlink(temporary).catch(() => undefined); }
        if (!this.active(config.bindingId, generation)) return;
        entry.attachments.push(attachment);
        this.store.saveInbox(entry);
      }
      if (!this.active(config.bindingId, generation)) return;
      const receipt = await this.assistant.receiveImMessage({ commandId: entry.id, text: entry.message.text, attachments: entry.attachments, bindingId: config.bindingId }) as BotReceipt;
      this.store.saveInbox({ ...entry, state: "accepted", wakeupId: receipt.wakeupId, error: undefined });
    } catch (error) {
      if (!this.active(config.bindingId, generation)) return;
      const attempts = entry.attempts + 1;
      const permanent = deliveryKind(error) === "permanent" || /at most|invalid attachment|too large/i.test(String(error));
      this.store.saveInbox({ ...entry, attempts, state: permanent || attempts >= 5 ? "failed" : "pending", nextAttemptAt: Date.now() + retryDelay(attempts), error: this.safeError(error) });
      if (permanent || attempts >= 5) this.inputError(entry, config, "This message could not be processed. Open OmniCode for details.");
    }
  }
  private inputError(entry: InboxEntry, config: ImSettings, text: string): void {
    this.store.enqueue({ bindingId: config.bindingId, key: `inbox:${entry.id}:error`, text: translate(text, undefined, config.language), threadId: entry.message.conversation.threadId, replyToMessageId: entry.message.messageId });
  }
  private project(config: ImSettings): void {
    this.host.transaction(() => {
      let settings = this.store.settings()!;
      for (let pageIndex = 0; pageIndex < 10; pageIndex++) {
        const page = this.assistant.store.messages(settings.cursor, 100);
        for (const message of page.entries) {
          if (!message.wakeupId) continue;
          const wakeup = this.assistant.store.wakeup(message.wakeupId);
          if (!wakeup) continue;
          const source = wakeup.source ?? { kind: wakeup.kind === "user" ? "client" : "automatic" };
          if (source.kind !== "automatic" && !(source.kind === "im" && source.bindingId === config.bindingId)) continue;
          const text = messageText(message, config.language);
          if (text === undefined) continue;
          if (message.kind === "input" && !this.inputStillPending(message.id)) continue;
          const input = source.kind === "im" ? this.store.replyTo(config.bindingId, wakeup.id) : undefined;
          const target = { bindingId: config.bindingId, assistantMessageId: message.id,
            ...(input ? { threadId: input.message.conversation.threadId, replyToMessageId: input.message.messageId } : {}) };
          // Cards and status entries can change after their first publication.
          // Deduplicate identical state, while delivering meaningful updates.
          const version = message.kind === "session-card" || message.kind === "status" ? `:${signature(text)}` : "";
          splitImText(text).forEach((part, index) => this.store.enqueue({ ...target, key: `${message.id}${version}:text:${index}`, text: part }));
          if (message.kind === "assistant")
            for (const attachment of message.attachments ?? [])
              this.store.enqueue({ ...target, key: `${message.id}:attachment:${attachment.id}`, text: "", attachment });
        }
        settings = { ...settings, cursor: page.nextRevision };
        this.store.configure(settings);
        if (!page.hasMore) break;
      }
    });
  }

  private checkAttachmentAccess(entry: OutboxEntry): void {
    if (!entry.attachment || !entry.assistantMessageId) return;
    const action = this.assistant.store.actions().find(action => action.action === "reply.attachments" && (action.result as { messageId?: string } | undefined)?.messageId === entry.assistantMessageId);
    if (!action) throw new Error("Attachment publication not found");
    assertReplyAttachmentAccess(this.assistant, action.input);
  }
  private publicMessage(messageId: string): BotMessage | undefined {
    return this.assistant.store.messageById(messageId);
  }
  private inputStillPending(messageId: string): boolean {
    const current = this.publicMessage(messageId);
    if (current?.kind !== "input" || current.resolved) return false;
    const config = this.assistant.store.get();
    if (!config?.enabled || config.lifecycle !== "running") return false;
    const brain = config?.brainSessionId ? this.assistant.engine.session(config.brainSessionId) : undefined;
    if (config?.brainGeneration !== current.brainGeneration || brain?.runId !== current.runId) return false;
    return current.inputKind === "question"
      ? brain.session.pendingQuestion?.requestId === current.requestId
      : brain.session.blocks.some(block => block.approval?.requestId === current.requestId && !block.approval.decided);
  }
  private async deliverOutput(entry: OutboxEntry, channel: HostImChannel, generation: number): Promise<void> {
    let sending = false;
    try {
      if (entry.assistantMessageId && this.publicMessage(entry.assistantMessageId)?.kind === "input" && !this.inputStillPending(entry.assistantMessageId)) {
        this.store.saveOutbox({ ...entry, state: "discarded" });
        return;
      }
      this.checkAttachmentAccess(entry);
      // Keep the originating message in the journal for attribution, but send
      // ordinary chat bubbles, including queued items from earlier versions.
      const outgoing: ImOutgoingMessage = { text: entry.text, deliveryId: entry.id };
      if (entry.attachment) {
        const path = attachmentPath(this.host, entry.attachment.id);
        const info = await stat(path);
        if (info.size !== entry.attachment.size || info.size > MAX_REMOTE_ATTACHMENT_BYTES) throw new Error("Attachment is incomplete or too large");
        outgoing.attachment = { ...entry.attachment, kind: entry.attachment.kind === "image" ? "image" : "file", bytes: await readFile(path) };
        this.checkAttachmentAccess(entry);
      }
      if (!this.active(entry.bindingId, generation)) return;
      this.store.saveOutbox({ ...entry, state: "sending", attempts: entry.attempts + 1 });
      sending = true;
      this.nextSendAt = Date.now() + (this.options.sendIntervalMs ?? 250);
      const result = entry.threadId ? await channel.send(entry.threadId, outgoing) : await channel.sendToOwner(outgoing);
      if (!result?.messageId) throw new Error("Delivery returned no message ID");
      this.store.saveOutbox({ ...entry, attempts: entry.attempts + 1, state: "sent", messageId: result.messageId, error: undefined });
    } catch (error) {
      const kind = sending ? deliveryKind(error) : "permanent";
      const attempts = entry.attempts + 1;
      this.store.saveOutbox({ ...entry, attempts, state: kind === "unknown" ? "unknown" : kind === "retryable" && attempts < 5 ? "pending" : "failed", nextAttemptAt: Date.now() + retryDelay(attempts), error: this.safeError(error) });
    }
  }
  async close(): Promise<void> {
    this.closing = true;
    this.cancelBinding();
    clearInterval(this.timer);
    await this.ready;
    await this.commands;
    await Promise.all(this.bindingTasks);
    await this.disconnect();
  }
}

function waitForBindingPoll(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    timer.unref?.();
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

function deliveryKind(error: unknown): "unknown" | "retryable" | "permanent" {
  const kind = error && typeof error === "object" && "kind" in error ? error.kind : undefined;
  return kind === "retryable" || kind === "permanent" ? kind : "unknown";
}
