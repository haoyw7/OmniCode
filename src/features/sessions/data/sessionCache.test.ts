import { queryClient } from "../../../shared/lib/queryClient";
import { beforeEach, describe, expect, it } from "vitest";
import { newSession } from "../model/session";
import {
  estimateSessionCacheBytes,
  rememberLoadedSession,
} from "./sessionCache";

beforeEach(() => queryClient.clear());
const cacheKeys = (scope: readonly unknown[]) => queryClient.getQueryCache().findAll({ queryKey: scope })
  .sort((a, b) => Number(a.meta?.visited ?? 0) - Number(b.meta?.visited ?? 0))
  .map(query => query.queryKey.at(-1));

function chat(id: string): ReturnType<typeof newSession> {
  const session = newSession("cursor", "/tmp/project");
  session.id = id;
  return session;
}

describe("rememberLoadedSession", () => {
  it("keeps the newest session and drops the oldest past the limit", () => {
    const cache = ["sessionCacheTest"];
    rememberLoadedSession(cache, chat("a"), 2);
    rememberLoadedSession(cache, chat("b"), 2);
    rememberLoadedSession(cache, chat("c"), 2);
    expect(cacheKeys(cache)).toEqual(["b", "c"]);
  });

  it("treats a repeat as newest so it is not evicted", () => {
    const cache = ["sessionCacheTest"];
    rememberLoadedSession(cache, chat("a"), 2);
    rememberLoadedSession(cache, chat("b"), 2);
    rememberLoadedSession(cache, chat("a"), 2);
    rememberLoadedSession(cache, chat("c"), 2);
    expect(cacheKeys(cache)).toEqual(["a", "c"]);
  });

  it("evicts by estimated memory as well as entry count", () => {
    const cache = ["sessionCacheTest"];
    const a = chat("a");
    const b = chat("b");
    a.blocks = [{ id: "a1", role: "assistant", text: "a".repeat(200) }];
    b.blocks = [{ id: "b1", role: "assistant", text: "b".repeat(200) }];
    const budget = Math.max(
      estimateSessionCacheBytes(a),
      estimateSessionCacheBytes(b),
    );

    rememberLoadedSession(cache, a, 12, budget);
    rememberLoadedSession(cache, b, 12, budget);
    expect(cacheKeys(cache)).toEqual(["b"]);
  });

  it("does not retain one session larger than the whole budget", () => {
    const cache = ["sessionCacheTest"];
    const oversized = chat("large");
    oversized.blocks = [
      { id: "large-1", role: "assistant", text: "x".repeat(1_000) },
    ];

    rememberLoadedSession(cache, oversized, 12, 100);
    expect(cacheKeys(cache)).toEqual([]);
  });
});
