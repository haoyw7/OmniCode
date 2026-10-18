import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, unlink } from "node:fs/promises";
import { basename, isAbsolute, win32 } from "node:path";
import type { BotThreadRuntime } from "./index";
import { signature } from "./store";
import { checkPolicy, fields, id, object } from "./policy";
import { attachmentPath, MAX_REMOTE_ATTACHMENT_BYTES } from "../../attachments";
import { claimCheckoutResource } from "../../checkout-guards";
import { resolveHostWorktreeAsync } from "../../git-worktrees";
import { existingPath } from "../../workspace";
import { sniffImageMime } from "../../../src/features/connections/files/model/filePreview";
import type { RemoteAttachment } from "../../../src/features/connections/model/protocol";
import { currentMachineIO, localMachineIO, machineFs, withMachineIO } from "../../machine-io";

type ReplyAttachmentSource =
  | {
      kind: "project-file";
      projectId: string;
      sessionId?: string;
      relativePath: string;
    }
  | {
      kind: "session-attachment";
      projectId: string;
      sessionId: string;
      attachmentId: string;
    };
type ReplyAttachmentInput = { text: string; sources: ReplyAttachmentSource[] };

function parseInput(input: Record<string, unknown>): ReplyAttachmentInput {
  fields(input, ["text", "sources"]);
  const text = input.text ?? "";
  if (typeof text !== "string" || text.length > 1000000 || text.includes("\0"))
    throw new Error("Invalid attachment reply text");
  if (
    !Array.isArray(input.sources) ||
    !input.sources.length ||
    input.sources.length > 20
  )
    throw new Error("Choose between 1 and 20 reply attachments");
  const sources = input.sources.map((raw): ReplyAttachmentSource => {
    const source = object(raw),
      projectId = id(source.projectId, "project");
    if (source.kind === "project-file") {
      fields(source, ["kind", "projectId", "sessionId", "relativePath"]);
      const relativePath = id(
        source.relativePath,
        "relative attachment path",
        4096,
      );
      if (
        isAbsolute(relativePath) ||
        win32.isAbsolute(relativePath) ||
        relativePath.split(/[\\/]/).includes("..")
      )
        throw new Error(
          "Choose a file relative to its project or working copy",
        );
      return {
        kind: "project-file",
        projectId,
        relativePath,
        ...(source.sessionId === undefined
          ? {}
          : { sessionId: id(source.sessionId, "session") }),
      };
    }
    if (source.kind === "session-attachment") {
      fields(source, ["kind", "projectId", "sessionId", "attachmentId"]);
      return {
        kind: "session-attachment",
        projectId,
        sessionId: id(source.sessionId, "session"),
        attachmentId: id(source.attachmentId, "attachment"),
      };
    }
    throw new Error("Unsupported reply attachment source");
  });
  return { text, sources };
}

/** Recheck queued publication against current policy without reading source paths. */
export function assertReplyAttachmentAccess(
  assistant: BotThreadRuntime,
  input: Record<string, unknown>,
  authorized: () => boolean = () => true,
): void {
  const { sources } = parseInput(input);
  const config = assistant.store.get();
  if (!config?.enabled || !authorized())
    throw new Error("Assistant control was revoked");
  for (const source of sources) {
    const project = assistant.engine.store.project(source.projectId);
    if (project.kind) throw new Error("Internal project is private");
    checkPolicy(config.policy, "files.read", project.id);
    if (source.sessionId) {
      checkPolicy(config.policy, "sessions.read", project.id);
      const session = assistant.engine.store.session(source.sessionId);
      if (session.projectId !== project.id)
        throw new Error("Session does not belong to this project");
      if (session.session.assistantOwnerId)
        throw new Error("Assistant brain is private");
    }
  }
}

async function sourceFile(
  assistant: BotThreadRuntime,
  source: ReplyAttachmentSource,
) {
  const store = assistant.engine.store,
    project = store.project(source.projectId);
  if (source.kind === "session-attachment") {
    const ref = store
      .session(source.sessionId)
      .session.blocks.flatMap((block) => block.attachments ?? [])
      .find((file) => file.id === source.attachmentId);
    if (!ref || !["image", "file"].includes(ref.kind))
      throw new Error("Image or file attachment was not found in this session");
    // Never follow transcript paths or inline tool payloads. Only Host UUID files qualify.
    return {
      path: attachmentPath(store, ref.id),
      name: ref.name,
      expectedSize: ref.size,
      mimeType: ref.mimeType,
    };
  }
  const root = await machineFs.realpath(
    source.sessionId
      ? await resolveHostWorktreeAsync(
          project.cwd,
          store.session(source.sessionId).session.executionCwd,
        )
      : project.cwd,
  );
  return {
    path: await existingPath(root, source.relativePath),
    name: basename(source.relativePath),
    expectedSize: undefined,
    mimeType: undefined,
  };
}

