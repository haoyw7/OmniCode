import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { attachmentPath, writeAttachmentChunk } from "../../attachments";
import * as worktrees from "../../git-worktrees";
import type { HostProvider } from "../../providers";
import { executeBotAction } from "./control";
import { assertReplyAttachmentAccess } from "./attachments";
import type { RemoteAttachment } from "../../../src/features/connections/model/protocol";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const run of cleanup.splice(0)) await run();
});
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "assistant-attachments-"));
  const projectDir = join(directory, "project"),
    dataDir = join(directory, "host");
  mkdirSync(projectDir);
  mkdirSync(dataDir);
  const store = new HostStore(join(dataDir, "host.db"));
  const project = store.addProject(projectDir, "Project");
  const finishes: (() => void)[] = [];
  const provider: HostProvider = {
    send: vi.fn(() => new Promise<void>((finish) => finishes.push(finish))),
    stop: vi.fn(async () => {
      finishes.forEach((finish) => finish());
    }),
    cancel: vi.fn(async () => {
      finishes.forEach((finish) => finish());
    }),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const engine = new HostEngine(store, { codex: provider });
  cleanup.push(async () => {
    await engine.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await engine.ready;
  engine.assistant.setCatalog(
    async () => ["codex"],
    async () => ({
      models: { codex: [{ id: "test", name: "Test" }] },
      errors: {},
    }),
  );
  await engine.assistant.rpc("assistant.configure", {
    commandId: "setup",
    expectedRevision: 0,
    patch: {
      harness: "codex",
      model: "test",
      triggers: { user: true, event: false, schedule: false },
    },
  });
  const receipt = await engine.assistant.receiveImMessage({
    commandId: "incoming",
    text: "Send the result",
    bindingId: "owner",
  });
  await vi.waitFor(() => expect(provider.send).toHaveBeenCalledOnce());
  const publish = (requestId: string, input: Record<string, unknown>) =>
    executeBotAction(
      engine.assistant,
      requestId,
      "reply.attachments",
      input,
      () => true,
    ) as Promise<{
      messageId: string;
      revision: number;
      attachments: RemoteAttachment[];
    }>;
  const files = () => {
    try {
      return readdirSync(store.attachmentDir);
    } catch {
      return [];
    }
  };
  const createSession = () =>
    engine.command({
      type: "create",
      commandId: randomUUID(),
      projectId: project.id,
      harness: "codex",
      model: "test",
      runtimeMode: "supervised",
    }).sessionId;
  return {
    engine,
    store,
    project,
    directory,
    publish,
    files,
    receipt,
    createSession,
  };
}

it("publishes immutable, explicitly selected snapshots once across concurrent retries", async () => {
  const { engine, store, project, publish, receipt, files } = await setup();
  const original = join(project.cwd, "report.txt");
  writeFileSync(original, "The requested report");
  const input = {
    text: "Here is the report",
    sources: [
      {
        kind: "project-file",
        projectId: project.id,
        relativePath: "report.txt",
      },
    ],
  };
  const [result, retry] = await Promise.all([
    publish("report", input),
    publish("report", input),
  ]);
  expect(retry).toEqual(result);
  expect(files()).toHaveLength(1);
  expect(
    engine.assistant.store
      .latestMessages()
      .find((message) => message.id === result.messageId),
  ).toMatchObject({
    kind: "assistant",
    streaming: false,
    wakeupId: receipt.wakeupId,
    text: input.text,
    attachments: result.attachments,
  });
  expect(result.attachments[0]).toMatchObject({
    name: "report.txt",
    kind: "file",
    size: 20,
  });
  expect(JSON.stringify(result)).not.toContain(project.cwd);
  writeFileSync(original, "Changed after publication");
  expect(
    readFileSync(attachmentPath(store, result.attachments[0].id), "utf8"),
  ).toBe("The requested report");
  expect(await publish("report", input)).toEqual(result);
  await expect(
    publish("report", { ...input, text: "Changed" }),
  ).rejects.toThrow(/different input/);
  const action = engine.assistant.store.action("report")!;
  expect(action).toMatchObject({
    state: "completed",
    input,
    result: { messageId: result.messageId },
    origin: { wakeupId: receipt.wakeupId },
  });
});

it("copies a selected registered session image without trusting transcript paths", async () => {
  const { engine, store, project, publish, createSession } = await setup();
  const attachmentId = randomUUID(),
    sessionId = createSession();
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeAttachmentChunk(store, {
    id: attachmentId,
    offset: 0,
    size: bytes.length,
    data: bytes.toString("base64"),
  });
  const session = store.session(sessionId);
  store.save(
    {
      ...session,
      revision: session.revision + 1,
      session: {
        ...session.session,
        blocks: [
          {
            id: "image",
            role: "tool",
            text: "PRIVATE TOOL OUTPUT",
            attachments: [
              {
                id: attachmentId,
                name: "chart.png",
                kind: "image",
                mimeType: "image/png",
                size: bytes.length,
                path: "/arbitrary/path/that/must/not/be/read.png",
              },
            ],
          },
        ],
      },
    },
    {},
  );
  expect(
    engine.assistant.store
      .latestMessages()
      .filter((message) => message.kind === "assistant"),
  ).toEqual([]);
  const result = await publish("image", {
    sources: [
      {
        kind: "session-attachment",
        projectId: project.id,
        sessionId,
        attachmentId,
      },
    ],
  });
  expect(result.attachments[0]).toMatchObject({
    kind: "image",
    mimeType: "image/png",
    name: "chart.png",
  });
  expect(result.attachments[0].id).not.toBe(attachmentId);
  expect(readFileSync(attachmentPath(store, result.attachments[0].id))).toEqual(
    bytes,
  );
  expect(JSON.stringify(engine.assistant.store.latestMessages())).not.toContain(
    "PRIVATE TOOL OUTPUT",
  );
  await expect(
    publish("wrong-session", {
      sources: [
        {
          kind: "session-attachment",
          projectId: project.id,
          sessionId: createSession(),
          attachmentId,
        },
      ],
    }),
  ).rejects.toThrow(/not found/);
});

it("rejects arbitrary local paths, symlink escapes, private sessions and files outside scope", async () => {
  const { engine, store, project, directory, publish, files } = await setup();
  writeFileSync(join(project.cwd, "safe.txt"), "Safe");
  writeFileSync(join(directory, "private.txt"), "Private");
  const source = {
    kind: "project-file",
    projectId: project.id,
    relativePath: "safe.txt",
  };
  for (const relativePath of [
    join(directory, "private.txt"),
    "../private.txt",
    "C:\\private.txt",
    ".git/config",
  ]) {
    await expect(
      publish(randomUUID(), { sources: [{ ...source, relativePath }] }),
    ).rejects.toThrow();
  }
  if (process.platform !== "win32") {
    symlinkSync(
      join(directory, "private.txt"),
      join(project.cwd, "escape.txt"),
    );
    await expect(
      publish("symlink", {
        sources: [{ ...source, relativePath: "escape.txt" }],
      }),
    ).rejects.toThrow(/outside/);
  }
  const brain = store.session(engine.assistant.store.get()!.brainSessionId!);
  await expect(
    publish("private-brain", {
      sources: [
        { ...source, projectId: brain.projectId, sessionId: brain.session.id },
      ],
    }),
  ).rejects.toThrow(/private/);
  const config = engine.assistant.store.get()!;
  engine.assistant.store.update({
    policy: { ...config.policy, allowedProjects: [] },
  });
  await expect(publish("scope", { sources: [source] })).rejects.toThrow(
    /scope denied/,
  );
  expect(files()).toEqual([]);
});

it("uses only a selected session's registered worktree as its relative file root", async () => {
  const { store, project, directory, publish, createSession } = await setup();
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: project.cwd, stdio: "pipe" });
  git("init", "-q");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-qm",
    "Initial",
  );
  const worktree = join(directory, "worktree");
  git("worktree", "add", "-q", "-b", "attachment-test", worktree);
  writeFileSync(join(worktree, "result.txt"), "Working-copy result");
  const sessionId = createSession(),
    session = store.session(sessionId);
  store.save(
    {
      ...session,
      revision: session.revision + 1,
      session: { ...session.session, executionCwd: worktree },
    },
    {},
  );
  const source = {
    kind: "project-file",
    projectId: project.id,
    sessionId,
    relativePath: "result.txt",
  };
  const result = await publish("worktree", { sources: [source] });
  expect(
    readFileSync(attachmentPath(store, result.attachments[0].id), "utf8"),
  ).toBe("Working-copy result");
  const current = store.session(sessionId);
  store.save(
    {
      ...current,
      revision: current.revision + 1,
      session: { ...current.session, executionCwd: directory },
    },
    {},
  );
  await expect(publish("unregistered", { sources: [source] })).rejects.toThrow(
    /available worktree/,
  );
});

