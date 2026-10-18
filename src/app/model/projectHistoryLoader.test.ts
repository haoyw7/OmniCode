import { describe, expect, it, vi } from "vitest";
import { createProjectHistoryLoader } from "./projectHistoryLoader";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("project history loader", () => {
  it("deduplicates a project while allowing independent projects to finish out of order", async () => {
    const a = deferred<string[]>();
    const b = deferred<string[]>();
    const list = vi.fn((path: string) =>
      path === "/a" ? a.promise : b.promise,
    );
    const success = vi.fn();
    const loader = createProjectHistoryLoader({ list, success });
    const first = loader.load("/a");
    expect(loader.load("/a/")).toBe(first);
    const second = loader.load("/b");
    b.resolve(["b"]);
    await second;
    a.resolve(["a"]);
    await first;
    expect(list).toHaveBeenCalledTimes(2);
    expect(success.mock.calls.map(([path, rows]) => [path, rows])).toEqual([
      ["/b", ["b"]],
      ["/a", ["a"]],
    ]);
  });

  it("ignores a superseded response and keeps the latest request in flight", async () => {
    const old = deferred<string[]>();
    const fresh = deferred<string[]>();
    const list = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    const success = vi.fn();
    const loader = createProjectHistoryLoader({ list, success });
    const first = loader.load("/a");
    const second = loader.load("/a", true);
    old.resolve(["old"]);
    await first;
    expect(success).not.toHaveBeenCalled();
    expect(loader.load("/a")).toBe(second);
    fresh.resolve(["fresh"]);
    await second;
    expect(success).toHaveBeenCalledWith("/a", ["fresh"], expect.any(Number));
  });

  it("reports failures per project and allows retry without affecting another project", async () => {
    const failure = vi.fn();
    const success = vi.fn();
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue(["ok"]);
    const loader = createProjectHistoryLoader({ list, success, failure });
    await loader.load("/a");
    await loader.load("/b");
    await loader.load("/a");
    expect(failure).toHaveBeenCalledWith("/a");
    expect(success.mock.calls.map(([path]) => path)).toEqual(["/b", "/a"]);
  });

  it.each(["success", "failure"] as const)(
    "invalidates a removed project's stale %s while a new read and another project remain independent",
    async (outcome) => {
      const removed = deferred<string[]>();
      const fresh = deferred<string[]>();
      const other = deferred<string[]>();
      const list = vi
        .fn()
        .mockReturnValueOnce(removed.promise)
        .mockReturnValueOnce(other.promise)
        .mockReturnValueOnce(fresh.promise);
      const success = vi.fn();
      const failure = vi.fn();
      const loader = createProjectHistoryLoader({ list, success, failure });
      const oldRead = loader.load("/removed");
      const otherRead = loader.load("/other");

      loader.invalidate("/removed/");
      const freshRead = loader.load("/removed");
      expect(freshRead).not.toBe(oldRead);
      expect(list).toHaveBeenCalledTimes(3);
      if (outcome === "success") removed.resolve(["stale"]);
      else removed.reject(new Error("stale failure"));
      await oldRead;
      expect(success).not.toHaveBeenCalled();
      expect(failure).not.toHaveBeenCalled();
      expect(loader.load("/removed/")).toBe(freshRead);
      expect(loader.load("/other")).toBe(otherRead);

      fresh.resolve(["fresh"]);
      other.resolve(["other"]);
      await Promise.all([freshRead, otherRead]);
      expect(success.mock.calls.map(([path, rows]) => [path, rows])).toEqual([
        ["/removed", ["fresh"]],
        ["/other", ["other"]],
      ]);
    },
  );
});
