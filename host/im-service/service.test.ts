import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostEngine } from "../engine";
import { HostStore } from "../store";
import type { HostProvider } from "../providers";
import type { HostImChannel } from "./index";
import type { FeishuRegistrationClient, FeishuRegistrationResult } from "../im/providers/feishu/registration";
import type { ImMessageHandler, ImIncomingMessage, ImOutgoingMessage } from "../im/core/types";
import { ImDeliveryError } from "../im/core/errors";
import { attachmentPath } from "../attachments";
import { splitImText } from "./projection";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  try { for (const cleanup of cleanups.splice(0)) await cleanup(); }
  finally { vi.useRealTimers(); }
});
const config = { appId: "cli_1234567890abcdef", appSecret: "private-bot-secret", ownerOpenId: "ou_owner", language: "zh-CN" };

async function setup(options: { failFirstStart?: boolean; registrationClient?: FeishuRegistrationClient } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "omnicode-im-"));
  let store: HostStore, engine: HostEngine;
  const channels: Array<HostImChannel & { receive: ImMessageHandler }> = [];
  const send = vi.fn(async (_target: string, _message: ImOutgoingMessage) => ({ messageId: randomUUID() }));
  const download = vi.fn(async () => ({ bytes: new TextEncoder().encode("attachment contents"), mimeType: "text/plain" }));
  let starts = 0;
  const provider: HostProvider = { send: vi.fn(async () => {}), stop: vi.fn(async () => {}), cancel: vi.fn(async () => {}), bind: vi.fn(), approve: vi.fn(), answer: vi.fn() };
  async function start() {
    store = new HostStore(join(directory, "host.db"));
    engine = new HostEngine(store, { codex: provider }, undefined, { im: { pollMs: 0, sendIntervalMs: 0, registrationClient: options.registrationClient, channelFactory: input => {
      let handler: ImMessageHandler, state: "connected" | "stopped" = "stopped";
      const channel = {
        id: input.id, platform: "feishu" as const,
        start: async (receive: ImMessageHandler) => {
          if (++starts === 1 && options.failFirstStart) throw new Error("Network offline");
          handler = receive; state = "connected";
        },
        stop: async () => { state = "stopped"; },
        status: () => ({ state }), send,
        sendToOwner: (message: ImOutgoingMessage) => send(input.ownerOpenId, message),
        downloadAttachment: download,
        receive: (message: ImIncomingMessage) => handler(message),
      };
      channels.push(channel);
      return channel;
    } } });
    await engine.ready;
    await engine.workflows.ready;
  }
  await start();
  engine.assistant.setCatalog(async () => ["codex"], async () => ({ models: { codex: [{ id: "test", name: "Test" }] }, errors: {} }));
  await engine.assistant.rpc("assistant.configure", { commandId: "configure", expectedRevision: 0, patch: { harness: "codex", model: "test", triggers: { user: true, event: false, schedule: false } } });
  // Keep fixture wakeups queued; these tests exercise delivery, not provider execution.
  engine.assistant.store.update({ lifecycle: "paused" });
  cleanups.push(async () => { await engine.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const connected = () => vi.waitFor(() => expect(engine.im.view().status.state).toBe("connected"));
  const enable = async () => {
    await engine.im.rpc("im.configure", config);
    await engine.im.rpc("im.control", { action: "enable" });
    await connected();
  };
  const incoming = (messageId: string, extra: Partial<ImIncomingMessage> = {}): ImIncomingMessage => ({
    conversation: { channelId: engine.im.view().bindingId!, threadId: "oc_private" }, messageId, senderId: "ou_owner", text: "Check my project", ...extra,
  });
  return {
    get engine() { return engine; }, get store() { return store; },
    directory, channels, send, download, enable, connected, incoming,
    async restart() { await engine.close(); store.close(); await start(); await connected(); },
  };
}

it("persists accepted input before dispatch and consumes platform redelivery once across restart", async () => {
  const s = await setup();
  await s.enable();
  const message = s.incoming("om_once");
  await s.channels.at(-1)!.receive(message);
  expect(s.engine.assistant.store.latestMessages().filter(m => m.kind === "user")).toHaveLength(0);
  await s.restart();
  await s.channels.at(-1)!.receive(message);
  await s.engine.im.pump();
  expect(s.engine.im.store.inbox(message.conversation.channelId)).toHaveLength(1);
  expect(s.engine.im.store.inbox(message.conversation.channelId)[0].state).toBe("accepted");
  expect(s.engine.assistant.store.latestMessages().filter(m => m.kind === "user")).toHaveLength(1);
  await s.restart();
  await s.channels.at(-1)!.receive(message);
  await s.engine.im.pump();
  expect(s.engine.assistant.store.latestMessages().filter(m => m.kind === "user")).toHaveLength(1);
});

it("resumes an input whose assistant receipt committed before inbox acceptance", async () => {
  const s = await setup(); await s.enable();
  const message = s.incoming("om_receipt");
  await s.channels.at(-1)!.receive(message);
  const entry = s.engine.im.store.inbox(message.conversation.channelId)[0];
  await s.engine.assistant.receiveImMessage({ commandId: entry.id, text: message.text, bindingId: entry.bindingId });
  s.engine.assistant.store.update({ enabled: false, lifecycle: "disabled" });
  await s.restart(); await s.engine.im.pump();
  expect(s.engine.assistant.store.latestMessages().filter(m => m.kind === "user")).toHaveLength(1);
  expect(s.engine.im.store.inbox(entry.bindingId)[0].state).toBe("accepted");
  expect(s.send).not.toHaveBeenCalled();
});

it("projects only finished IM bubbles and automatic notices, without replaying old history or client replies", async () => {
  const s = await setup();
  const a = s.engine.assistant.store;
  a.enqueue({ id: "auto", kind: "schedule", state: "completed", text: "Check", rootCauseId: "auto", createdAt: 1, attempts: 1 }, "auto");
  a.message({ id: "old", kind: "assistant", text: "Old history", wakeupId: "auto" });
  await s.enable();
  const input = s.incoming("om_source"); await s.channels.at(-1)!.receive(input); await s.engine.im.pump();
  const wakeupId = s.engine.im.store.inbox(input.conversation.channelId)[0].wakeupId!;
  const client = a.receive("desktop", "Do not forward", []);
  a.message({ id: "desktop-reply", kind: "assistant", text: "Private desktop answer", wakeupId: client.wakeupId });
  a.message({ id: "unknown", kind: "status", text: "No source" });
  a.message({ id: "reply", kind: "assistant", text: "Still writing", streaming: true, wakeupId });
  await s.engine.im.pump(); expect(s.send).not.toHaveBeenCalled();
  a.message({ id: "reply", kind: "assistant", text: "Finished reply", streaming: false, wakeupId });
  a.message({ id: "notice", kind: "assistant", text: "Reminder", wakeupId: "auto" });
  await s.engine.im.pump(); await s.engine.im.pump();
  expect(s.send.mock.calls.map(call => call[1].text)).toEqual(["Finished reply", "Reminder"]);
  expect(s.send.mock.calls[0][0]).toBe("oc_private");
  expect(s.send.mock.calls[0][1].replyToMessageId).toBeUndefined();
  expect(s.engine.im.store.outbox(input.conversation.channelId)[0].replyToMessageId).toBe("om_source");
  expect(s.send.mock.calls[1][0]).toBe("ou_owner");
  await s.restart(); await s.engine.im.pump(); expect(s.send).toHaveBeenCalledTimes(2);
});

it("keeps unknown sends visible without automatically replaying them after restart", async () => {
  const s = await setup(); await s.enable();
  const bindingId = s.engine.im.view().bindingId!;
  s.engine.im.store.enqueue({ bindingId, key: "timeout", text: "Potentially delivered" });
  s.send.mockRejectedValueOnce(new ImDeliveryError("unknown", "Response lost"));
  await s.engine.im.pump();
  const unknown = s.engine.im.view().deliveries[0];
  expect(unknown.state).toBe("unknown");
  await s.restart(); await s.engine.im.pump(); expect(s.send).toHaveBeenCalledOnce();
  await s.engine.im.rpc("im.control", { action: "retry", deliveryId: unknown.id });
  await s.engine.im.pump();
  expect(s.send).toHaveBeenCalledTimes(2);
  expect(s.send.mock.calls[0][1].deliveryId).toBe(s.send.mock.calls[1][1].deliveryId);
  expect(s.engine.im.view().deliveries).toEqual([]);
});

it("marks an interrupted send unknown but retains never-started outbox work", async () => {
  const s = await setup(); await s.enable();
  const bindingId = s.engine.im.view().bindingId!;
  s.engine.im.store.enqueue({ bindingId, key: "interrupted", text: "Unknown" });
  const entry = s.engine.im.store.outbox(bindingId)[0];
  s.engine.im.store.saveOutbox({ ...entry, state: "sending" });
  s.engine.im.store.enqueue({ bindingId, key: "not-started", text: "Pending", threadId: "oc_private", replyToMessageId: "om_original" });
  await s.restart(); await s.engine.im.pump();
  expect(s.engine.im.view().deliveries[0].state).toBe("unknown");
  expect(s.send.mock.calls.map(call => call[1].text)).toEqual(["Pending"]);
  expect(s.send.mock.calls[0][0]).toBe("oc_private");
  expect(s.send.mock.calls[0][1].replyToMessageId).toBeUndefined();
});

it("preserves attachment IDs across inbox retry and sends the complete attachment to the assistant", async () => {
  const s = await setup(); await s.enable();
  const input = s.incoming("om_file", { text: "", attachments: [{ id: "file_key", kind: "file", name: "notes.txt" }] });
  await s.channels.at(-1)!.receive(input); await s.engine.im.pump();
  const entry = s.engine.im.store.inbox(input.conversation.channelId)[0];
  expect(entry.state).toBe("accepted");
  expect(readFileSync(attachmentPath(s.store, entry.attachments[0].id), "utf8")).toBe("attachment contents");
  expect(s.engine.assistant.store.latestMessages().find(m => m.kind === "user")).toMatchObject({ attachments: [{ id: entry.attachmentIds[0], name: "notes.txt" }] });
  await s.channels.at(-1)!.receive(input); await s.engine.im.pump(); expect(s.download).toHaveBeenCalledOnce();
});

it("disables delivery immediately and never sends old binding work to a new owner", async () => {
  const s = await setup(); await s.enable();
  const bindingId = s.engine.im.view().bindingId!, oldChannel = s.channels.at(-1)!;
  s.engine.im.store.enqueue({ bindingId, key: "pending", text: "For original owner" });
  await s.engine.im.rpc("im.control", { action: "disable" }); await s.engine.im.pump();
  expect(s.send).not.toHaveBeenCalled();
  await s.engine.im.rpc("im.configure", { ...config, ownerOpenId: "ou_someone_else" });
  expect(s.engine.im.view().bindingId).not.toBe(bindingId);
  await s.engine.im.rpc("im.control", { action: "enable" }); await s.connected(); await s.engine.im.pump();
  expect(s.send).not.toHaveBeenCalled();
  expect(s.engine.im.store.outbox(bindingId)[0].state).toBe("discarded");
  await expect(oldChannel.receive({ conversation: { channelId: bindingId, threadId: "old" }, messageId: "late", senderId: "ou_owner", text: "Late" })).rejects.toThrow();
});

it("does not expose the saved secret or silently retain it when changing apps", async () => {
  const s = await setup();
  const view = await s.engine.im.rpc("im.configure", config);
  expect(JSON.stringify(view)).not.toContain(config.appSecret);
  expect(view.config?.secretConfigured).toBe(true);
  await s.engine.im.rpc("im.configure", { appId: config.appId, ownerOpenId: config.ownerOpenId });
  await expect(s.engine.im.rpc("im.configure", { appId: "cli_abcdef1234567890", ownerOpenId: config.ownerOpenId })).rejects.toThrow("App Secret");
});

it("keeps Unicode and escaped text intact when splitting long outgoing messages", () => {
  const text = "中文🙂\n\"\\".repeat(4000);
  const parts = splitImText(text);
  expect(parts.length).toBeGreaterThan(1);
  expect(parts.join("")).toBe(text);
  expect(parts.every(part => Buffer.byteLength(JSON.stringify(part)) <= 8002)).toBe(true);
  expect(parts.some(part => /[\uD800-\uDBFF]$/.test(part))).toBe(false);
});

it("retries a failed initial connection after backoff without blocking Host readiness", async () => {
  const s = await setup({ failFirstStart: true });
  await s.engine.im.rpc("im.configure", config);
  await s.engine.im.rpc("im.control", { action: "enable" });
  await vi.waitFor(() => expect(s.engine.im.view().status.state).toBe("failed"));
  const next = s.engine.im.view().status.nextRetryAt!;
  expect(next).toBeGreaterThan(Date.now());
  const clock = vi.spyOn(Date, "now").mockReturnValue(next + 1);
  try { await s.engine.im.pump(); await s.connected(); }
  finally { clock.mockRestore(); }
  expect(s.channels).toHaveLength(2);
  expect(s.engine.im.view().status.error).toBeUndefined();
});

it("preserves input order while the first message waits for an attachment retry", async () => {
  const s = await setup(); await s.enable();
  const first = s.incoming("first", { text: "First file", attachments: [{ id: "file_first", name: "first.txt", kind: "file" }] });
  await s.channels.at(-1)!.receive(first);
  await s.channels.at(-1)!.receive(s.incoming("second", { text: "Then read it" }));
  s.download.mockRejectedValueOnce(new ImDeliveryError("retryable", "Download timed out"));
  await s.engine.im.pump(); await s.engine.im.pump();
  expect(s.engine.assistant.store.latestMessages().filter(message => message.kind === "user")).toHaveLength(0);
  const entry = s.engine.im.store.inbox(first.conversation.channelId)[0];
  s.engine.im.store.saveInbox({ ...entry, nextAttemptAt: 0 });
  await s.engine.im.pump();
  expect(s.engine.assistant.store.latestMessages().filter(message => message.kind === "user").map(message => message.text)).toEqual(["First file", "Then read it"]);
});

it("delivers independent reminders even when a long reply is blocked on an unknown first part", async () => {
  const s = await setup(); await s.enable();
  const bindingId = s.engine.im.view().bindingId!;
  s.engine.im.store.enqueue({ bindingId, key: "long:0", text: "Unconfirmed first", assistantMessageId: "long" });
  const first = s.engine.im.store.outbox(bindingId)[0];
  s.engine.im.store.saveOutbox({ ...first, state: "unknown" });
  for (let index = 1; index < 25; index++)
    s.engine.im.store.enqueue({ bindingId, key: `long:${index}`, text: `Later part ${index}`, assistantMessageId: "long" });
  s.engine.im.store.enqueue({ bindingId, key: "reminder", text: "Independent reminder", assistantMessageId: "reminder" });
  await s.engine.im.pump();
  expect(s.send.mock.calls.map(call => call[1].text)).toEqual(["Independent reminder"]);
});

it("delivers changed task status once without repeating identical card snapshots", async () => {
  const s = await setup(); await s.enable();
  const a = s.engine.assistant.store, bindingId = s.engine.im.view().bindingId!;
  a.enqueue({ id: "card-turn", kind: "user", state: "completed", source: { kind: "im", bindingId }, text: "Task", rootCauseId: "card-turn", createdAt: 1, attempts: 1 }, "card-turn");
  const card = { id: "task-card", wakeupId: "card-turn", kind: "session-card" as const,
    ref: { environmentId: s.store.environmentId, projectId: "project", sessionId: "task" }, title: "Build", projectName: "Test project", harness: "codex" as const, model: "test", actionId: "action" };
  a.message({ ...card, status: "queued" }); await s.engine.im.pump();
  a.message({ ...card, status: "completed" }); await s.engine.im.pump();
  a.message({ ...card, status: "completed" }); await s.engine.im.pump();
  expect(s.send).toHaveBeenCalledTimes(2);
  expect(s.send.mock.calls[0][1].text).not.toBe(s.send.mock.calls[1][1].text);
});

it("does not deliver already-resolved or interrupted approval requests from the journal or outbox", async () => {
  const s = await setup(); await s.enable();
  const a = s.engine.assistant.store, bindingId = s.engine.im.view().bindingId!;
  a.enqueue({ id: "approval-turn", kind: "schedule", state: "interrupted", text: "Check", rootCauseId: "approval-turn", createdAt: 1, attempts: 1 }, "approval-turn");
  const input = { id: "approval", kind: "input" as const, wakeupId: "approval-turn", text: "Approve this", brainGeneration: 1, runId: "old-run", requestId: 1, inputKind: "approval" as const, resolved: false };
  a.message(input);
  a.message({ ...input, resolved: true });
  a.message({ ...input, id: "stale-approval" });
  s.engine.im.store.enqueue({ bindingId, key: "already-queued", assistantMessageId: "stale-approval", text: "Old prompt" });
  await s.engine.im.pump();
  expect(s.send).not.toHaveBeenCalled();
  expect(s.engine.im.store.outbox(bindingId)).toHaveLength(1);
  expect(s.engine.im.store.outbox(bindingId)[0].state).toBe("discarded");
});

it("delivers explicitly published files and checks revoked access before later uploads", async () => {
  const s = await setup(); await s.enable();
  const a = s.engine.assistant.store, bindingId = s.engine.im.view().bindingId!;
  const project = s.store.addProject(s.directory, "Files");
  a.enqueue({ id: "file-turn", kind: "user", state: "completed", source: { kind: "im", bindingId }, text: "Send a file", rootCauseId: "file-turn", createdAt: 1, attempts: 1 }, "file-turn");
  mkdirSync(s.store.attachmentDir, { recursive: true });
  const publish = (messageId: string) => {
    const attachment = { id: randomUUID(), name: "report.txt", kind: "file" as const, mimeType: "text/plain", size: 6 };
    writeFileSync(attachmentPath(s.store, attachment.id), "report", { mode: 0o600 });
    a.message({ id: messageId, kind: "assistant", wakeupId: "file-turn", text: "", attachments: [attachment], streaming: false });
    a.putAction({ id: messageId, requestId: messageId, signature: messageId, action: "reply.attachments", input: { sources: [{ kind: "project-file", projectId: project.id, relativePath: "report.txt" }] },
      origin: { kind: "assistant", assistantId: a.get()!.id, actionId: messageId, wakeupId: "file-turn" }, rootCauseId: "file-turn", state: "completed", result: { messageId } });
    return attachment;
  };
  publish("file-one"); await s.engine.im.pump();
  expect(s.send.mock.calls[0][1].attachment).toMatchObject({ name: "report.txt", bytes: Buffer.from("report") });
  publish("file-two");
  const policy = a.get()!.policy;
  a.update({ policy: { ...policy, permissions: { ...policy.permissions, "files.read": false } } });
  await s.engine.im.pump();
  expect(s.send).toHaveBeenCalledOnce();
  expect(s.engine.im.view().deliveries).toMatchObject([{ state: "failed", error: "Permission denied: files.read" }]);
});

it("upgrades legacy binding scope in place and keeps IM routing on the default Bot and thread", async () => {
  const s = await setup(); await s.enable();
  const defaultScope = s.engine.assistant.store.scope;
  expect(s.engine.im.view().scope).toEqual(defaultScope);
  const other = s.engine.bots.store.createBot({ name: "Private", harness: "codex", model: "test" });
  const sibling = s.engine.bots.store.createThread(defaultScope.botId, { title: "Private sibling" });
  for (const scope of [other, sibling])
    s.engine.bots.assistant(scope).store.message({ id: "private", kind: "assistant", text: "Do not project another conversation" });
  await expect(s.engine.im.rpc("im.configure", { ...config, scope: other })).rejects.toThrow(/Unknown input field/);
  await expect(s.engine.im.rpc("im.control", { action: "enable", ...other })).rejects.toThrow(/Unknown input field/);
  const message = s.incoming("om_legacy_scope");
  await s.channels.at(-1)!.receive(message);
  await s.engine.im.pump();
  const inbox = s.engine.im.store.inbox(message.conversation.channelId)[0];
  s.engine.im.store.enqueue({ bindingId: inbox.bindingId, key: "stable-output", text: "Original output", threadId: "oc_private" });
  await s.engine.im.pump();
  const outbox = s.engine.im.store.outbox(inbox.bindingId)[0];
  const { scope: _scope, ...legacy } = s.engine.im.store.settings()!;
  s.store.db.prepare("UPDATE im_settings SET payload=? WHERE singleton=1").run(JSON.stringify(legacy));
  await s.restart();
  expect(s.engine.im.store.settings()).toEqual({ ...legacy, scope: defaultScope });
  expect(s.engine.im.store.inbox(inbox.bindingId)[0]).toEqual(inbox);
  expect(s.engine.im.store.outbox(inbox.bindingId)[0]).toEqual(outbox);
  await s.channels.at(-1)!.receive(message);
  await s.engine.im.pump();
  expect(s.engine.assistant.store.latestMessages().filter(entry => entry.kind === "user")).toHaveLength(1);
  expect(s.send).toHaveBeenCalledOnce();
  for (const scope of [other, sibling])
    expect(s.engine.bots.assistant(scope).store.latestMessages().filter(entry => entry.kind === "user")).toHaveLength(0);
  await s.engine.im.rpc("im.configure", { ...config, appSecret: "new-secret" });
  expect(s.engine.im.store.settings()).toMatchObject({ bindingId: legacy.bindingId, cursor: legacy.cursor, scope: defaultScope });
});

function registration() {
  const begin = vi.fn<FeishuRegistrationClient["begin"]>(async () => ({ deviceCode: "host-device-code", verificationUrl: "https://accounts.feishu.cn/bind?user_code=public-code", interval: 1000, expiresAt: Date.now() + 60_000 }));
  const poll = vi.fn<FeishuRegistrationClient["poll"]>(async () => ({ state: "pending" }));
  return { begin, poll };
}
const registered = { state: "complete" as const, appId: "cli_abcdef1234567890", appSecret: "new-private-secret", ownerOpenId: "ou_authorized" };

it("automatically configures and connects the authorized bot without exposing credentials or replaying history", async () => {
  const client = registration(), s = await setup({ registrationClient: client });
  s.engine.assistant.store.message({ id: "old-history", kind: "assistant", text: "Do not replay" });
  vi.useFakeTimers();
  client.poll.mockResolvedValueOnce(registered);
  const view = await s.engine.im.rpc("im.bind", { action: "start", language: "zh-CN" });
  expect(view.configured).toBe(false);
  expect(view.binding).toMatchObject({ state: "pending", verificationUrl: expect.stringContaining("user_code=") });
  expect(JSON.stringify(view)).not.toContain("host-device-code");
  const duplicate = await s.engine.im.rpc("im.bind", { action: "start", language: "zh-CN" });
  expect(duplicate.binding?.id).toBe(view.binding?.id);
  expect(client.begin).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000);
  expect(s.engine.im.store.settings()).toMatchObject({ appId: registered.appId, appSecret: registered.appSecret,
    ownerOpenId: registered.ownerOpenId, language: "zh-CN", enabled: true, activated: true,
    cursor: s.engine.assistant.store.get()!.chatRevision });
  expect(s.engine.im.view()).toMatchObject({ binding: { id: view.binding!.id, state: "completed" }, status: { state: "connected" } });
  expect(s.engine.im.view().binding?.verificationUrl).toBeUndefined();
  expect(JSON.stringify(s.engine.im.view())).not.toContain(registered.appSecret);
  expect(client.poll).toHaveBeenCalledWith("host-device-code", expect.any(AbortSignal));
  await s.engine.im.pump();
  expect(s.send).not.toHaveBeenCalled();
});

