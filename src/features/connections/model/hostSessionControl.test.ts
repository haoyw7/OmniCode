import { beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import { controlHostSession } from "./hostSessionControl";
import type { HostSession } from "../../../contracts/protocol";

const mocks = vi.hoisted(() => ({
  load: vi.fn(), machine: vi.fn(), request: vi.fn(), binding: vi.fn(), scope: vi.fn(),
  project: vi.fn(),
}));
vi.mock("./connections", () => ({
  loadRemoteSessionText: mocks.load, remoteMachineFor: mocks.machine,
  dispatchRemoteCommand: mocks.request, remoteSessionFor: mocks.binding,
  remoteSessionScopeFor: mocks.scope,
}));
vi.mock("./remoteProjects", () => ({
  remoteProjectFor: mocks.project,
  sessionUsesHost: (session: { cwd: string; inboxAsk?: boolean }) => !session.inboxAsk && session.cwd !== "~",
}));

let snapshot: HostSession;
const shell = { ...newSession("codex", "/repo"), id: "shell" };
beforeEach(() => {
  vi.clearAllMocks();
  snapshot = { session: { ...shell, id: "host-session", busy: true }, projectId: "project",
    revision: 4, status: "running", runId: "run", updatedAt: 1, canSteer: true };
  mocks.load.mockImplementation(async () => snapshot);
  mocks.project.mockReturnValue({ key: "/repo", projectId: "project", environmentId: "env" });
  mocks.scope.mockReturnValue({ projectId: "project", environmentId: "env" });
  mocks.binding.mockReturnValue("host-session");
  mocks.machine.mockResolvedValue({ id: "machine" });
  mocks.request.mockResolvedValue({ commandId: "receipt", sessionId: "host-session", revision: 5 });
});

it("stops a parked Host worker using its current Host run and existing durable command path", async () => {
  await controlHostSession(shell, { type: "cancel" });
  expect(mocks.load).toHaveBeenCalledWith("machine", "host-session");
  expect(mocks.request).toHaveBeenCalledWith("machine", "/repo", "env", expect.objectContaining({
    type: "cancel", sessionId: "host-session", runId: "run",
  }), "shell");
});

it("keeps an ambiguous cancellation in the outbox without retrying locally", async () => {
  mocks.request.mockRejectedValueOnce(new Error("connection lost"));
  await expect(controlHostSession(shell, { type: "cancel" })).rejects.toThrow("connection lost");
  expect(mocks.request).toHaveBeenCalledTimes(1);
});

it("rejects a stale binding to another Host before issuing a command", async () => {
  mocks.scope.mockReturnValue({ projectId: "project", environmentId: "other" });
  await expect(controlHostSession(shell, { type: "cancel" })).rejects.toThrow("not attached");
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.request).not.toHaveBeenCalled();
});

it("rejects a returned projection from another project", async () => {
  snapshot.projectId = "other";
  await expect(controlHostSession(shell, { type: "cancel" })).rejects.toThrow("not attached");
  expect(mocks.request).not.toHaveBeenCalled();
});

it("does not invent a cancellation for a finished run", async () => {
  snapshot.session.busy = false;
  await controlHostSession(shell, { type: "cancel" });
  expect(mocks.request).not.toHaveBeenCalled();
});

it("compacts an idle Host conversation without inventing a run identity", async () => {
  snapshot.session.busy = false;
  snapshot.status = "idle";
  snapshot.runId = undefined;
  await controlHostSession(shell, { type: "compact" });
  expect(mocks.request).toHaveBeenCalledWith("machine", "/repo", "env", {
    type: "compact", commandId: expect.any(String), sessionId: "host-session",
  }, "shell");
});

it("keeps a question open on its current Host run", async () => {
  await controlHostSession(shell, { type: "keepQuestionOpen", requestId: 9 });
  expect(mocks.request).toHaveBeenCalledWith("machine", "/repo", "env", expect.objectContaining({
    type: "keepQuestionOpen", requestId: 9, sessionId: "host-session", runId: "run",
  }), "shell");
});

it("sends guidance through Host without adding a local transcript block", async () => {
  const before = [...shell.blocks];
  await controlHostSession(shell, { type: "steer", text: "use existing helper" });
  expect(mocks.request).toHaveBeenCalledWith("machine", "/repo", "env", expect.objectContaining({
    type: "send", followUpBehavior: "steer", text: "use existing helper", sessionId: "host-session",
  }), "shell");
  expect(shell.blocks).toEqual(before);
});

it("rejects guidance when the Host does not advertise steer support", async () => {
  snapshot.canSteer = false;
  await expect(controlHostSession(shell, { type: "steer", text: "guidance" })).rejects.toThrow("cannot receive guidance");
  expect(mocks.request).not.toHaveBeenCalled();
});

it.each([
  { type: "approve" as const, requestId: 4, decision: "allow" as const },
  { type: "answer" as const, requestId: 7, reply: { kind: "skipped" as const } },
])("routes $type to the same run-scoped Host command", async (control) => {
  await controlHostSession(shell, control);
  expect(mocks.request).toHaveBeenCalledWith("machine", "/repo", "env", expect.objectContaining({
    ...control, sessionId: "host-session", runId: "run",
  }), "shell");
});
