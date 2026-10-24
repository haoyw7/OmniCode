import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostSession } from "../src/contracts/protocol";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";

function snapshot(projectId: string, id: string, assistantOwnerId?: string): HostSession {
  return {
    projectId,
    revision: 1,
    status: "idle",
    createdAt: 1,
    updatedAt: 2,
    session: {
      id,
      title: "Conversation",
      cwd: "/project",
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
      blocks: [{ id: "u", role: "user", text: "Hello", startedAt: 1 }],
      ...(assistantOwnerId ? { assistantOwnerId } : {}),
    },
  };
}

let store: HostStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});

describe("host store reads", () => {
  it("reads only running directories from the summary index, including legacy rows but excluding retired ones", () => {
    store = new HostStore(":memory:");
    const project = store.addProject("/project", "Project");
    for (const id of ["idle", "running", "legacy", "retired"])
      store.save({ ...snapshot(project.id, id), status: id === "idle" ? "idle" : "running" }, { type: "seed" });
    store.db.prepare("INSERT INTO retired_sessions VALUES (?)").run("retired");
    const queries = vi.spyOn(store.db, "prepare");
    expect(store.runningSessionDirectories()).toEqual([{ id: "legacy", cwd: "/project" }, { id: "running", cwd: "/project" }]);
    expect(queries.mock.calls.filter(([sql]) => /SELECT snapshot FROM sessions/i.test(sql))).toHaveLength(0);
    const query = queries.mock.calls.find(([sql]) => sql.includes("json_extract(summary, '$.status')"))![0];
    expect(store.db.prepare(`EXPLAIN QUERY PLAN ${query}`).all().map(row => String(row.detail)).join("\n")).toContain("COVERING INDEX");
    store.db.prepare("UPDATE sessions SET summary=NULL WHERE id='legacy'").run();
    store.invalidateSession("legacy");
    expect(store.runningSessionDirectories().map(value => value.id)).toEqual(["legacy", "running"]);
  });

  it("polls more sessions than the transcript cache holds without loading unchanged histories", () => {
    store = new HostStore(":memory:");
    const project = store.addProject("/project", "Project");
    for (let index = 0; index < 64; index++)
      store.save(snapshot(project.id, `s${index}`), { type: "seed" });
    const recent = store.session("s63");
    const prepare = vi.spyOn(store.db, "prepare");
    for (let pass = 0; pass < 3; pass++)
      for (let index = 0; index < 64; index++)
        expect(store.sync(`s${index}`, 1)).toEqual({ kind: "unchanged", revision: 1 });
    expect(prepare.mock.calls.filter(([sql]) => /SELECT snapshot FROM sessions/i.test(sql))).toHaveLength(0);
    expect(store.session("s63")).toBe(recent);
    expect(store.db.prepare("EXPLAIN QUERY PLAN SELECT summary FROM sessions INDEXED BY sessions_id_summary WHERE id=?").all("s0")
      .map(row => String(row.detail)).join("\n")).toContain("COVERING INDEX");
  });

  it("still delivers changed blocks, metadata and full snapshots after version-only polls", () => {
    store = new HostStore(":memory:");
    const project = store.addProject("/project", "Project");
    const value = store.save(snapshot(project.id, "s"), { type: "seed" });
    expect(store.sync("s", 1).kind).toBe("unchanged");
    const changed = store.save({ ...value, revision: 2, session: { ...value.session,
      blocks: [...value.session.blocks, { id: "a", role: "assistant", text: "Answer" }] } }, { type: "reply" });
    store.invalidateSession("s");
    expect(store.sync("s", 1)).toMatchObject({ kind: "delta", base: 1, blocks: [{ id: "a", text: "Answer" }] });
    expect(store.sync("s", 2).kind).toBe("unchanged");
    store.updateSession("s", { title: "Renamed" });
    expect(store.sync("s", 2)).toMatchObject({ kind: "delta", value: { revision: 3, session: { title: "Renamed" } }, blocks: [] });
    expect(store.sync("s")).toMatchObject({ kind: "snapshot", value: { revision: 3 } });
    expect(store.sync("s", 99)).toMatchObject({ kind: "snapshot", value: { revision: 3 } });
    expect(() => store!.transaction(() => {
      store!.save({ ...changed, revision: 4 }, { type: "rolled-back" });
      expect(store!.sync("s", 4).kind).toBe("unchanged");
      throw new Error("rollback");
    })).toThrow("rollback");
    expect(store.sync("s", 3).kind).toBe("unchanged");
    expect(store.sync("s", 4)).toMatchObject({ kind: "snapshot", value: { revision: 3 } });
  });

  it("falls back for old summaries and never reports missing or retired sessions as unchanged", () => {
    store = new HostStore(":memory:");
    const project = store.addProject("/project", "Project");
    store.save(snapshot(project.id, "legacy"), { type: "seed" });
    store.db.prepare("UPDATE sessions SET summary=NULL WHERE id=?").run("legacy");
    store.invalidateSession("legacy");
    expect(store.sync("legacy", 1)).toEqual({ kind: "unchanged", revision: 1 });
    expect(store.sessionSummary("legacy")).toMatchObject({ id: "legacy", revision: 1 });
    store.db.prepare("INSERT INTO retired_sessions VALUES (?)").run("legacy");
    expect(store.sessionSummary("legacy")).toBeUndefined();
    expect(() => store!.sync("legacy", 1)).toThrow("Session not found");
    expect(() => store!.sync("missing", 1)).toThrow("Session not found");
    store.save(snapshot(project.id, "deleted"), { type: "seed" });
    store.deleteSession("deleted");
    expect(() => store!.sync("deleted", 1)).toThrow("Session not found");
  });

  it("scans one transcript at a time while recovery changes rows, preserving the read cache", () => {
    store = new HostStore(":memory:");
    const project = store.addProject("/project", "Project");
    for (let index = 0; index < 40; index++)
      store.save(snapshot(project.id, `s${String(index).padStart(2, "0")}`), { type: "seed" });
    const recent = store.session("s39");
    const reads = vi.spyOn(store, "peekSession");
    const scan = store.scanSessions();
    const first = scan.next().value!;
    expect(reads).toHaveBeenCalledTimes(1);
    expect(first.session.id).toBe("s00");
    store.save({ ...first, revision: 2 }, { type: "recovered" });
    store.deleteSession("s01");
    store.save(snapshot(project.id, "new"), { type: "created-during-recovery" });
    const ids = [...scan].map(value => value.session.id);
    expect(ids).toHaveLength(38);
    expect(ids).not.toContain("s01");
    expect(ids).not.toContain("new");
    expect(store.session("s39")).toBe(recent);
  });

  it("lists summaries from covering indexes instead of session snapshots", () => {
    store = new HostStore(":memory:");
    const plan = (sql: string) =>
      store!.db
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all("x")
        .map((row) => String(row.detail))
        .join("\n");
    expect(plan("SELECT id, summary FROM sessions WHERE project_id=?")).toContain(
      "COVERING INDEX sessions_project_summary",
    );
    expect(
      store.db
        .prepare("EXPLAIN QUERY PLAN SELECT id, summary FROM sessions")
        .all()
        .map((row) => String(row.detail))
        .join("\n"),
    ).toContain("COVERING INDEX");
  });

  it("knows which sessions hold queued messages without parsing them", () => {
    const path = join(tmpdir(), `omnicode-store-queued-${process.pid}-${Date.now()}.db`);
    const seeded = new HostStore(path);
    const project = seeded.addProject("/project", "Project");
    const queued = snapshot(project.id, "queued");
    queued.session.queuedMessages = [{ id: "q", text: "Later", attachments: [] }];
    seeded.save(queued, { type: "send" });
    seeded.save(snapshot(project.id, "plain"), { type: "send" });
    seeded.close();
    try {
      store = new HostStore(path);
      expect(store.hasQueuedMessages("queued")).toBe(true);
      expect(store.hasQueuedMessages("plain")).toBe(false);
      store.save({ ...queued, revision: 2, session: { ...queued.session, queuedMessages: [] } }, { type: "send" });
      expect(store.hasQueuedMessages("queued")).toBe(false);
    } finally {
      store?.close();
      store = undefined;
      for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
    }
  });

  it("peeks at a session without pushing recently used ones out of the cache", () => {
    store = new HostStore(":memory:");
    const project = store.addProject("/project", "Project");
    for (let index = 0; index < 40; index++)
      store.save(snapshot(project.id, `s${index}`), { type: "send" });
    const recent = store.session("s39");
    for (let index = 0; index < 39; index++) store.peekSession(`s${index}`);
    expect(store.session("s39")).toBe(recent);
  });

  it("keeps the assistant privacy check exact, including ids created after a miss", () => {
    store = new HostStore(":memory:");
    const project = store.addProject("/project", "Project");
    store.save(snapshot(project.id, "plain"), { type: "send" });
    expect(store.isAssistantSession("plain")).toBe(false);
    expect(store.isAssistantSession("brain")).toBe(false);
    store.save(snapshot(project.id, "brain", "assistant"), { type: "send" });
    expect(store.isAssistantSession("brain")).toBe(true);
    expect(store.isAssistantSession("brain")).toBe(true);
    expect(store.isAssistantSession("plain")).toBe(false);
  });
});

