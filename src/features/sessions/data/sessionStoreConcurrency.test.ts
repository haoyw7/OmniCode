import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), hostOwned: false }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
// Exercise the retained legacy writer independently of the Host ownership gate.
vi.mock("../../connections/model/remoteProjects", () => ({ sessionUsesHost: () => mocks.hostOwned }));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function loadStore() {
  vi.resetModules();
  return import("./sessionStore");
}

function session(id: string) {
  return {
    id,
    cwd: "/tmp/project",
    harness: "cursor" as const,
    model: "",
    modelSettings: {},
    runtimeMode: "supervised" as const,
    title: "",
    blocks: [{ id: "user", role: "user" as const, text: "hello" }],
    busy: true,
  };
}

afterEach(() => {
  mocks.invoke.mockReset();
  mocks.hostOwned = false;
});

describe("session persistence concurrency", () => {
  it("drops a queued native write when ownership changes before execution", async () => {
    const pending = deferred<unknown>();
    mocks.invoke.mockImplementation(() => pending.promise);
    const { upsertSession } = await loadStore();
    const first = upsertSession(session("s"));
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    const queued = upsertSession(session("s"));
    mocks.hostOwned = true;
    pending.resolve({ id: "s", cwd: "/tmp/project" });
    await first;
    expect(await queued).toBeNull();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("does not retry a stale native write after Host takes ownership", async () => {
    const { upsertSession } = await loadStore();
    const draft = session("s");
    draft.blocks = Array.from({ length: 10 }, (_, index) => ({
      id: `u${index}`, role: "user", text: "message",
    }));
    mocks.invoke.mockResolvedValueOnce({ id: "s", cwd: "/tmp/project" });
    await upsertSession(draft);
    mocks.invoke.mockImplementationOnce(async () => {
      mocks.hostOwned = true;
      throw new Error("stale-blocks");
    });
    expect(await upsertSession(draft)).toBeNull();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("drains worker writes before deleting a lead and strips ownership from later snapshots", async () => {
    const firstWrite = deferred<unknown>();
    const commands: string[] = [];
    mocks.invoke.mockImplementation((command: string) => {
      commands.push(command);
      return command === "session_upsert" && commands.length === 1
        ? firstWrite.promise
        : Promise.resolve();
    });
    const { deleteSession, upsertSession } = await loadStore();
    const worker = { ...session("worker"), orchestrationLeadId: "lead" };
    const writing = upsertSession(worker);
    await vi.waitFor(() => expect(commands).toEqual(["session_upsert"]));
    const queued = upsertSession(worker);
    const deleting = deleteSession("lead");
    expect(commands).toEqual(["session_upsert"]);
    firstWrite.resolve(undefined);
    await Promise.all([writing, queued, deleting]);
    expect(commands).toEqual([
      "session_upsert",
      "session_upsert",
      "session_get",
      "session_delete",
    ]);
    await upsertSession(worker);
    for (const [, args] of mocks.invoke.mock.calls
      .slice(1)
      .filter(([command]) => command === "session_upsert")) {
      expect(args.session.blocks[0].orchestrationLeadId).toBeUndefined();
    }
  });

  it("serializes deletion after an active write and drops a queued late upsert", async () => {
    const firstWrite = deferred<unknown>();
    const commands: string[] = [];
    mocks.invoke.mockImplementation((command: string) => {
      commands.push(command);
      if (command === "session_upsert") return firstWrite.promise;
      return Promise.resolve();
    });
    const { deleteSession, upsertSession } = await loadStore();

    const writing = upsertSession(session("s1"));
    await vi.waitFor(() => expect(commands).toEqual(["session_upsert"]));
    const lateWrite = upsertSession({ ...session("s1"), title: "late" });
    const deleting = deleteSession("s1");

    expect(commands).toEqual(["session_upsert"]);
    firstWrite.resolve({
      id: "s1",
      cwd: "/tmp/project",
      harness: "cursor",
      model: "",
      runtimeMode: "supervised",
      title: "",
      createdAt: 1,
      updatedAt: 1,
    });
    await Promise.all([writing, lateWrite, deleting]);

    expect(commands).toEqual(["session_upsert", "session_get", "session_delete"]);
  });

  it("discards a draft-only record before reusing its open session id", async () => {
    const firstWrite = deferred<unknown>();
    const commands: string[] = [];
    mocks.invoke.mockImplementation((command: string) => {
      commands.push(command);
      if (commands.length === 1) return firstWrite.promise;
      return Promise.resolve({
        id: "s1",
        cwd: "/tmp/project",
        harness: "cursor",
        model: "",
        runtimeMode: "supervised",
        title: "",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const { discardDraftSessionRecord, upsertSession } = await loadStore();

    const draftWrite = upsertSession(session("s1"));
    await vi.waitFor(() => expect(commands).toEqual(["session_upsert"]));
    const discarding = discardDraftSessionRecord("s1");
    const laterTurn = upsertSession({ ...session("s1"), title: "later" });

    firstWrite.resolve(undefined);
    await Promise.all([draftWrite, discarding, laterTurn]);
    expect(commands).toEqual([
      "session_upsert",
      "session_get",
      "session_delete",
      "session_upsert",
    ]);
  });

  it("drains queued saves before detaching a removed worktree", async () => {
    const firstWrite = deferred<unknown>();
    mocks.invoke
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValue(undefined);
    const { flushSessionWrites, upsertSession } = await loadStore();
    const active = upsertSession(session("s1"));
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
    const queued = upsertSession({ ...session("s1"), title: "latest" });
    let flushed = false;
    const flushing = flushSessionWrites().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);
    firstWrite.resolve(undefined);
    await Promise.all([active, queued, flushing]);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(flushed).toBe(true);
  });

  it("archives only after the final active-turn snapshot is durable", async () => {
    const firstWrite = deferred<unknown>();
    const commands: string[] = [];
    mocks.invoke.mockImplementation((command: string) => {
      commands.push(command);
      if (command === "session_upsert" && commands.length === 1) {
        return firstWrite.promise;
      }
      return Promise.resolve({
        id: "s1",
        cwd: "/tmp/project",
        harness: "cursor",
        model: "",
        runtimeMode: "supervised",
        title: "",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const { setSessionArchived, upsertSession } = await loadStore();

    const writing = upsertSession(session("s1"));
    await vi.waitFor(() => expect(commands).toEqual(["session_upsert"]));
    const finalSnapshot = upsertSession({
      ...session("s1"),
      blocks: [
        { id: "user", role: "user", text: "hello" },
        { id: "assistant", role: "assistant", text: "final buffered output" },
      ],
    });
    const archiving = setSessionArchived("s1", true);

    expect(commands).toEqual(["session_upsert"]);
    firstWrite.resolve({
      id: "s1",
      cwd: "/tmp/project",
      harness: "cursor",
      model: "",
      runtimeMode: "supervised",
      title: "",
      createdAt: 1,
      updatedAt: 1,
    });
    await Promise.all([writing, finalSnapshot, archiving]);

    expect(commands).toEqual([
      "session_upsert",
      "session_upsert",
      "session_get",
      "session_set_archived",
    ]);
    expect(mocks.invoke.mock.calls[1]?.[1]).toMatchObject({
      session: {
        blocks: [{ text: "hello" }, { text: "final buffered output" }],
      },
    });
  });
});
