import { testProviderCapabilities } from "./test-provider";
import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import { createHostServer } from "./server";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import type { HostSession } from "../src/features/connections/model/protocol";
import { loadRemoteSession, loadRemoteSessionText, remoteRequest } from "../src/features/connections/model/connections";
import { TOOL_CONTENT_MODE, type ToolContentPage } from "../src/integrations/harness/core/toolContent";
import { HISTORY_CAPABILITY } from "../src/integrations/harness/core/history";

// The desktop's native client (src-tauri/src/remote.rs) rejects responses over
// 16 MiB. This routes the real renderer sync code through the real host server
// with the same cap and the same strict JSON rules.
const DESKTOP_LIMIT = 16 * 1024 * 1024;
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const desktop = vi.hoisted(() => ({
  url: "",
  token: "",
  environmentId: "",
  methods: [] as string[],
  largest: 0,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (
    _command: string,
    input: { method: string; params: unknown },
  ) => {
    desktop.methods.push(input.method);
    const response = await fetch(desktop.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${desktop.token}` },
      body: JSON.stringify({
        version: 1,
        environmentId: desktop.environmentId,
        method: input.method,
        params: input.params,
      }),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    desktop.largest = Math.max(desktop.largest, bytes.length);
    if (bytes.length > DESKTOP_LIMIT) throw "Host response is too large";
    const text = bytes.toString("utf8");
    const value = JSON.parse(text) as { result?: unknown; error?: string };
    if (value.error) throw `Host rejected request: ${value.error}`;
    const data = (value.result as { data?: unknown })?.data;
    if (typeof data === "string" && LONE_SURROGATE.test(data))
      throw "Invalid host response";
    return value.result;
  },
}));

// Each test moves tens of megabytes through a real server.
const LARGE = 60_000;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "omnicode-large-sync-"));
  const store = new HostStore(join(directory, "host.db"));
  let turn: SendTurnInput | undefined;
  let started!: (input: SendTurnInput) => void;
  const whenStarted = new Promise<SendTurnInput>(resolve => { started = resolve; });
  let finish = () => {};
  const engine = new HostEngine(store, {
    codex: {
      get interactionCapabilities() { return testProviderCapabilities(this); },
      send: async (input) => {
        turn = input;
        started(input);
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
      stop: async () => finish(),
      cancel: async () => finish(),
      bind: () => {},
      approve: () => {},
      answer: () => {},
    },
  });
  const project = await engine.openProject(directory);
  const server = createHostServer(engine, ["codex"]);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  desktop.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
  desktop.token = store.issueDevice("Laptop").token;
  desktop.environmentId = store.environmentId;
  desktop.methods = [];
  desktop.largest = 0;
  cleanups.push(async () => {
    await engine.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const { sessionId } = engine.command({
    type: "create",
    commandId: "create",
    projectId: project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  return {
    store,
    engine,
    sessionId,
    turn: () => turn!,
    whenStarted,
    finish: () => finish(),
  };
}

const visible = (value: HostSession) => {
  // Transport timing and worktree discovery are not stored transcript data.
  const { blockRevisions: _, clockOffsetMs: _clock, session, ...rest } = value;
  const { linkedWorktree: _linked, ...content } = session;
  return { ...rest, session: content };
};

// Quotes, backslashes, newlines and control characters expand when a piece is
// embedded as a JSON string; emoji must never be split between pieces.
const text = (size: number, seed: string) =>
  `${seed} "quoted" \\path\\ \u0001 naïve 🚀\n`
    .repeat(Math.ceil(size / 40))
    .slice(0, size);

it("negotiates lazy tool content over the real RPC without changing legacy sync", async () => {
  const s = await setup(), current = s.store.session(s.sessionId);
  const output = "huge output 你好🚀\n".repeat(10000);
  s.store.transaction(() => s.store.save({ ...current, revision: current.revision + 1,
    session: { ...current.session, blocks: [{ id: "tool", role: "tool", text: "Run", tool: { kind: "shell", status: "completed", output } }] },
  }, { type: "fixture" }));
  const compact = await loadRemoteSessionText("machine", s.sessionId, undefined, undefined, TOOL_CONTENT_MODE);
  expect(compact.session.blocks[0].tool?.output).toBeUndefined();
  expect(desktop.largest).toBeLessThan(8192);
  const reference = compact.session.blocks[0].toolContent!;
  const tail = await remoteRequest<ToolContentPage>("machine", "sessions.toolContent.read", { ...reference, field: "output", tail: true });
  expect(tail.text).toBe(output.slice(tail.start));
  expect(desktop.largest).toBeLessThanOrEqual(64 * 1024);
  const legacy = await loadRemoteSession("machine", s.sessionId, compact);
  expect(legacy.contentMode).toBeUndefined();
  expect(legacy.session.blocks[0].tool?.output).toBe(output);
  expect(s.store.session(s.sessionId).session.blocks[0].tool?.output).toBe(output);
  const denied = await fetch(desktop.url, { method: "POST", headers: { Authorization: "Bearer invalid" },
    body: JSON.stringify({ version: 1, environmentId: desktop.environmentId, method: "sessions.toolContent.read", params: { ...reference, field: "output" } }) });
  expect(denied.ok).toBe(false);
});

it("opens a bounded history window and pages the full transcript through real HTTP RPC", async () => {
  const s = await setup(), current = s.store.session(s.sessionId);
  const blocks = Array.from({ length: 300 }, (_, i) => ({ id: `b${i}`, role: "assistant" as const, text: `Message ${i}` }));
  s.store.transaction(() => s.store.save({ ...current, revision: current.revision + 1,
    session: { ...current.session, blocks } }, { type: "fixture" }));
  const descriptor = await remoteRequest<{ capabilities: string[] }>("machine", "environment.describe", {});
  expect(descriptor.capabilities).toContain(HISTORY_CAPABILITY);
  let page = await loadRemoteSessionText("machine", s.sessionId, undefined, undefined, TOOL_CONTENT_MODE, true);
  expect(page.session.blocks).toHaveLength(75);
  expect(page.session.blocks[0].id).toBe("b225");
  while (page.history?.hasMore)
    page = await loadRemoteSessionText("machine", s.sessionId, page, undefined, TOOL_CONTENT_MODE, true, true);
  expect(page.session.blocks).toEqual(blocks);
  expect(desktop.methods.filter(method => method === "sessions.history")).toHaveLength(3);
  expect(desktop.largest).toBeLessThan(1024 * 1024);
});

it(
  "reopens and updates a session whose transcript exceeds 16 MiB",
  async () => {
    const s = await setup();
    const created = s.store.session(s.sessionId);
    s.store.transaction(() =>
      s.store.save(
        {
          ...created,
          revision: created.revision + 1,
          session: {
            ...created.session,
            blocks: [
              ...Array.from({ length: 24 }, (_, index) => ({
                id: `history-${index}`,
                role: "assistant" as const,
                text: text(600_000, `turn ${index}`),
              })),
              // One block alone is larger than the desktop's response cap.
              {
                id: "huge",
                role: "tool" as const,
                text: text(17_500_000, "log"),
              },
            ],
          },
        },
        { type: "fixture" },
      ),
    );
    const full = s.store.session(s.sessionId);
    expect(Buffer.byteLength(JSON.stringify(visible(full)))).toBeGreaterThan(
      DESKTOP_LIMIT * 2,
    );

    const reopened = await loadRemoteSession("machine", s.sessionId);
    expect(visible(reopened)).toEqual(visible(full));
    expect(
      desktop.methods.filter((m) => m === "sessions.syncChunk").length,
    ).toBeGreaterThan(4);
    expect(desktop.largest).toBeLessThanOrEqual(DESKTOP_LIMIT);

    // A follow-up turn streams into the large session; only new blocks move.
    desktop.methods = [];
    desktop.largest = 0;
    s.engine.command({
      type: "send",
      commandId: "follow-up",
      sessionId: s.sessionId,
      text: "Summarize the log",
    });
    await s.whenStarted;
    s.turn().onEvent({ type: "message.delta", text: "Summary" });
    const previousSave = s.store.onSessionSave;
    const settled = new Promise<void>(resolve => {
      s.store.onSessionSave = (previous, next, event) => {
        previousSave?.(previous, next, event);
        if (next.session.id === s.sessionId && next.status === "idle")
          s.store.participateInTransaction({ afterCommit: () => { s.store.onSessionSave = previousSave; resolve(); } });
      };
    });
    s.finish();
    await settled;
    const updated = await loadRemoteSession("machine", s.sessionId, reopened);
    expect(visible(updated)).toEqual(visible(s.store.session(s.sessionId)));
    expect(updated.session.blocks.at(-1)?.text).toBe("Summary");
    expect(desktop.methods).toEqual(["sessions.sync"]);
    expect(desktop.largest).toBeLessThan(64 * 1024);
  },
  LARGE,
);

it(
  "streams a changed block larger than 16 MiB as a bounded delta",
  async () => {
    const s = await setup();
    const base = await loadRemoteSession("machine", s.sessionId);
    const current = s.store.session(s.sessionId);
    s.store.transaction(() =>
      s.store.save(
        {
          ...current,
          revision: current.revision + 1,
          session: {
            ...current.session,
            blocks: [
              { id: "huge", role: "tool", text: text(17_000_000, "out") },
            ],
          },
        },
        { type: "fixture" },
      ),
    );
    desktop.methods = [];
    const next = await loadRemoteSession("machine", s.sessionId, base);
    expect(visible(next)).toEqual(visible(s.store.session(s.sessionId)));
    expect(desktop.methods[0]).toBe("sessions.sync");
    expect(desktop.methods).toContain("sessions.syncChunk");
    expect(desktop.largest).toBeLessThanOrEqual(DESKTOP_LIMIT);
  },
  LARGE,
);
