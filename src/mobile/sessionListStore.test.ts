import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostSessionSummary } from "../features/connections/model/protocol";
import { createSessionListStore, sessionListStore } from "./sessionListStore";

const session = (id: string, status: "idle" | "running" = "idle"): HostSessionSummary => ({
  id, projectId: "project", title: id, status, revision: 1, harness: "codex", updatedAt: 1,
});
const settle = () => vi.advanceTimersByTimeAsync(0);
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("shared mobile session lists", () => {
  it("shares a batch across surfaces, retains freshness across a handoff, and stops at the last unsubscribe", async () => {
    const load = vi.fn(async (id: string) => [session(id)]);
    const store = createSessionListStore(load);
    const home = vi.fn(), drawer = vi.fn();
    const stopHome = store.subscribe(["one", "two"], home);
    const stopDrawer = store.subscribe(["one", "two"], drawer);
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(home).toHaveBeenCalledTimes(1);
    expect(drawer).toHaveBeenCalledTimes(1);
    stopHome();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(load).toHaveBeenCalledTimes(4);
    stopDrawer();
    await vi.advanceTimersByTimeAsync(500);
    const stopMenu = store.subscribe(["one", "two"], vi.fn());
    await settle();
    expect(load).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(load).toHaveBeenCalledTimes(6);
    stopMenu();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(6);
  });

  it("keeps the visible running project's 750 ms freshness without accelerating other lists", async () => {
    const load = vi.fn(async (id: string) => [session(id, id === "one" ? "running" : "idle")]);
    const store = createSessionListStore(load);
    const stopAll = store.subscribe(["one", "two"], vi.fn());
    const stopCurrent = store.subscribe(["one"], vi.fn(), true);
    await settle();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(load.mock.calls.filter(([id]) => id === "one")).toHaveLength(5);
    expect(load.mock.calls.filter(([id]) => id === "two")).toHaveLength(2);
    stopCurrent();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(load).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(9);
    stopAll();
  });

  it("keeps fast polling and paints settled lists while another project is still pending", async () => {
    const load = vi.fn((id: string) => id === "slow" ? new Promise<HostSessionSummary[]>(() => {})
      : Promise.resolve([session(id, "running")]));
    const store = createSessionListStore(load);
    const allChanged = vi.fn(), currentChanged = vi.fn();
    const stopAll = store.subscribe(["fast", "slow"], allChanged);
    const stopCurrent = store.subscribe(["fast"], currentChanged, true);
    await settle();
    expect(currentChanged).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(16);
    expect(allChanged).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().fast.sessions?.[0].id).toBe("fast");
    expect(store.getSnapshot().slow).toBeUndefined();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(load.mock.calls.filter(([id]) => id === "fast")).toHaveLength(5);
    expect(load.mock.calls.filter(([id]) => id === "slow")).toHaveLength(1);
    expect(currentChanged).toHaveBeenCalledTimes(5);
    stopAll(); stopCurrent();
  });

  it("keeps cached rows on failure and lets an explicit retry bypass freshness", async () => {
    const cached = [session("cached")];
    const updated = [session("updated")];
    const load = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(updated);
    const store = createSessionListStore(load);
    store.seed(["one"], () => cached);
    const stop = store.subscribe(["one"], vi.fn());
    await settle();
    expect(store.getSnapshot().one).toMatchObject({ sessions: cached, failed: true, loading: false });
    store.refresh(["one"]);
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().one).toMatchObject({ sessions: updated, failed: false });
    stop();
  });

  it("reuses an in-flight request after closing and refreshes a mutation made during that request", async () => {
    let resolve!: (rows: HostSessionSummary[]) => void;
    const load = vi.fn().mockReturnValueOnce(new Promise<HostSessionSummary[]>((done) => { resolve = done; }))
      .mockResolvedValue([session("after mutation")]);
    const store = createSessionListStore(load);
    const stopFirst = store.subscribe(["one"], vi.fn());
    await settle();
    stopFirst();
    const stopSecond = store.subscribe(["one"], vi.fn());
    store.refresh(["one"]);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    resolve([session("before mutation")]);
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().one.sessions?.[0].title).toBe("after mutation");
    stopSecond();
  });

  it("isolates the same project ID on different Hosts and publishes one notification for 113 projects", async () => {
    const firstLoad = vi.fn(async () => [session("first Host")]);
    const secondLoad = vi.fn(async () => [session("second Host")]);
    const first = sessionListStore(firstLoad), second = sessionListStore(secondLoad);
    expect(sessionListStore(firstLoad)).toBe(first);
    const firstChanged = vi.fn(), secondChanged = vi.fn();
    const ids = Array.from({ length: 113 }, (_, index) => String(index));
    const stopFirst = first.subscribe(ids, firstChanged);
    const stopSecond = second.subscribe(["0"], secondChanged);
    await settle();
    expect(firstChanged).toHaveBeenCalledTimes(1);
    expect(secondChanged).toHaveBeenCalledTimes(1);
    expect(firstLoad).toHaveBeenCalledTimes(113);
    expect(secondLoad).toHaveBeenCalledTimes(1);
    expect(first.getSnapshot()["0"].sessions?.[0].title).toBe("first Host");
    expect(second.getSnapshot()["0"].sessions?.[0].title).toBe("second Host");
    stopFirst(); stopSecond();
  });
});