describe("revision waits", () => {
  afterEach(() => vi.useRealTimers());
  const seed = () => {
    store = new HostStore(":memory:");
    const project = store.addProject("/project", "Project");
    return store.save(snapshot(project.id, "waiting"), { type: "seed" });
  };

  it("wakes after a matching commit, never on another session or a rolled-back write", async () => {
    const value = seed();
    const ready = vi.fn();
    const pending = store!.waitForRevision("waiting", 1, 1_000).then(ready);
    store!.save(snapshot(value.projectId, "other"), { type: "seed" });
    expect(() => store!.transaction(() => {
      store!.save({ ...value, revision: 2 }, { type: "tentative" });
      throw new Error("rollback");
    })).toThrow("rollback");
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    store!.save({ ...value, revision: 2 }, { type: "reply" });
    await pending;
    expect(store!.sync("waiting", 1)).toMatchObject({ kind: "delta", value: { revision: 2 } });
    await expect(store!.waitForRevision("waiting", 1, 1_000)).resolves.toBeUndefined();
  });

  it("cleans up timeout, abort, deletion and shutdown without retaining timers", async () => {
    vi.useFakeTimers();
    seed();
    const timeout = store!.waitForRevision("waiting", 1, 50);
    await vi.advanceTimersByTimeAsync(50);
    await timeout;
    const controller = new AbortController();
    const aborted = store!.waitForRevision("waiting", 1, 1_000, controller.signal);
    controller.abort();
    await aborted;
    expect(vi.getTimerCount()).toBe(0);
    const deleted = store!.waitForRevision("waiting", 1, 1_000);
    store!.deleteSession("waiting");
    await deleted;
    expect(vi.getTimerCount()).toBe(0);
    const project = store!.addProject("/project", "Project");
    store!.save(snapshot(project.id, "second"), { type: "seed" });
    const closed = expect(store!.waitForRevision("second", 1, 1_000)).rejects.toThrow("closed");
    store!.close();
    store = undefined;
    await closed;
    expect(vi.getTimerCount()).toBe(0);
  });
});
