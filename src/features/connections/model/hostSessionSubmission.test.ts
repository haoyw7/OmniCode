// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import { submitHostSession, stopHostConversation, deleteHostConversation, hostSubmissionCommand } from "./hostSessionSubmission";
const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), load: vi.fn(), request: vi.fn(), bound: vi.fn(), remember: vi.fn(), descriptor: vi.fn(), upload: vi.fn() }));
vi.mock("./connections", () => ({ dispatchRemoteCommand: mocks.dispatch, loadRemoteSessionText: mocks.load, remoteRequest: mocks.request,
  remoteMachineFor: async () => ({ id: "machine", environmentId: "env" }), remoteSessionFor: mocks.bound, remoteSessionScopeFor: () => undefined,
  rememberRemoteSession: mocks.remember, rememberRemotePendingExecutionCwd: vi.fn(), pendingRemoteCommand: () => undefined,
  REMOTE_HISTORY_CHANGE: "history" }));
vi.mock("./remoteProjects", () => ({ remoteProjectFor: () => ({ key: "/repo", cwd: "/repo", environmentId: "env", projectId: "project", local: true }), parseRemotePath: () => undefined, ensureSharedProject: vi.fn() }));
vi.mock("./remoteHostMetadata", () => ({ loadRemoteHostDescriptor: mocks.descriptor }));
vi.mock("./remoteAttachments", () => ({ uploadRemoteAttachments: mocks.upload }));
vi.mock("../../sessions/data/sharedSessionBackend", () => ({ sharedSessionBackend: () => undefined }));
vi.mock("../../providers/model/providerAccounts", () => ({ supportsProviderAccounts: () => false, requestedProviderAccountId: vi.fn(), workBuddyAccountIdForModel: vi.fn() }));
vi.mock("../../settings/model/settings", () => ({ loadFollowUpBehavior: () => "queue" }));
const shell = () => ({ ...newSession("codex", "/repo"), id: "shell", model: "test" });
beforeEach(() => {
  vi.clearAllMocks(); mocks.bound.mockReturnValue(undefined);
  mocks.descriptor.mockResolvedValue({ capabilities: ["sessions.submit.v1", "sessions.inbox.v1", "sessions.queue", "sessions.outcome.v1"] });
  mocks.upload.mockResolvedValue([]); mocks.dispatch.mockResolvedValue({ sessionId: "host", commandId: "command", revision: 1 });
  mocks.load.mockResolvedValue({ session: { ...shell(), id: "host" }, revision: 1, status: "idle" });
  mocks.request.mockImplementation(async (_machine, method, params) => method === "commands.outcome"
    ? { sessionId: params.sessionId, commandId: params.commandId, revision: 3, outcome: { status: "completed", text: "my reply" } }
    : undefined);
});
it("creates and sends a pane-independent conversation in one durable outbox chain", async () => {
  expect(await submitHostSession(shell(), "hello")).toBe(true);
  expect(mocks.dispatch).toHaveBeenCalledWith("machine", "/repo", "env", expect.objectContaining({ type: "create", projectId: "project" }), "shell", expect.objectContaining({ type: "send", text: "hello", sessionId: "" }));
  expect(mocks.remember).toHaveBeenCalledWith("shell", "host", expect.objectContaining({ projectId: "project" }));
});
it("keeps all managed, CI, plan, queue and user-card metadata on the wire", () => {
  const session = shell();
  const command = hostSubmissionCommand(session, "host", "visible", [], { managed: true,
    ciRepair: { prompt: "repair evidence" }, appRequestId: "app", queuedMessageId: "queued", planBlockId: "plan",
    buildTarget: { harness: "codex", model: "next", modelSettings: {} }, resendEdited: true,
    noteCard: null, handoffCard: null, followUpBehavior: "steer" });
  expect(command).toMatchObject({ type: "send", managed: true, text: "visible", promptOverride: "repair evidence", ciContext: "repair evidence",
    appRequestId: "app", queuedMessageId: "queued", planBlockId: "plan", buildTarget: { model: "next" }, resendEdited: true, noteCard: null, handoffCard: null, followUpBehavior: "steer" });
});
it("settles from this command's durable outcome while another queued turn is already running", async () => {
  mocks.bound.mockReturnValue("host");
  const outcome = { status: "completed", text: "my reply" };
  mocks.load.mockResolvedValue({ session: { ...shell(), id: "host", busy: true, blocks: [{ id: "command", role: "user", text: "hello", turnOutcome: outcome }] }, status: "running", runId: "next", revision: 3 });
  const onSettled = vi.fn();
  expect(await submitHostSession(shell(), "hello", [], { commandId: "command", managed: true, onSettled })).toBe(true);
  await vi.waitFor(() => expect(onSettled).toHaveBeenCalledExactlyOnceWith(outcome));
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.request).toHaveBeenCalledWith("machine", "commands.outcome", { sessionId: "host", commandId: "command" });
});
it("rejects extended actions on an old Host before uploading or dispatching", async () => {
  mocks.descriptor.mockResolvedValue({ capabilities: [] }); const onSettled = vi.fn();
  await expect(submitHostSession(shell(), "hello", [], { managed: true, onSettled })).rejects.toThrow("Update the Host");
  expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled();
  expect(onSettled).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: "failed" }));
});
it("waits for cancellation to finish before deleting an Inbox conversation", async () => {
  mocks.bound.mockReturnValue("host");
  const base = { session: { ...shell(), id: "host" }, revision: 1, runId: "run", status: "running" };
  mocks.load.mockResolvedValueOnce(base).mockResolvedValueOnce(base).mockResolvedValueOnce({ ...base, status: "idle", runId: undefined });
  await deleteHostConversation(shell());
  expect(mocks.dispatch).toHaveBeenCalledWith("machine", "/repo", "env", expect.objectContaining({ type: "cancel", runId: "run" }), "shell");
  expect(mocks.load).toHaveBeenCalledTimes(3);
  expect(mocks.request).toHaveBeenCalledWith("machine", "sessions.delete", { projectId: "project", sessionId: "host" });
  expect(mocks.remember).toHaveBeenCalledWith("shell");
});
it("does not send a cancellation for an unsent shell", async () => {
  expect(await stopHostConversation(shell())).toBeUndefined(); expect(mocks.dispatch).not.toHaveBeenCalled();
});

