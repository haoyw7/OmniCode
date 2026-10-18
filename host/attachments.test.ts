import { newSession } from "../src/features/sessions/model/session";
import { applyHarnessEvent } from "../src/integrations/harness/core/apply";
import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { BotThreadStore } from "./bots/thread/store";
import { BotStore } from "./bots/store";
import { writeAttachmentChunk, saveGeneratedImageAttachment, readAttachmentChunk } from "./attachments";

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

it("requires the owning Bot and Thread for new message attachments and keeps legacy reads on the default thread", () => {
  const directory = mkdtempSync(join(tmpdir(), "bot-attachment-test-"));
  const host = new HostStore(join(directory, "host.db"));
  cleanups.push(() => { host.close(); rmSync(directory, { recursive: true, force: true }); });
  const legacy = new BotThreadStore(host);
  legacy.initialize({ harness: "codex", model: "test" });
  const bots = new BotStore(host);
  const second = bots.createBot({ harness: "codex", model: "test", name: "Second" });
  const thread = bots.createThread(second.botId, { title: "Separate" });
  const file = saveGeneratedImageAttachment(host,
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "image.png");
  const owned = new BotThreadStore(host, second);
  owned.message({ id: "same-message", kind: "assistant", text: "", attachments: [file] });
  legacy.message({ id: "same-message", kind: "assistant", text: "No attachment" });
  const input = { messageId: "same-message", id: file.id, offset: 0 };
  expect(readAttachmentChunk(host, { ...input, ...second }).size).toBe(file.size);
  expect(() => readAttachmentChunk(host, input)).toThrow("Attachment not found");
  expect(() => readAttachmentChunk(host, { ...input, ...thread })).toThrow("Attachment not found");
  expect(() => readAttachmentChunk(host, { ...input, botId: legacy.botId, threadId: second.threadId })).toThrow();
  expect(() => readAttachmentChunk(host, { ...input, botId: second.botId })).toThrow("Invalid attachment scope");
  legacy.message({ id: "legacy-file", kind: "user", text: "", attachments: [file], readAt: null });
  expect(readAttachmentChunk(host, { ...input, messageId: "legacy-file" }).size).toBe(file.size);
});

it("saves bounded generated PNGs as ordinary private attachments", () => {
  const directory = mkdtempSync(join(tmpdir(), "generated-attachment-test-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
  const file = saveGeneratedImageAttachment(store, png, "image.png");
  expect(file).toMatchObject({ kind: "image", mimeType: "image/png", size: Buffer.from(png, "base64").length });
  expect(readFileSync(file.path!).toString("base64")).toBe(png);
  expect(() => saveGeneratedImageAttachment(store, "broken", "bad.png")).toThrow();
});

it("accepts ordered chunks and an identical retry while rejecting changes", () => {
  const directory = mkdtempSync(join(tmpdir(), "remote-upload-test-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const chunk = (offset: number, data: string) =>
    writeAttachmentChunk(store, {
      id,
      offset,
      size: 6,
      data: Buffer.from(data).toString("base64"),
    });
  expect(chunk(0, "abc")).toEqual({ offset: 3 });
  expect(chunk(0, "abc")).toEqual({ offset: 3 });
  expect(() => chunk(0, "xyz")).toThrow("does not match");
  expect(() => chunk(4, "ef")).toThrow("out of order");
  expect(chunk(3, "def")).toEqual({ offset: 6 });
  expect(() =>
    writeAttachmentChunk(store, {
      id: "../escape",
      offset: 0,
      size: 1,
      data: "YQ==",
    }),
  ).toThrow("Invalid attachment ID");
});


it("authorizes nested images through their owning session and syncs child changes", () => {
  const directory = mkdtempSync(join(tmpdir(), "nested-attachment-test-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const project = store.addProject("/repo", "Repo");
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
  const file = saveGeneratedImageAttachment(store, png, "image.png");
  let session = newSession("codex", "/repo");
  session = applyHarnessEvent(session, { type: "tool.started", callId: "spawn", kind: "agent", title: "Child" });
  const first = store.save({ projectId: project.id, session, revision: 1, updatedAt: 1, status: "running" }, { type: "send" });
  session = applyHarnessEvent(session, { type: "image.generated", agentCallId: "spawn", itemId: "image", path: file.path!, name: file.name, size: file.size, mimeType: file.mimeType, attachment: file });
  store.save({ ...first, session, revision: first.revision + 1 }, { type: "update" });
  expect(readAttachmentChunk(store, { sessionId: session.id, id: file.id, offset: 0 }).data).toBe(png);
  const sync = store.sync(session.id, first.revision);
  expect(sync.kind).toBe("delta");
  if (sync.kind === "delta") expect(sync.blocks[0].agentRun!.transcript![0].attachments![0].id).toBe(file.id);
});
