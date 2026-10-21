import { afterEach, expect, it, vi } from "vitest";
import { MobileClient } from "./client";
import type { HostSession } from "../features/connections/model/protocol";
import { HISTORY_CAPABILITY, HISTORY_MODE } from "../integrations/harness/core/history";
import { TOOL_CONTENT_CAPABILITY, TOOL_CONTENT_MODE } from "../integrations/harness/core/toolContent";
import { queryClient } from "../shared/lib/queryClient";
import type { OfflineCacheEntry, MobileOfflineCache } from "./offlineCache";
import { isOfflineSession } from "./offlineCacheData";

afterEach(() => { queryClient.clear(); vi.useRealTimers(); });
it("persists an expanded window at the same revision and keeps it readable offline", async () => {
  vi.useFakeTimers();
  const saved = new Map<string, OfflineCacheEntry>();
  const cache: MobileOfflineCache = { readHost: async () => [...saved.values()], removeHost: async () => {},
    write: async (_host, entries) => { for (const entry of entries) if (entry.value !== undefined) saved.set(`${entry.kind}:${entry.id}`, { ...entry, value: entry.value }); } };
  const values = new Map<string, string>();
  const initial: HostSession = { contentMode: TOOL_CONTENT_MODE, history: { mode: HISTORY_MODE, start: "b75", hasMore: true },
    projectId: "p", revision: 1, status: "idle", updatedAt: 1, session: { id: "s", title: "S", cwd: "/p", harness: "codex", model: "codex:m", modelSettings: {}, runtimeMode: "supervised", blocks: [{ id: "b75", role: "assistant", text: "Tail" }] } };
  let offline = false;
  const transport = vi.fn(async (_endpoint: string, _token: string, input: unknown) => {
    const call = input as { method: string; params: Record<string, unknown> };
    if (call.method === "environment.describe") return { protocolVersion: 1, environmentId: "host", name: "Host", providers: ["codex"], capabilities: [HISTORY_CAPABILITY, TOOL_CONTENT_CAPABILITY] };
    if (offline) throw new Error("offline");
    if (call.method === "sessions.history") {
      expect(call.params.history).toEqual({ mode: HISTORY_MODE, start: "b75", before: "b75" });
      return { kind: "snapshot", contentMode: TOOL_CONTENT_MODE, history: { mode: HISTORY_MODE, start: "b0", hasMore: false },
        value: { ...initial, history: { mode: HISTORY_MODE, start: "b0", hasMore: false }, session: { ...initial.session, blocks: [{ id: "b0", role: "user", text: "Earlier" }, ...initial.session.blocks] } } };
    }
    return { kind: "snapshot", contentMode: TOOL_CONTENT_MODE, history: initial.history, value: initial };
  });
  const make = () => new MobileClient({ get: async k => values.get(k) ?? null, set: async (k, v) => { values.set(k, v); }, remove: async k => { values.delete(k); } }, transport, cache);
  const client = make(); await client.connect("http://host", "token");
  await client.session("s"); await client.flushOfflineCache();
  const page = await client.session("s", undefined, true); await client.flushOfflineCache();
  expect(page.session.blocks).toHaveLength(2);
  expect(isOfflineSession(page, "s")).toBe(true);
  expect(isOfflineSession({ ...page, history: { mode: HISTORY_MODE, start: 42, hasMore: true } }, "s")).toBe(false);
  expect((saved.get("session:s")!.value as HostSession).history?.hasMore).toBe(false);
  const restored = make(); await restored.connect("http://host", "token"); offline = true;
  expect(restored.cachedSession("s")?.session.blocks).toHaveLength(2);
  await expect(restored.session("s")).rejects.toThrow("offline");
  expect(restored.cachedSession("s")?.session.blocks[0].text).toBe("Earlier");
});