it("observes the queued user identity rather than the queue dispatch command ID", async () => {
  mocks.bound.mockReturnValue("host");
  const outcome = { status: "completed", text: "queued reply" };
  mocks.request.mockResolvedValue({ sessionId: "host", commandId: "queued", revision: 2, outcome });
  mocks.load.mockResolvedValue({ session: { ...shell(), blocks: [{ id: "queued", role: "user", text: "queued", turnOutcome: outcome }] }, status: "idle", revision: 2 });
  const onSettled = vi.fn();
  await submitHostSession(shell(), "queued", [], { queuedMessageId: "queued", commandId: "dispatch", onSettled });
  await vi.waitFor(() => expect(onSettled).toHaveBeenCalledExactlyOnceWith(outcome));
});

it("continues observing an accepted Host task through a transport interruption", async () => {
  vi.useFakeTimers();
  try {
    mocks.bound.mockReturnValue("host");
    const outcome = { status: "completed", text: "finished while disconnected" };
    mocks.request.mockRejectedValueOnce(new Error("network offline")).mockResolvedValue({
      sessionId: "host", commandId: "command", revision: 3, outcome,
    });
    const onSettled = vi.fn();
    expect(await submitHostSession(shell(), "hello", [], { commandId: "command", onSettled })).toBe(true);
    expect(onSettled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(outcome);
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.load).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it("refuses deletion if another turn starts while cancellation is completing", async () => {
  mocks.bound.mockReturnValue("host");
  const base = { session: { ...shell(), id: "host", busy: true }, revision: 1, runId: "old", status: "running" };
  mocks.load.mockResolvedValueOnce(base).mockResolvedValueOnce({ ...base, runId: "new" });
  await expect(deleteHostConversation(shell())).rejects.toThrow("already running");
  expect(mocks.request).not.toHaveBeenCalledWith("machine", "sessions.delete", expect.anything());
});

it.each([false, true])("restores an edited draft only from Host's rewind result (%s)", async providerRewound => {
  mocks.bound.mockReturnValue("host");
  mocks.request.mockResolvedValue({ sessionId: "host", commandId: "edited", revision: 3,
    outcome: { status: "failed", text: "", error: "Provider did not accept the edited turn", providerRewound } });
  const onResendRejected = vi.fn();
  expect(await submitHostSession(shell(), "edit", [], { commandId: "edited", resendEdited: true, onResendRejected })).toBe(true);
  await vi.waitFor(() => expect(onResendRejected).toHaveBeenCalledExactlyOnceWith({ providerRewound }));
});