it("keeps the current connection until a successful replacement and retires its pending deliveries", async () => {
  const client = registration(), s = await setup({ registrationClient: client }); await s.enable();
  const previous = s.engine.im.store.settings()!;
  s.engine.im.store.enqueue({ bindingId: previous.bindingId, key: "retire", text: "Old pending output" });
  vi.useFakeTimers();
  await s.engine.im.rpc("im.bind", { action: "start" });
  expect(s.engine.im.store.settings()).toEqual(previous);
  expect(s.engine.im.view().status.state).toBe("connected");
  expect(s.engine.im.store.outbox(previous.bindingId)[0].state).toBe("pending");
  client.poll.mockResolvedValueOnce(registered);
  await vi.advanceTimersByTimeAsync(1000);
  expect(s.engine.im.view().config?.ownerOpenId).toBe(registered.ownerOpenId);
  expect(s.engine.im.view().bindingId).not.toBe(previous.bindingId);
  expect(s.engine.im.store.outbox(previous.bindingId)[0].state).toBe("discarded");
  expect(s.engine.im.view().status.state).toBe("connected");
});

it("ignores a late authorization after cancellation and scopes cancellation to its attempt", async () => {
  const client = registration(), s = await setup({ registrationClient: client }); await s.enable();
  const previous = s.engine.im.store.settings()!;
  let complete!: (result: FeishuRegistrationResult) => void;
  client.poll.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  vi.useFakeTimers();
  const first = await s.engine.im.rpc("im.bind", { action: "start" });
  await vi.advanceTimersByTimeAsync(1000);
  await s.engine.im.rpc("im.bind", { action: "cancel", bindingId: first.binding!.id });
  expect(s.engine.im.view().binding).toEqual({ id: first.binding!.id, state: "cancelled" });
  const second = await s.engine.im.rpc("im.bind", { action: "start" });
  expect(second.binding!.id).not.toBe(first.binding!.id);
  const staleCancel = await s.engine.im.rpc("im.bind", { action: "cancel", bindingId: first.binding!.id });
  expect(staleCancel.binding?.state).toBe("pending");
  complete(registered);
  await vi.advanceTimersByTimeAsync(0);
  expect(s.engine.im.store.settings()).toEqual(previous);
  expect(s.engine.im.view().binding).toEqual(second.binding);
  expect(s.channels).toHaveLength(1);
});

