import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import {
  newSession,
  type Session,
} from "../../features/sessions/model/session";
import { WorkspaceSessionData } from "./workspaceSessionData";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function chat(id = "chat", cwd = "/repo"): Session {
  return {
    ...newSession("codex", cwd),
    id,
    blocks: [{ id: "user", role: "user", text: "Keep this conversation" }],
  };
}
function summary(session = chat()): SessionSummary {
  return { ...session, createdAt: 1, updatedAt: 2 };
}
const instances: WorkspaceSessionData[] = [];
function fixture(history: SessionSummary[] = []) {
  const live = { current: [] as Session[] };
  const switching = new Set<string>();
  const storage = {
    get: vi.fn(async (_id: string): Promise<Session | null> => null),
    save: vi.fn(async (session: Session): Promise<SessionSummary | null> =>
      summary(session),
    ),
    list: vi.fn(async (_cwd: string): Promise<SessionSummary[]> => []),
    linked: vi.fn(async (): Promise<SessionSummary[]> => []),
    flush: vi.fn(async () => {}),
    rebase: vi.fn(async (_from: string, _to: string) => {}),
  };
  const data = new WorkspaceSessionData({
    storage,
    live: () => live.current,
    isSwitching: (id) => switching.has(id),
    history,
  });
  instances.push(data);
  return { data, storage, live, switching };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
});
afterEach(() => {
  for (const data of instances.splice(0)) data.stop();
  vi.useRealTimers();
});