async function boundedBytes(path: string): Promise<Buffer> {
  if (currentMachineIO().key !== "local") {
    const before = await machineFs.lstat(path);
    if (!before.isFile() || before.isSymbolicLink()) throw new Error("Choose a regular file attachment");
    if (before.size > MAX_REMOTE_ATTACHMENT_BYTES) throw new Error("Attachments must be at most 20 MB");
    const bytes = await machineFs.readPrefix(path, MAX_REMOTE_ATTACHMENT_BYTES + 1, { noFollow: true });
    const after = await machineFs.lstat(path);
    if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || !after.isFile() || after.isSymbolicLink())
      throw new Error("Attachment changed while being read; retry after it finishes writing");
    return bytes;
  }
  const file = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("Choose a regular file attachment");
    if (info.size > MAX_REMOTE_ATTACHMENT_BYTES)
      throw new Error("Attachments must be at most 20 MB");
    const parts: Buffer[] = [];
    let size = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(
        Math.min(64 * 1024, MAX_REMOTE_ATTACHMENT_BYTES + 1 - size),
      );
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > MAX_REMOTE_ATTACHMENT_BYTES)
        throw new Error("Attachments must be at most 20 MB");
      parts.push(chunk.subarray(0, bytesRead));
    }
    if (size !== info.size)
      throw new Error(
        "Attachment changed while being read; retry after it finishes writing",
      );
    return Buffer.concat(parts, size);
  } finally {
    await file.close();
  }
}

// Bound memory and make concurrent retries observe the first committed publication.
const publications = new WeakMap<BotThreadRuntime, Promise<unknown>>();
export function publishReplyAttachments(
  assistant: BotThreadRuntime,
  requestId: string,
  input: Record<string, unknown>,
  authorized: () => boolean,
): Promise<unknown> {
  const next = (publications.get(assistant) ?? Promise.resolve()).then(() =>
    publish(assistant, requestId, input, authorized),
  );
  publications.set(
    assistant,
    next.catch(() => undefined),
  );
  return next;
}

async function publish(
  assistant: BotThreadRuntime,
  requestId: string,
  input: Record<string, unknown>,
  authorized: () => boolean,
) {
  const { text, sources } = parseInput(input),
    store = assistant.store;
  const config = store.get();
  if (!config) throw new Error("Assistant is not configured");
  const check = () => assertReplyAttachmentAccess(assistant, input, authorized);
  check();
  const sig = signature({
    action: "reply.attachments",
    input,
    assistantId: config.id,
  });
  const previous = store.action(requestId);
  if (previous) {
    if (previous.signature !== sig)
      throw new Error("Request ID was already used with different input");
    if (previous.state !== "completed")
      throw new Error(previous.error ?? "Attachment publication is incomplete");
    return previous.result;
  }
  const wakeup = assistant.currentWakeup(),
    actionId = randomUUID();
  const snapshots: string[] = [],
    attachments: RemoteAttachment[] = [];
  let committed = false;
  try {
    for (const source of sources) {
      check();
      const machine = assistant.engine.store.project(source.projectId).machine;
      if (source.kind === "project-file" && machine && !assistant.engine.machines)
        throw new Error("WSL execution is unavailable on this Host");
      const io = source.kind === "session-attachment" ? localMachineIO : assistant.engine.machines?.io(machine) ?? localMachineIO;
      const { file, bytes } = await withMachineIO(io, async () => {
        const file = await sourceFile(assistant, source);
        check();
        const release = claimCheckoutResource(assistant.engine.store, `assistant-attachment:${randomUUID()}`, file.path);
        try { return { file, bytes: await boundedBytes(file.path) }; }
        finally { release(); }
      });
      {
        if (
          file.expectedSize !== undefined &&
          bytes.length !== file.expectedSize
        )
          throw new Error("Session attachment is incomplete");
        check();
        const attachmentId = randomUUID(),
          path = attachmentPath(assistant.engine.store, attachmentId);
        await mkdir(assistant.engine.store.attachmentDir, {
          recursive: true,
          mode: 0o700,
        });
        const output = await open(path, "wx", 0o600);
        snapshots.push(path);
        try {
          await output.writeFile(bytes);
          await output.sync();
        } finally {
          await output.close();
        }
        const imageMime = sniffImageMime(bytes);
        attachments.push({
          id: attachmentId,
          name:
            basename(file.name.replaceAll("\\", "/"))
              .replaceAll("\0", "")
              .slice(0, 255) || "attachment",
          kind: imageMime ? "image" : "file",
          mimeType:
            imageMime ??
            (file.mimeType?.startsWith("image/") ? undefined : file.mimeType) ??
            "application/octet-stream",
          size: bytes.length,
        });
      }
    }
    check();
    if (assistant.currentWakeup().id !== wakeup.id)
      throw new Error("Assistant turn changed");
    const result = store.host.transaction(() => {
      const message = store.message({
        id: `attachment-reply:${actionId}`,
        kind: "assistant",
        text,
        attachments,
        streaming: false,
        wakeupId: wakeup.id,
      });
      const result = {
        messageId: message.id,
        revision: message.revision,
        attachments,
      };
      store.putAction({
        id: actionId,
        requestId,
        signature: sig,
        action: "reply.attachments",
        input,
        rootCauseId: wakeup.rootCauseId,
        origin: {
          kind: "assistant",
          assistantId: config.id,
          botId: store.botId,
          threadId: store.threadId,
          assistantName: config.name,
          actionId,
          wakeupId: wakeup.id,
        },
        state: "completed",
        result,
      });
      return result;
    });
    committed = true;
    return result;
  } finally {
    if (!committed)
      await Promise.all(
        snapshots.map((path) => unlink(path).catch(() => undefined)),
      );
  }
}
