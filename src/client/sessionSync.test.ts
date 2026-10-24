import { expect, it, vi } from "vitest";
import type { HostSession, SessionSync } from "../contracts/protocol";
import { SessionSyncClient } from "./sessionSync";

const snapshot: HostSession = {
  projectId: "project", revision: 1, status: "idle", updatedAt: 1,
  session: { id: "session", harness: "codex", cwd: "/repo", model: "codex:test", title: "Conversation", modelSettings: {}, runtimeMode: "supervised", blocks: [] },
};

it("shares one request across panes and queues a different revision after it", async () => {
  let resolve!: (value: SessionSync) => void;
  const request = vi.fn().mockImplementationOnce(() => new Promise(done => { resolve = done; }))
    .mockResolvedValue({ kind: "unchanged", revision: 2 });
  const sync = new SessionSyncClient({ key: (target: string) => target, request });
  const first = sync.load("host", "session", snapshot, 1_000);
  const second = sync.load("host", "session", snapshot, 1_000);
  const newer = { ...snapshot, revision: 2 };
  const third = sync.load("host", "session", newer);
  expect(request).toHaveBeenCalledTimes(1);
  resolve({ kind: "unchanged", revision: 1 });
  expect(await first).toBe(snapshot);
  expect(await second).toBe(snapshot);
  expect(await third).toBe(newer);
  expect(request).toHaveBeenCalledTimes(2);
});

it("assembles bounded chunks and takes the clock sample before slow attachment transport", async () => {
  const json = JSON.stringify({ kind: "snapshot", value: snapshot });
  const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(300).mockReturnValue(10_000);
  const request = vi.fn().mockResolvedValueOnce({ kind: "chunked", transfer: "transfer", length: json.length, serverTime: 1_200 })
    .mockResolvedValueOnce({ data: json.slice(0, 10) }).mockResolvedValueOnce({ data: json.slice(10) });
  const sync = new SessionSyncClient({ key: (target: string) => target, request }, now);
  const result = await sync.load("host", "session");
  expect(result.clockOffsetMs).toBe(1_000);
  expect(result.session).toEqual(snapshot.session);
  expect(request.mock.calls[2]).toEqual(["host", "sessions.syncChunk", { sessionId: "session", transfer: "transfer", offset: 10 }]);
});

it.each(["", 5, "oversized"])("rejects stalled or malformed chunks (%s)", async (data) => {
  const request = vi.fn().mockResolvedValueOnce({ kind: "chunked", transfer: "t", length: 2 })
    .mockResolvedValueOnce({ data });
  const sync = new SessionSyncClient({ key: (target: string) => target, request });
  await expect(sync.load("host", "session")).rejects.toThrow("Incomplete conversation response.");
});

it("recovers a stale delta through one full sync without a long wait", async () => {
  const request = vi.fn().mockResolvedValueOnce({ kind: "unchanged", revision: 2 })
    .mockResolvedValueOnce({ kind: "snapshot", value: { ...snapshot, revision: 2 } });
  const sync = new SessionSyncClient({ key: (target: string) => target, request });
  expect((await sync.load("host", "session", snapshot, 1_000)).revision).toBe(2);
  expect(request.mock.calls[1]).toEqual(["host", "sessions.sync", { sessionId: "session", revision: undefined }]);
});
