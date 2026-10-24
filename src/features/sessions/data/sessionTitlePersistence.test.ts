import { afterEach, describe, expect, it, vi } from "vitest";
import { newSession } from "../model/session";
import { manualSessionTitle } from "../../../domain/titlePolicy";
import { setSharedSessionBackend, type SharedSessionBackend } from "./sharedSessionBackend";
import { persistManualSessionTitle } from "./sessionStore";
import * as remoteProjects from "../../connections/model/remoteProjects";
import { remoteRequest } from "../../connections/model/connections";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../connections/model/connections", () => ({
  remoteMachineFor: vi.fn(async () => ({ id: "paired-machine" })),
  remoteSessionFor: vi.fn(() => "host-session"),
  remoteRequest: vi.fn(async () => {}),
}));
afterEach(() => {
  setSharedSessionBackend(undefined);
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function backend(exists: boolean) {
  const update = vi.fn(async () => {});
  setSharedSessionBackend({ ownsSession: () => true, get: async () => exists ? newSession("codex", "/project") : null, update } as unknown as SharedSessionBackend);
  return update;
}
describe("manual title execution ownership", () => {
  it("writes a desktop rename to the Host and does not increment an already-stamped epoch", async () => {
    const update = backend(true);
    const session = manualSessionTitle(newSession("codex", "/project"), "codex · My title");
    const saved = await persistManualSessionTitle(session, session.title);
    expect(update).toHaveBeenCalledWith(session.id, { title: session.title });
    expect(saved.titleState).toEqual(session.titleState);
  });
  it("retains a protected name when a new draft has no Host row yet", async () => {
    const update = backend(false);
    const session = newSession("codex", "/project");
    const saved = await persistManualSessionTitle(session, "My draft name");
    expect(update).not.toHaveBeenCalled();
    expect(saved.titleState?.source).toBe("manual");
    expect(saved.title).toBe("My draft name");
  });

  it("returns a successful remote rename without treating it as a read-only cache", async () => {
    vi.spyOn(remoteProjects, "remoteProjectFor").mockReturnValue({
      key: "remote://paired/repo", environmentId: "paired", projectId: "repo", cwd: "/repo",
    });
    const session = newSession("codex", "remote://paired/repo");
    session.blocks = [{ id: "u", role: "user", text: "hello" }];
    const saved = await persistManualSessionTitle(session, "New title");
    expect(saved.title).toBe("New title");
    expect(remoteRequest).toHaveBeenCalledWith("paired-machine", "sessions.update", {
      projectId: "repo", sessionId: "host-session", title: "New title",
    });
  });
});
