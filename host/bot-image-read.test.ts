import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { HostStore } from "./store";
import { BotThreadStore } from "./bots/thread/store";
import { attachmentPath, readAttachmentChunk, writeAttachmentChunk } from "./attachments";
import type { RemoteAttachment } from "../src/features/connections/model/protocol";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(fn => fn()));
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "assistant-image-read-"));
  const store = new HostStore(join(dir, "host.db"));
  cleanup.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const assistant = new BotThreadStore(store);
  assistant.initialize({ harness: "codex", model: "test" });
  const file: RemoteAttachment = { id: randomUUID(), name: "photo.png", kind: "image", mimeType: "image/png", size: 600000 };
  const bytes = Buffer.alloc(file.size, 123);
  for (let offset = 0; offset < bytes.length; offset += 512 * 1024)
    writeAttachmentChunk(store, { id: file.id, offset, size: file.size, data: bytes.subarray(offset, offset + 512 * 1024).toString("base64") });
  return { store, assistant, file, bytes };
}
it.each(["user", "assistant"] as const)("reads persisted %s images in bounded chunks using their public message", kind => {
  const { store, assistant, file, bytes } = setup();
  assistant.message({ id: "public", kind, text: "", attachments: [file] });
  const first = readAttachmentChunk(store, { messageId: "public", id: file.id, offset: 0 });
  const last = readAttachmentChunk(store, { messageId: "public", id: file.id, offset: first.offset });
  expect(first.offset).toBeLessThan(file.size);
  expect(first.offset % 3).toBe(0);
  expect(last.offset).toBe(file.size);
  expect(Buffer.from(first.data + last.data, "base64")).toEqual(bytes);
});
it("rejects unpublished, wrong-message and removed images, invalid offsets and incomplete bytes", () => {
  const { store, assistant, file } = setup();
  const read = (extra = {}) => readAttachmentChunk(store, { messageId: "public", id: file.id, offset: 0, ...extra });
  expect(() => read()).toThrow("not found");
  assistant.message({ id: "public", kind: "user", text: "", attachments: [file] });
  assistant.message({ id: "other", kind: "assistant", text: "No image" });
  expect(() => read({ messageId: "other" })).toThrow("not found");
  expect(() => read({ sessionId: "private-brain" })).toThrow("Invalid attachment message");
  expect(() => read({ offset: -1 })).toThrow("offset");
  expect(() => read({ offset: file.size + 1 })).toThrow("offset");
  truncateSync(attachmentPath(store, file.id), 1);
  expect(() => read()).toThrow("incomplete");
  assistant.message({ id: "public", kind: "user", text: "removed" });
  expect(() => read()).toThrow("not found");
});