describe("workspace session data", () => {
  it("deduplicates reads, rejects an invalidated result and transfers cached transcripts into live ownership", async () => {
    const { data, storage } = fixture();
    const old = deferred<Session | null>();
    const fresh = deferred<Session | null>();
    storage.get
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    const first = data.load("chat");
    expect(data.load("chat")).toBe(first);
    data.invalidate("chat");
    const second = data.load("chat");
    old.resolve(chat());
    expect(await first).toBeNull();
    expect(data.load("chat")).toBe(second);
    const current = { ...chat(), title: "Fresh" };
    fresh.resolve(current);
    expect(await second).toBe(current);
    data.retain(current);
    expect(await data.load("chat")).toBe(current);
    expect(storage.get).toHaveBeenCalledTimes(2);
    await data.load("chat");
    expect(storage.get).toHaveBeenCalledTimes(3);
  });

  it("does not return an invalidated prefetch to the closed-session cache", async () => {
    const { data, storage } = fixture();
    const old = deferred<Session | null>();
    storage.get.mockReturnValueOnce(old.promise).mockResolvedValue(null);
    data.prefetch("chat");
    data.invalidate("chat");
    old.resolve(chat());
    await old.promise;
    await Promise.resolve();
    expect(await data.load("chat")).toBeNull();
    expect(storage.get).toHaveBeenCalledTimes(2);
  });

  it("shares an in-flight save and ignores an older completion after a newer save", async () => {
    const { data, storage } = fixture();
    const old = deferred<SessionSummary | null>();
    const fresh = deferred<SessionSummary | null>();
    storage.save
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    const firstChat = chat();
    const secondChat = { ...firstChat, title: "New title" };
    const first = data.persist(firstChat);
    expect(data.persist(firstChat)).toBe(first);
    const second = data.persist(secondChat);
    fresh.resolve(summary(secondChat));
    await second;
    old.resolve(summary(firstChat));
    await first;
    expect(data.snapshot().history[0].title).toBe("New title");
    await data.persist(secondChat);
    expect(storage.save).toHaveBeenCalledTimes(2);
  });

  it("cancels queued saves and prevents in-flight reads, saves and history from reviving a deleted chat", async () => {
    const session = chat();
    const { data, storage, live } = fixture([summary(session)]);
    const reading = deferred<Session | null>();
    const writing = deferred<SessionSummary | null>();
    const listing = deferred<SessionSummary[]>();
    storage.get.mockReturnValueOnce(reading.promise);
    storage.save.mockReturnValueOnce(writing.promise);
    storage.list.mockReturnValueOnce(listing.promise);
    const read = data.load(session.id);
    const list = data.refreshHistory(session.cwd);
    live.current = [session];
    data.observe(live.current, new Set());
    data.beginRemoval(session.id);
    data.forget(session.id);
    live.current = [];
    data.endRemoval(session.id);
    reading.resolve(session);
    writing.resolve(summary(session));
    listing.resolve([summary(session)]);
    expect(await read).toBeNull();
    await list;
    await vi.advanceTimersByTimeAsync(6_000);
    expect(data.snapshot().history).toEqual([]);
    expect(storage.save).toHaveBeenCalledTimes(1);
  });

  it("resumes saving the current live version when removal is cancelled", async () => {
    const { data, storage, live } = fixture();
    live.current = [chat()];
    data.restore(live.current);
    live.current = [{ ...live.current[0], title: "Unsent save" }];
    data.observe(live.current, new Set());
    data.beginRemoval("chat");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(storage.save).not.toHaveBeenCalled();
    data.endRemoval("chat");
    await vi.advanceTimersByTimeAsync(650);
    expect(storage.save).toHaveBeenCalledExactlyOnceWith(live.current[0]);
  });

  it("bounds save deferral while other output keeps changing", async () => {
    const { data, storage } = fixture();
    const seed = chat();
    data.restore([seed]);
    const update = (index: number) => ({
      ...seed,
      blocks: [
        ...seed.blocks,
        { id: "answer", role: "assistant" as const, text: String(index) },
      ],
    });
    data.observe([update(0)], new Set());
    for (let i = 1; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(250);
      data.observe([update(i)], new Set());
    }
    expect(storage.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(storage.save.mock.calls[0][0].blocks.at(-1)?.text).toBe("19");
  });

  it("saves new user turns immediately but skips unchanged restored transcripts", async () => {
    const { data, storage } = fixture();
    const seed = chat();
    data.restore([seed]);
    data.observe([seed], new Set([seed.id]));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(storage.save).not.toHaveBeenCalled();
    const next = {
      ...seed,
      busy: true,
      blocks: [
        ...seed.blocks,
        { id: "next", role: "user" as const, text: "Continue" },
      ],
    };
    data.observe([next], new Set([seed.id]));
    expect(storage.save).toHaveBeenCalledExactlyOnceWith(next);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(storage.save).toHaveBeenCalledTimes(1);
  });

  it("invalidates an old transcript read and queued save when native data arrives", async () => {
    const { data, storage } = fixture();
    const seed = chat();
    data.restore([seed]);
    const next = { ...seed, title: "Local" };
    data.observe([next], new Set());
    const reading = deferred<Session | null>();
    storage.get.mockReturnValueOnce(reading.promise);
    const old = data.load(seed.id);
    const external = { ...next, title: "Native" };
    expect(data.acceptExternal(external, summary(external))).toBe(true);
    reading.resolve(seed);
    expect(await old).toBeNull();
    await vi.advanceTimersByTimeAsync(650);
    await data.persist(external);
    expect(storage.save).not.toHaveBeenCalled();
    expect(data.snapshot().history[0].title).toBe("Native");
  });

  it("keeps a newer canonical rename when an alias listing finishes", async () => {
    const { data, storage } = fixture([summary()]);
    const pending = deferred<SessionSummary[]>();
    storage.list.mockReturnValueOnce(pending.promise);
    const reading = data.refreshHistory("/alias");
    data.updateSummary("chat", (row) => ({ ...row, title: "Renamed" }));
    pending.resolve([summary()]);
    await reading;
    expect(data.snapshot().history).toHaveLength(1);
    expect(data.snapshot().history[0].title).toBe("Renamed");
  });

  it("discards a removed project's listing and save while a re-added project gets a fresh listing", async () => {
    const { data, storage } = fixture();
    const old = deferred<SessionSummary[]>();
    const fresh = deferred<SessionSummary[]>();
    const saving = deferred<SessionSummary | null>();
    storage.list
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    storage.save.mockReturnValueOnce(saving.promise);
    const oldRead = data.refreshHistory("/repo");
    const oldWrite = data.persist(chat());
    data.removeProject("/repo");
    const newRead = data.refreshHistory("/repo");
    old.resolve([summary(chat("stale"))]);
    saving.resolve(summary(chat("stale-save")));
    await Promise.all([oldRead, oldWrite]);
    expect(data.snapshot().history).toEqual([]);
    fresh.resolve([summary(chat("fresh"))]);
    await newRead;
    expect(data.snapshot().history.map((row) => row.id)).toEqual(["fresh"]);
  });

  it("keeps a late linked-session read from restoring a removed link", async () => {
    const linked = {
      ...summary(),
      linkedWorkItem: {
        kind: "issue" as const,
        url: "https://github.com/a/b/issues/1",
        number: 1,
        repo: "a/b",
      },
    };
    const { data, storage } = fixture([linked]);
    const reading = deferred<SessionSummary[]>();
    storage.linked.mockReturnValueOnce(reading.promise);
    data.refreshLinked();
    data.updateSummary(linked.id, (row) => ({
      ...row,
      linkedWorkItem: undefined,
    }));
    reading.resolve([linked]);
    await reading.promise;
    await Promise.resolve();
    expect(data.snapshot().storedLinkedSessions).toEqual([]);
    expect(data.snapshot().history[0].linkedWorkItem).toBeUndefined();
  });

  it("does not let a cancelled opening release a newer opening of the same session", () => {
    const { data } = fixture();
    const cancelOld = data.beginOpening("chat");
    data.invalidate("chat");
    const cancelNew = data.beginOpening("chat");
    cancelOld();
    expect(data.isOpening("chat")).toBe(true);
    cancelNew();
    expect(data.isOpening("chat")).toBe(false);
  });

  it("rebases retained and queued data after outstanding writes, without cancelling another project's read", async () => {
    const first = chat();
    const other = chat("other", "/other");
    const { data, storage } = fixture([summary(first), summary(other)]);
    data.restore([first]);
    data.retain(first);
    const updated = { ...first, title: "Queued" };
    data.observe([updated], new Set());
    const flushed = deferred<void>();
    const rebased = deferred<void>();
    const otherRead = deferred<Session | null>();
    storage.flush.mockReturnValueOnce(flushed.promise);
    storage.rebase.mockReturnValueOnce(rebased.promise);
    storage.get.mockReturnValueOnce(otherRead.promise);
    const reading = data.load("other");
    const moving = data.rebaseProject("/repo", "/moved");
    await vi.advanceTimersByTimeAsync(700);
    expect(storage.save).not.toHaveBeenCalled();
    expect(storage.rebase).not.toHaveBeenCalled();
    flushed.resolve();
    await flushed.promise;
    expect(storage.rebase).toHaveBeenCalledWith("/repo", "/moved");
    otherRead.resolve(other);
    expect(await reading).toBe(other);
    rebased.resolve();
    await moving;
    expect((await data.load(first.id))?.cwd).toBe("/moved");
    await vi.advanceTimersByTimeAsync(650);
    expect(storage.save).toHaveBeenCalledExactlyOnceWith({
      ...updated,
      cwd: "/moved",
    });
    expect(
      data.snapshot().history.find((row) => row.id === first.id)?.cwd,
    ).toBe("/moved");
  });

  it("keeps optimistic metadata updates when an earlier transcript save finishes", async () => {
    const { data, storage } = fixture([summary()]);
    const pending = deferred<SessionSummary | null>();
    storage.save.mockReturnValueOnce(pending.promise);
    const saving = data.persist(chat());
    data.updateSummary("chat", (row) => ({ ...row, title: "Renamed" }));
    pending.resolve(summary());
    expect(await saving).toBeNull();
    expect(data.snapshot().history[0].title).toBe("Renamed");
  });

  it("cleans up timers and rejects old work across a StrictMode-style effect restart", async () => {
    const { data, storage } = fixture();
    const old = deferred<SessionSummary | null>();
    storage.save.mockReturnValueOnce(old.promise);
    const saving = data.persist(chat());
    data.stop();
    data.start();
    old.resolve(summary(chat()));
    await saving;
    expect(data.snapshot().history).toEqual([]);
    data.observe([chat()], new Set());
    await vi.advanceTimersByTimeAsync(650);
    expect(data.snapshot().history).toHaveLength(1);
    expect(storage.save).toHaveBeenCalledTimes(2);
    data.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