it("rechecks file access after async resolution and when inspecting a queued publication", async () => {
  const { engine, project, publish, createSession, files } = await setup();
  writeFileSync(join(project.cwd, "report.txt"), "Report");
  const input = {
    sources: [
      {
        kind: "project-file",
        projectId: project.id,
        sessionId: createSession(),
        relativePath: "report.txt",
      },
    ],
  };
  const completed = await publish("completed", input);
  expect(completed.messageId).toBeTruthy();
  let release!: (root: string) => void;
  const resolution = vi
    .spyOn(worktrees, "resolveHostWorktreeAsync")
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
  const pending = publish("revoked", input);
  await vi.waitFor(() => expect(resolution).toHaveBeenCalledOnce());
  const policy = engine.assistant.store.get()!.policy;
  engine.assistant.store.update({
    policy: {
      ...policy,
      permissions: { ...policy.permissions, "files.read": false },
    },
  });
  release(project.cwd);
  await expect(pending).rejects.toThrow(/Permission denied/);
  expect(files()).toHaveLength(1);
  expect(() => assertReplyAttachmentAccess(engine.assistant, input)).toThrow(
    /Permission denied/,
  );
  await expect(
    executeBotAction(
      engine.assistant,
      "inspect",
      "actions.get",
      { requestId: "completed" },
      () => true,
    ),
  ).rejects.toThrow(/Permission denied/);
});

