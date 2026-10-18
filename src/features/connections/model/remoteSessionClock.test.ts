import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { newSession } from "../../sessions/model/session";
import { loadRemoteSession } from "./connections";
import type { HostSession } from "./protocol";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

it.each([false, true])("calibrates desktop sync before chunk transfer (chunked=%s)", async (chunked) => {
  const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
  const value: HostSession = {
    projectId: "project", revision: 1, status: "running", updatedAt: 165_000,
    session: { ...newSession("pi", "/project"), id: "session", busy: true,
      blocks: [{ id: "user", role: "user", text: "Hello", startedAt: 165_000 }] },
  };
  const serialized = JSON.stringify({ kind: "snapshot", value });
  let unchanged = false;
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    if ((args as { method: string }).method === "sessions.sync") {
      now.mockReturnValue(100_200);
      if (unchanged) return { kind: "unchanged", revision: 1, serverTime: 165_100 };
      return chunked
        ? { kind: "chunked", transfer: "t", length: serialized.length, serverTime: 165_100 }
        : { kind: "snapshot", value, serverTime: 165_100 };
    }
    now.mockReturnValue(110_000);
    return { data: serialized };
  });
  const first = await loadRemoteSession("machine", "session");
  expect(first.clockOffsetMs).toBe(65_000);
  expect(first.session.blocks[0].startedAt).toBe(165_000);
  unchanged = true;
  now.mockReturnValue(100_000);
  expect(await loadRemoteSession("machine", "session", first)).toBe(first);
});
