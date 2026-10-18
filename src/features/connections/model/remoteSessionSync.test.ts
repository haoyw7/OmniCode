import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { loadRemoteSessionText } from "./connections";
import type { HostSession, SessionSyncResponse } from "./protocol";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const known: HostSession = {
  projectId: "project", revision: 1, status: "running", updatedAt: 1,
  session: { id: "session", cwd: "/repo", title: "Stream", harness: "pi", model: "pi:deepseek/deepseek-flash",
    runtimeMode: "supervised", modelSettings: {}, busy: true, blocks: [{ id: "a", role: "assistant", text: "A", streaming: true }] },
};

it("shares a pending revision across remounted panes and serializes requests for a newer revision", async () => {
  let resolve!: (value: SessionSyncResponse) => void;
  vi.mocked(invoke).mockImplementation(() => new Promise(done => { resolve = done; }));
  const first = loadRemoteSessionText("host", "session", known, 1_000);
  const remounted = loadRemoteSessionText("host", "session", known, 1_000);
  const newer = { ...known, revision: 2 };
  const second = loadRemoteSessionText("host", "session", newer, 1_000);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith("remote_request", { machineId: "host", method: "sessions.sync", params: { sessionId: "session", revision: 1, waitMs: 1_000 } });
  resolve({ kind: "unchanged", revision: 1 });
  vi.mocked(invoke).mockResolvedValue({ kind: "unchanged", revision: 2 });
  expect(await first).toBe(known);
  expect(await remounted).toBe(known);
  expect(await second).toBe(newer);
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(await loadRemoteSessionText("host", "session", newer)).toBe(newer);
  expect(invoke).toHaveBeenCalledTimes(3);
});

it("releases failed requests for retry and does not wait on a full resynchronization", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("offline"));
  await expect(loadRemoteSessionText("host", "session", known, 1_000)).rejects.toThrow("offline");
  vi.mocked(invoke).mockResolvedValueOnce({ kind: "delta", base: 0, value: { ...known, revision: 2 }, blockIds: ["a"], blocks: [] });
  vi.mocked(invoke).mockResolvedValueOnce({ kind: "snapshot", value: { ...known, revision: 2 } });
  expect((await loadRemoteSessionText("host", "session", known, 1_000)).revision).toBe(2);
  expect(invoke).toHaveBeenLastCalledWith("remote_request", { machineId: "host", method: "sessions.sync", params: { sessionId: "session", revision: undefined } });
});