it("cleans snapshots and rolls back public messages when the publication transaction fails", async () => {
  const { engine, store, project, publish, files } = await setup();
  writeFileSync(join(project.cwd, "report.txt"), "Report");
  store.db.exec(
    "CREATE TRIGGER fail_publication BEFORE INSERT ON bot_actions BEGIN SELECT RAISE(ABORT, 'storage failed'); END",
  );
  await expect(
    publish("failed", {
      sources: [
        {
          kind: "project-file",
          projectId: project.id,
          relativePath: "report.txt",
        },
      ],
    }),
  ).rejects.toThrow(/storage failed/);
  expect(
    engine.assistant.store
      .latestMessages()
      .filter((message) => message.kind === "assistant"),
  ).toEqual([]);
  expect(engine.assistant.store.action("failed")).toBeUndefined();
  expect(files()).toEqual([]);
});

it("rejects too many or oversized attachments without publishing a partial selection", async () => {
  const { engine, project, publish, files } = await setup();
  writeFileSync(join(project.cwd, "small.txt"), "Small");
  writeFileSync(join(project.cwd, "large.bin"), "");
  truncateSync(join(project.cwd, "large.bin"), 20 * 1024 * 1024 + 1);
  const source = {
    kind: "project-file",
    projectId: project.id,
    relativePath: "small.txt",
  };
  await expect(
    publish("too-many", { sources: Array(21).fill(source) }),
  ).rejects.toThrow(/20/);
  await expect(
    publish("too-large", {
      sources: [source, { ...source, relativePath: "large.bin" }],
    }),
  ).rejects.toThrow(/20 MB/);
  expect(files()).toEqual([]);
  expect(
    engine.assistant.store
      .latestMessages()
      .filter((message) => message.kind === "assistant"),
  ).toEqual([]);
});
