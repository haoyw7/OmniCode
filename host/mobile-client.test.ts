import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { HostEngine } from "./engine";
import { HostSkills } from "./skills";
import { HostStore } from "./store";
import { createHostServer } from "./server";
import type { HostProvider } from "./providers";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import {
  MobileClient,
  HostRequestError,
  type RpcTransport,
} from "../src/mobile/client";
import type { MobileStorage, StorageKey } from "../src/mobile/storage";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "monocode-mobile-integration-"));
  const store = new HostStore(join(directory, "host.db"));
  let turn: SendTurnInput | undefined;
  let finish = () => {};
  const provider: HostProvider = {
    send: vi.fn((input) => {
      turn = input;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    }),
    bind: vi.fn(),
    stop: vi.fn(async () => finish()),
    cancel: vi.fn(async () => finish()),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const skillCatalog = new HostSkills(join(directory, "skill-home"), join(directory, "managed"));
  const engine = new HostEngine(store, { codex: provider }, skillCatalog);
  const project = await engine.openProject(directory);
  const server = createHostServer(engine, ["codex"]);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const device = store.issueDevice("Mobile test", "123");
  const values = new Map<StorageKey, string>();
  const storage: MobileStorage = {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    remove: async (key) => {
      values.delete(key);
    },
  };
  let loseNextReceipt = false;
  const transport: RpcTransport = async (_endpoint, token, request) => {
    const response = await fetch(`${endpoint}/rpc`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
    const result = (await response.json()) as {
      result?: unknown;
      error?: string;
    };
    if (!response.ok)
      throw new HostRequestError(result.error!, response.status);
    if (
      loseNextReceipt &&
      (request as { method: string }).method === "commands.dispatch"
    ) {
      loseNextReceipt = false;
      throw new Error("Simulated lost response");
    }
    return result.result;
  };
  const client = new MobileClient(storage, transport);
  cleanups.push(async () => {
    finish();
    await engine.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await client.connect(endpoint, device.token);
  return {
    directory,
    store,
    engine,
    project,
    client,
    provider,
    skillCatalog,
    device,
    endpoint,
    transport,
    turn: () => turn!,
    finish: () => finish(),
    loseNextReceipt: () => {
      loseNextReceipt = true;
    },
  };
}

describe("mobile client against the real MonoCode Host", () => {
  it("pairs only one phone per QR and restores its private credential without reusing the code", async () => {
    const s = await setup();
    const issued = s.store.issuePairingDevice("New phone");
    const pairingTransport: RpcTransport = async (endpoint, token, request, options) => {
      if ((request as { method: string }).method === "environment.describe")
        throw new Error("A second descriptor request is unavailable");
      return s.transport(endpoint, token, request, options);
    };
    const phones = Array.from({ length: 2 }, () => {
      const values = new Map<StorageKey, string>();
      const storage: MobileStorage = {
        get: async key => values.get(key) ?? null,
        set: async (key, value) => { values.set(key, value); },
        remove: async key => { values.delete(key); },
      };
      return { client: new MobileClient(storage, pairingTransport), storage, values };
    });
    const attempts = await Promise.allSettled(phones.map(phone => phone.client.connect(s.endpoint, issued.token)));
    expect(attempts.filter(attempt => attempt.status === "fulfilled")).toHaveLength(1);
    const winner = phones[attempts.findIndex(attempt => attempt.status === "fulfilled")];
    const loser = phones[attempts.findIndex(attempt => attempt.status === "rejected")];
    const rejected = attempts.find(attempt => attempt.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409, message: expect.stringContaining("already been used") });
    const saved = JSON.parse(winner.values.get("connection")!);
    expect(saved.token).not.toBe(issued.token);
    expect(s.store.authenticated(saved.token)).toBe(true);
    expect(JSON.stringify([...winner.values])).not.toContain(issued.token);
    expect(loser.values.has("connection")).toBe(false);
    expect(await winner.client.projects()).toContainEqual(s.project);
    const restored = new MobileClient(winner.storage, s.transport);
    expect(await restored.restore()).toBe(true);
    expect(await restored.projects()).toContainEqual(s.project);
    await expect(loser.client.connect(s.endpoint, issued.token)).rejects.toThrow("already been used");
  });

  it("loads Host skills, expands them once for execution and preserves original text across queue, steering and a lost receipt", async () => {
    const s = await setup();
    s.provider.steer = vi.fn(async () => {});
    const path = join(s.directory, ".agents/skills/review/SKILL.md");
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "---\nname: review\ndescription: Review 中文\n---\nSecret fixture review instructions");
    const catalog = await s.client.skills(s.project.id, "codex");
    expect(catalog.skills).toContainEqual(expect.objectContaining({ name: "review", invocation: "review", description: "Review 中文", scope: "project" }));
    expect(JSON.stringify(catalog)).not.toContain("Secret fixture review instructions");
    s.loseNextReceipt();
    await expect(s.client.dispatch({ type: "create", commandId: "skills-first-create", projectId: s.project.id,
      harness: "codex", model: "codex:test", runtimeMode: "supervised" }, "/review first")).rejects.toThrow("lost response");
    const receipt = await s.client.retryPending();
    await vi.waitFor(() => expect(s.provider.send).toHaveBeenCalledTimes(1));
    expect(s.turn().text).toContain("Secret fixture review instructions");
    expect(s.turn().text.endsWith("/review first")).toBe(true);
    expect((await s.client.session(receipt.sessionId)).session.blocks.find(block => block.role === "user")?.text).toBe("/review first");
    await s.client.dispatch({ type: "send", commandId: "skills-queued", sessionId: receipt.sessionId, text: "/review queued" });
    expect((await s.client.session(receipt.sessionId)).session.queuedMessages?.[0].text).toBe("/review queued");
    s.finish();
    await vi.waitFor(() => expect(s.provider.send).toHaveBeenCalledTimes(2));
    expect(s.turn().text.endsWith("/review queued")).toBe(true);
    expect(s.turn().text).toContain("Secret fixture review instructions");
    await s.client.dispatch({ type: "send", commandId: "skills-to-steer", sessionId: receipt.sessionId, text: "/review interrupt" });
    await s.client.dispatch({ type: "queue", action: "steer", commandId: "skills-steer", sessionId: receipt.sessionId, messageId: "skills-to-steer", runId: s.store.session(receipt.sessionId).runId });
    await vi.waitFor(() => expect(s.provider.steer).toHaveBeenCalledOnce());
    expect(vi.mocked(s.provider.steer).mock.calls[0][0].text).toContain("Secret fixture review instructions");
    expect((await s.client.session(receipt.sessionId)).session.blocks.some(block => block.role === "user" && block.text === "/review interrupt")).toBe(true);
    await expect(s.client.skills(s.project.id, "pi", receipt.sessionId)).rejects.toThrow("another project or Agent");
    const other = await s.client.openProject(join(s.directory, ".agents"));
    await expect(s.client.skills(other.id, "codex", receipt.sessionId)).rejects.toThrow("another project or Agent");
  });

  it("does not launch a provider after cancelling asynchronous skill preparation", async () => {
    const s = await setup();
    let complete!: (text: string) => void;
    vi.spyOn(s.skillCatalog, "prepare").mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const receipt = await s.client.dispatch({ type: "create", commandId: "cancel-skill-create", projectId: s.project.id,
      harness: "codex", model: "codex:test", runtimeMode: "supervised" }, "/review waiting");
    await vi.waitFor(() => expect(s.skillCatalog.prepare).toHaveBeenCalledOnce());
    const current = await s.client.session(receipt.sessionId);
    await s.client.dispatch({ type: "cancel", commandId: "cancel-skill", sessionId: receipt.sessionId, runId: current.runId! });
    complete("Prepared too late");
    await vi.waitFor(() => expect(s.store.session(receipt.sessionId).status).toBe("idle"));
    expect(s.provider.send).not.toHaveBeenCalled();
  });
  it("reads temporary image files outside registered projects through authenticated mobile RPC", async () => {
    const s = await setup();
    const outside = mkdtempSync(join(tmpdir(), "monocode-mobile-image-preview-"));
    cleanups.push(async () => rmSync(outside, { recursive: true, force: true }));
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7X8AAAAASUVORK5CYII=",
      "base64",
    );
    const path = join(outside, "sheet.png");
    writeFileSync(path, png);
    const projects = await s.client.projects();
    expect(await s.client.readBinaryFile(path)).toEqual(new Uint8Array(png));
    // Large image responses must keep every byte after base64 decoding.
    const large = Buffer.alloc(5 * 1024 * 1024, 42);
    png.copy(large);
    writeFileSync(path, large);
    expect(Buffer.from(await s.client.readBinaryFile(path)).equals(large)).toBe(true);
    expect(await s.client.projects()).toEqual(projects);
    await expect(s.client.readBinaryFile(outside)).rejects.toThrow("Not a file");
    await expect(s.client.readBinaryFile("relative.png")).rejects.toThrow("Invalid workspace path");
    truncateSync(path, 10 * 1024 * 1024 + 1);
    await expect(s.client.readBinaryFile(path)).rejects.toThrow("too large to preview");
    s.store.revokeToken(s.device.token);
    await expect(s.client.readBinaryFile(path)).rejects.toMatchObject({ status: 401 });
  });
  it.skipIf(process.platform === "win32")("browses directory symlinks through mobile RPC and opens their targets outside registered projects", async () => {
    const s = await setup();
    const target = mkdtempSync(join(tmpdir(), "monocode-mobile-link-target-"));
    cleanups.push(async () => rmSync(target, { recursive: true, force: true }));
    mkdirSync(join(target, "child"));
    const link = join(s.directory, "linked 项目");
    symlinkSync(target, link, "dir");
    expect((await s.client.browseDirectories(s.directory)).entries).toContainEqual({ name: "linked 项目", path: link });
    expect(await s.client.browseDirectories(link)).toEqual({
      path: link, parent: s.directory,
      entries: [{ name: "child", path: join(link, "child") }],
    });
    expect((await s.client.openProject(link)).cwd).toBe(target);
  });
  it("browses and opens computer folders outside registered projects without creating projects during browsing", async () => {
    const s = await setup();
    const outside = mkdtempSync(join(tmpdir(), "monocode-mobile-project-picker-"));
    cleanups.push(async () => rmSync(outside, { recursive: true, force: true }));
    const folder = join(outside, "My 项目");
    mkdirSync(folder);
    writeFileSync(join(outside, "file.txt"), "not a directory");
    const before = await s.client.projects();
    const home = await s.client.browseDirectories();
    expect(home.path).toBeTruthy();
    const result = await s.client.browseDirectories(outside);
    expect(result.entries).toEqual([{ name: "My 项目", path: folder }]);
    expect(await s.client.projects()).toEqual(before);
    expect(await s.client.browseDirectories(folder)).toMatchObject({ path: folder, parent: outside, entries: [] });
    const opened = await s.client.openProject(folder);
    expect(opened.cwd).toBe(folder);
    expect((await s.client.projects()).some(project => project.id === opened.id)).toBe(true);
    expect(await s.client.openProject(folder)).toEqual(opened);
    await expect(s.client.browseDirectories("relative/path")).rejects.toThrow("absolute");
    await expect(s.client.browseDirectories(join(outside, "file.txt"))).rejects.toThrow("directory");
  });
  it("persists dragged queue order, preserves attachments and plan intent, and retries a lost move receipt without dropping newly added rows", async () => {
    const s = await setup();
    const created = await s.client.dispatch({ type: "create", commandId: "move-create", projectId: s.project.id, harness: "codex", model: "codex:test", runtimeMode: "supervised" }, "Running turn");
    await vi.waitFor(() => expect(s.provider.send).toHaveBeenCalledTimes(1));
    const attachments = await s.client.uploadAttachments([{ id: crypto.randomUUID(), name: "photo.png", mimeType: "image/png", kind: "image", size: 3, data: "YWJj" }]);
    for (const id of ["a", "b", "c"]) await s.client.dispatch({ type: "send", commandId: id, sessionId: created.sessionId, text: id, ...(id === "b" ? { attachments, intent: "plan" as const } : {}) });
    const original = (await s.client.session(created.sessionId)).session.queuedMessages!.find(row => row.id === "b");
    await s.client.dispatch({ type: "queue", action: "move", commandId: "move-c", sessionId: created.sessionId, messageId: "c", beforeId: "a" });
    expect(s.store.session(created.sessionId).session.queuedMessages?.map(row => row.id)).toEqual(["c", "a", "b"]);
    s.loseNextReceipt();
    await expect(s.client.dispatch({ type: "queue", action: "move", commandId: "move-b", sessionId: created.sessionId, messageId: "b", beforeId: "c" })).rejects.toThrow("lost response");
    s.engine.command({ type: "send", commandId: "new-row", sessionId: created.sessionId, text: "Added concurrently" });
    await s.client.retryPending();
    const ordered = (await s.client.session(created.sessionId)).session.queuedMessages!;
    expect(ordered.map(row => row.id)).toEqual(["b", "c", "a", "new-row"]);
    expect(ordered[0]).toEqual(original);
    await expect(s.client.dispatch({ type: "queue", action: "move", commandId: "stale-target", sessionId: created.sessionId, messageId: "a", beforeId: "missing" })).rejects.toThrow("destination not found");
    await s.client.rpc("commands.dispatch", { type: "queue", action: "hold", commandId: "hold-a", sessionId: created.sessionId, messageId: "a", editor: "editor" });
    await expect(s.client.dispatch({ type: "queue", action: "move", commandId: "held-move", sessionId: created.sessionId, messageId: "c" })).rejects.toThrow("queue operation");
    await s.client.rpc("commands.dispatch", { type: "queue", action: "release", commandId: "release-a", sessionId: created.sessionId, editor: "editor" });
    expect(s.store.session(created.sessionId).session.queuedMessages?.map(row => row.id)).toEqual(["b", "c", "a", "new-row"]);
    s.finish();
    await vi.waitFor(() => expect(s.provider.send).toHaveBeenCalledTimes(2));
    expect(s.turn().text).toBe("b");
    expect(s.turn().intent).toBe("plan");
    expect(s.turn().attachments).toEqual([expect.objectContaining({ id: attachments[0].id, name: "photo.png" })]);
  });
  it("shares a desktop-created conversation and follow-ups bidirectionally with a separate phone credential", async () => {
    const s = await setup();
    const desktopDevice = s.store.issueDevice("Desktop");
    const desktopValues = new Map<StorageKey, string>();
    const desktop = new MobileClient({ get: async key => desktopValues.get(key) ?? null,
      set: async (key, value) => { desktopValues.set(key, value); },
      remove: async key => { desktopValues.delete(key); } }, s.transport);
    await desktop.connect(s.endpoint, desktopDevice.token);
    const first = await desktop.dispatch({ type: "create", commandId: "desktop-create", projectId: s.project.id,
      harness: "codex", model: "codex:test", runtimeMode: "supervised" }, "Started on desktop");
    await vi.waitFor(() => expect(s.provider.send).toHaveBeenCalledTimes(1));
    s.turn().onEvent({ type: "message.delta", text: "Desktop reply" });
    s.finish();
    await vi.waitFor(() => expect(s.store.session(first.sessionId).status).toBe("idle"));
    expect((await s.client.sessions(s.project.id))[0].id).toBe(first.sessionId);
    expect((await s.client.session(first.sessionId)).session.blocks.map(block => block.text))
      .toContain("Desktop reply");
    await s.client.dispatch({ type: "send", commandId: "phone-followup", sessionId: first.sessionId,
      text: "Continue on phone" });
    await vi.waitFor(() => expect(s.provider.send).toHaveBeenCalledTimes(2));
    expect((await desktop.session(first.sessionId)).session.blocks.map(block => block.text))
      .toContain("Continue on phone");
    await desktop.dispatch({ type: "send", commandId: "overlapping-send", sessionId: first.sessionId,
      text: "Concurrent turn" });
    expect((await s.client.session(first.sessionId)).session.queuedMessages?.[0].text).toBe("Concurrent turn");
    expect(s.provider.send).toHaveBeenCalledTimes(2);
    s.finish();
  });
  it("syncs one durable queue across separate clients and retries a lost enqueue receipt without duplicates", async () => {
    const s = await setup();
    const desktopStorageValues = new Map<StorageKey, string>();
    const desktop = new MobileClient({
      get: async key => desktopStorageValues.get(key) ?? null,
      set: async (key, value) => { desktopStorageValues.set(key, value); },
      remove: async key => { desktopStorageValues.delete(key); },
    }, s.transport);
    await desktop.connect(s.endpoint, s.device.token);
    const created = await s.client.dispatch({ type: "create", commandId: "shared-create", projectId: s.project.id,
      harness: "codex", model: "codex:test", runtimeMode: "supervised" }, "first");
    await vi.waitFor(() => expect(s.provider.send).toHaveBeenCalledTimes(1));
    await Promise.all([
      s.client.dispatch({ type: "send", commandId: "phone-row", sessionId: created.sessionId, text: "From phone" }),
      desktop.dispatch({ type: "send", commandId: "desktop-row", sessionId: created.sessionId, text: "From desktop" }),
    ]);
    const phoneSnapshot = await s.client.session(created.sessionId);
    const desktopSnapshot = await desktop.session(created.sessionId);
    expect(phoneSnapshot.session.queuedMessages).toEqual(desktopSnapshot.session.queuedMessages);
    expect(phoneSnapshot.session.queuedMessages?.map(row => row.id).sort()).toEqual(["desktop-row", "phone-row"]);
    s.loseNextReceipt();
    await expect(s.client.dispatch({ type: "send", commandId: "lost-enqueue", sessionId: created.sessionId, text: "Lost receipt" })).rejects.toThrow("lost response");
    await s.client.retryPending();
    expect((await desktop.session(created.sessionId)).session.queuedMessages).toHaveLength(3);
    await desktop.dispatch({ type: "queue", action: "remove", commandId: "delete-phone", sessionId: created.sessionId, messageId: "phone-row" });
    expect((await s.client.session(created.sessionId)).session.queuedMessages?.map(row => row.id)).toEqual(["desktop-row", "lost-enqueue"]);
    s.finish();
    await vi.waitFor(() => expect(s.provider.send).toHaveBeenCalledTimes(2));
    expect(s.turn().text).toBe("From desktop");
    const synced = await s.client.session(created.sessionId);
    expect(synced.session.blocks.some(row => row.id === "desktop-row")).toBe(true);
    expect(synced.session.queuedMessages?.map(row => row.id)).toEqual(["lost-enqueue"]);
  });
  it("uploads files and delivers an attachment-only first turn with plan intent exactly once", async () => {
    const s = await setup();
    const data = Buffer.alloc(600_001, 42);
    const attachments = await s.client.uploadAttachments([
      {
        id: crypto.randomUUID(),
        name: "notes.txt",
        mimeType: "text/plain",
        kind: "file",
        size: data.length,
        data: data.toString("base64"),
      },
    ]);
    s.loseNextReceipt();
    await expect(
      s.client.dispatch(
        {
          type: "create",
          commandId: "file-plan-create",
          projectId: s.project.id,
          harness: "codex",
          model: "codex:test",
          runtimeMode: "supervised",
        },
        { text: "", attachments, intent: "plan" },
      ),
    ).rejects.toThrow("lost response");
    const receipt = await s.client.retryPending();
    await vi.waitFor(() => expect(s.provider.send).toHaveBeenCalledTimes(1));
    expect(s.turn().intent).toBe("plan");
    const block = (await s.client.session(receipt.sessionId)).session.blocks[0];
    expect(block.text).toBe("");
    expect(block.attachments).toHaveLength(1);
    expect(readFileSync(block.attachments![0].path!)).toEqual(data);
    expect(await s.client.sessions(s.project.id)).toHaveLength(1);
  });
  it("persists selected models and reasoning values, then applies changes to the next turn", async () => {
    const s = await setup();
    const created = await s.client.dispatch(
      {
        type: "create",
        commandId: "configured-create",
        projectId: s.project.id,
        harness: "codex",
        model: "codex:test",
        modelSettings: { reasoningEffort: "high" },
        runtimeMode: "supervised",
      },
      "First turn",
    );
    await vi.waitFor(() => expect(s.provider.send).toHaveBeenCalledTimes(1));
    expect(s.turn().modelSettings).toEqual({ reasoningEffort: "high" });
    s.finish();
    await vi.waitFor(() =>
      expect(s.store.session(created.sessionId).status).toBe("idle"),
    );
    await s.client.dispatch({
      type: "configure",
      commandId: "configured-model",
      sessionId: created.sessionId,
      model: "codex:another",
      modelSettings: { reasoningEffort: "low" },
      runtimeMode: "supervised",
    });
    const configured = await s.client.session(created.sessionId);
    expect(configured.session).toMatchObject({
      model: "codex:another",
      modelSettings: { reasoningEffort: "low" },
    });
    await s.client.dispatch({
      type: "send",
      commandId: "configured-followup",
      sessionId: created.sessionId,
      text: "Continue",
    });
    await vi.waitFor(() => expect(s.provider.send).toHaveBeenCalledTimes(2));
    expect(s.turn()).toMatchObject({
      model: "codex:another",
      modelSettings: { reasoningEffort: "low" },
    });
  });
  it("opens projects, creates a conversation, streams text, handles approvals and reloads its history", async () => {
    const s = await setup();
    expect(await s.client.projects()).toEqual([s.project]);
    expect((await s.client.openProject(s.directory)).id).toBe(s.project.id);
    const receipt = await s.client.dispatch(
      {
        type: "create",
        commandId: "create-mobile",
        projectId: s.project.id,
        harness: "codex",
        model: "codex:test",
        runtimeMode: "supervised",
      },
      "Inspect this project",
    );
    await vi.waitFor(() => expect(s.provider.send).toHaveBeenCalledTimes(1));
    expect((await s.client.sessions(s.project.id))[0].id).toBe(
      receipt.sessionId,
    );
    const first = await s.client.session(receipt.sessionId);
    expect(first.session.blocks[0].text).toBe("Inspect this project");
    s.turn().onEvent({ type: "message.delta", text: "I inspected " });
    s.turn().onEvent({ type: "message.delta", text: "the project." });
    s.turn().onEvent({
      type: "approval.requested",
      requestId: 7,
      title: "Run checks?",
    });
    const next = await s.client.session(receipt.sessionId);
    expect(
      next.session.blocks.some((block) =>
        block.text.includes("I inspected the project."),
      ),
    ).toBe(true);
    expect(
      next.session.blocks.find((block) => block.approval)?.approval?.requestId,
    ).toBe(7);
    await s.client.dispatch({
      type: "approve",
      commandId: "approve-mobile",
      sessionId: receipt.sessionId,
      runId: next.runId!,
      requestId: 7,
      decision: "allow",
    });
    expect(s.provider.approve).toHaveBeenCalled();
    s.finish();
    await vi.waitFor(() =>
      expect(s.store.session(receipt.sessionId).status).toBe("idle"),
    );
    expect((await s.client.session(receipt.sessionId)).status).toBe("idle");
  });
  it("retries an uncertain session creation without duplicating the conversation or first turn", async () => {
    const s = await setup();
    s.loseNextReceipt();
    await expect(
      s.client.dispatch(
        {
          type: "create",
          commandId: "lost-create",
          projectId: s.project.id,
          harness: "codex",
          model: "codex:test",
          runtimeMode: "supervised",
        },
        "Start once",
      ),
    ).rejects.toThrow("lost response");
    expect(await s.client.sessions(s.project.id)).toHaveLength(1);
    await s.client.retryPending();
    expect(await s.client.sessions(s.project.id)).toHaveLength(1);
    await vi.waitFor(() => expect(s.provider.send).toHaveBeenCalledTimes(1));
  });
  it("rejects revoked phone credentials without bypassing Host authorization", async () => {
    const s = await setup();
    s.store.revokeToken(s.device.token);
    await expect(s.client.projects()).rejects.toMatchObject({ status: 401 });
  });
});