it("honors polling backoff and expires without changing a saved binding", async () => {
  const client = registration(), s = await setup({ registrationClient: client });
  await s.engine.im.rpc("im.configure", config);
  const previous = s.engine.im.store.settings();
  vi.useFakeTimers();
  client.begin.mockImplementationOnce(async () => ({ deviceCode: "private-code", verificationUrl: "https://accounts.feishu.cn/bind", interval: 1000, expiresAt: Date.now() + 8000 }));
  client.poll.mockResolvedValueOnce({ state: "slow_down" });
  await s.engine.im.rpc("im.bind", { action: "start" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(client.poll).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(5999);
  expect(client.poll).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(client.poll).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1000);
  expect(s.engine.im.view().binding?.state).toBe("expired");
  expect(s.engine.im.view().binding?.verificationUrl).toBeUndefined();
  expect(s.engine.im.store.settings()).toEqual(previous);
  expect(client.poll).toHaveBeenCalledTimes(2);
});

it("cancels registration when saved connection controls are used and keeps the secret Host-only on errors", async () => {
  const client = registration(), s = await setup({ registrationClient: client }); await s.enable();
  vi.useFakeTimers();
  await s.engine.im.rpc("im.bind", { action: "start" });
  await s.engine.im.rpc("im.control", { action: "disable" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(s.engine.im.view().binding?.state).toBe("cancelled");
  expect(client.poll).not.toHaveBeenCalled();
  client.poll.mockRejectedValueOnce(new Error("new-private-secret host-device-code"));
  await s.engine.im.rpc("im.bind", { action: "start" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(s.engine.im.view().binding).toMatchObject({ state: "failed", error: "Feishu binding failed. Try again." });
  expect(JSON.stringify(s.engine.im.view())).not.toMatch(/new-private-secret|host-device-code/);
  expect(s.engine.im.view().config?.appId).toBe(config.appId);
});

it("aborts a registration request when the Host shuts down", async () => {
  const client = registration(), s = await setup({ registrationClient: client });
  let requestSignal: AbortSignal | undefined;
  client.begin.mockImplementationOnce(signal => new Promise((_resolve, reject) => {
    requestSignal = signal;
    signal.addEventListener("abort", () => reject(new Error("Request cancelled")), { once: true });
  }));
  const request = s.engine.im.rpc("im.bind", { action: "start" });
  await vi.waitFor(() => expect(requestSignal).toBeDefined());
  await s.engine.im.close();
  await request;
  expect(requestSignal?.aborted).toBe(true);
  expect(s.engine.im.store.settings()).toBeUndefined();
});
