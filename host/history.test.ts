import { expect, it } from "vitest";
import { HistoryService, HISTORY_BYTES, HISTORY_ROWS } from "./history";
import { ToolContentService } from "./tool-content";
import { SyncTransfers } from "./sync-transfer";
import { HISTORY_MODE } from "../src/integrations/harness/core/history";
import { applySessionSync, type HostSession } from "../src/features/connections/model/protocol";

function setup(count = 1000, body = "hello") {
  let value: HostSession = { projectId: "p", revision: 1, updatedAt: 1, status: "idle",
    session: { id: "s", title: "S", harness: "codex", model: "codex:m", cwd: "/p", runtimeMode: "supervised", modelSettings: {},
      blocks: Array.from({ length: count }, (_, i) => ({ id: `b${i}`, role: i % 2 ? "assistant" : "user", text: body })) },
    blockRevisions: Object.fromEntries(Array.from({ length: count }, (_, i) => [`b${i}`, 1])),
  };
  const content = new ToolContentService({ session: () => value, isAssistantSession: () => false });
  const history = new HistoryService(content);
  return { get: () => value, set: (next: HostSession) => { value = next; },
    read: (known?: HostSession, earlier = false) => history.sync(value, known?.revision,
      { mode: HISTORY_MODE, start: known?.history?.start, ...(earlier ? { before: known?.history?.start } : {}) }), history };
}

it("cold starts with 75 rows and excludes the rest of the block IDs", () => {
  const s = setup(10000), reply = s.read(), page = applySessionSync(undefined, reply);
  expect(page.session.blocks).toHaveLength(HISTORY_ROWS);
  expect(page.history).toEqual({ mode: HISTORY_MODE, start: "b9925", hasMore: true });
  expect(Buffer.byteLength(JSON.stringify(reply))).toBeLessThan(HISTORY_BYTES);
  expect(page).not.toHaveProperty("blockRevisions");
  expect(s.get().session.blocks).toHaveLength(10000);
  expect(s.read(page).kind).toBe("unchanged");
});

it("pages earlier rows at the same revision and includes concurrent edits and appends atomically", () => {
  const s = setup(200);
  let current = applySessionSync(undefined, s.read());
  const second = s.read(current, true);
  expect(second.kind).toBe("delta");
  if (second.kind === "delta") expect(second.blocks).toHaveLength(75);
  current = applySessionSync(current, second);
  expect(current.history?.start).toBe("b50");
  expect(current.session.blocks).toHaveLength(150);
  s.set({ ...s.get(), revision: 2, blockRevisions: { ...s.get().blockRevisions, b100: 2, new: 2 },
    session: { ...s.get().session, blocks: [...s.get().session.blocks.map(b => b.id === "b100" ? { ...b, text: "edited" } : b), { id: "new", role: "assistant", text: "live" }] } });
  current = applySessionSync(current, s.read(current, true));
  expect(current.history?.hasMore).toBe(false);
  expect(current.session.blocks).toHaveLength(201);
  expect(current.session.blocks.find(b => b.id === "b100")?.text).toBe("edited");
  expect(current.session.blocks.at(-1)?.text).toBe("live");
});

it("rejects a delta from a different loaded window and resets after boundary deletion", () => {
  const s = setup(200), tail = applySessionSync(undefined, s.read());
  const older = applySessionSync(tail, s.read(tail, true));
  s.set({ ...s.get(), revision: 2 });
  expect(() => applySessionSync(older, s.read(tail))).toThrow("base");
  s.set({ ...s.get(), revision: 3, session: { ...s.get().session, blocks: s.get().session.blocks.slice(0, 100) } });
  const reset = s.read(tail);
  expect(reset.kind).toBe("snapshot");
  expect(applySessionSync(tail, reset).history?.start).toBe("b25");
});

it("budgets UTF-8 JSON rather than characters and chunks a single oversized row losslessly", () => {
  const s = setup(150, '你好🚀"\\'.repeat(1000));
  const reply = s.read();
  expect(Buffer.byteLength(JSON.stringify(reply))).toBeLessThan(HISTORY_BYTES);
  const huge = setup(1, '🚀"\\'.repeat(600000));
  const transfers = new SyncTransfers();
  const sync = huge.read(), response = transfers.respond("s", sync, HISTORY_BYTES - 1024);
  expect(response.kind).toBe("chunked");
  if (response.kind !== "chunked") throw Error("Expected chunks");
  let serialized = "";
  while (serialized.length < response.length) {
    const chunk = transfers.chunk("s", response.transfer, serialized.length);
    expect(Buffer.byteLength(JSON.stringify({ result: chunk }))).toBeLessThan(HISTORY_BYTES);
    serialized += chunk.data;
  }
  expect(JSON.parse(serialized)).toEqual(JSON.parse(JSON.stringify(sync)));
});

it("keeps pending approvals complete and validates cursors", () => {
  const s = setup(100);
  s.get().session.blocks[0] = { id: "b0", role: "approval", text: "Review", approval: { requestId: 1 }, tool: { input: "command".repeat(2000) } };
  const page = applySessionSync(undefined, s.read());
  expect(page.session.blocks[0].tool?.input).toBe("command".repeat(2000));
  expect(page.history?.hasMore).toBe(false);
  expect(() => s.history.sync(s.get(), 1, { mode: HISTORY_MODE, start: "b1", before: "b2" })).toThrow("cursor");
});

it("keeps an old running background task reachable for its stop controls", () => {
  const s = setup(200);
  s.get().session.blocks[0] = { id: "b0", role: "tool", text: "Server", tool: { background: true, backgroundTaskId: "task", status: "running" } };
  expect(applySessionSync(undefined, s.read()).session.blocks[0].tool?.backgroundTaskId).toBe("task");
});
