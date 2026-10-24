import { beforeEach, expect, it, vi } from "vitest";
import { useSessionTurnActions } from "./useSessionTurnActions";
import { newSession } from "../../features/sessions/model/session";
import type { HostCommand, HostSession } from "../../contracts/protocol";
import type { Session } from "../../contracts/session";
const mocks = vi.hoisted(() => ({ mutate: vi.fn(), toast: vi.fn(), save: vi.fn() }));
vi.mock("react", () => ({ useCallback: (callback: unknown) => callback }));
vi.mock("../../features/connections/model/hostSessionSubmission", () => ({ mutateHostSession: mocks.mutate }));
vi.mock("../../features/connections/model/remoteProjects", () => ({ remoteProjectFor: () => ({ local: true }), projectPath: (_p: unknown, path: string) => path }));
vi.mock("../../features/sessions/model/models", async original => ({ ...await original<typeof import("../../features/sessions/model/models")>(), saveLastModelSettings: mocks.save }));
vi.mock("../../shared/ui/StatusToast", () => ({ showStatusToast: mocks.toast }));
let sessionsRef: { current: Session[] }; let commands: HostCommand[]; let submit: ReturnType<typeof vi.fn>;
let actions: ReturnType<typeof useSessionTurnActions>;
beforeEach(() => {
  vi.clearAllMocks(); commands = [];
  sessionsRef = { current: [{ ...newSession("codex", "/repo"), id: "shell", blocks: [{ id: "plan", role: "plan", text: "approved", plan: { status: "ready" } }], queuedMessages: [{ id: "queued", text: "next", attachments: [] }] }] };
  submit = vi.fn(() => true);
  mocks.mutate.mockImplementation(async (_session: Session, command: (snapshot: HostSession, id: string) => HostCommand) => {
    const snapshot = { projectId: "project", revision: 1, status: "running" as const, runId: "run", updatedAt: 1,
      session: { ...sessionsRef.current[0], id: "host" } };
    commands.push(command(snapshot, "command"));
    return snapshot;
  });
  actions = useSessionTurnActions({ sessionsRef, setSessions: update => { sessionsRef.current = typeof update === "function" ? update(sessionsRef.current) : update; }, onSubmit: submit });
});
it("sends queue controls to Host with the synchronized run identity", async () => {
  actions.onSteerQueuedMessage("shell", "queued");
  await vi.waitFor(() => expect(commands).toEqual([{ type: "queue", commandId: "command", sessionId: "host", action: "steer", messageId: "queued", beforeId: undefined, runId: "run" }]));
  expect(submit).not.toHaveBeenCalled(); expect(sessionsRef.current[0].queuedMessages).toHaveLength(1);
});
it("keeps edited plan text unchanged locally until Host returns its projection", async () => {
  mocks.mutate.mockImplementation(() => new Promise(() => {}));
  actions.onUpdatePlan("shell", "plan", "edited");
  expect(mocks.mutate).toHaveBeenCalledWith(sessionsRef.current[0], expect.any(Function), "sessions.planEdit.v1");
  expect(sessionsRef.current[0].blocks[0].text).toBe("approved");
});
it("builds through Host submission with the approved block and chosen model", () => {
  const target = { harness: "codex" as const, model: "new", modelSettings: {} };
  actions.onBuildPlan("shell", "plan", target);
  expect(submit).toHaveBeenCalledWith("shell", "Build approved plan", [], { intent: "build", planBlockId: "plan", buildTarget: target });
});
it("lets Host schedule reset and atomically resume instead of running a UI timer", async () => {
  actions.onUsageLimitResumeAtReset("shell", true);
  actions.onUsageLimitResume("shell");
  await vi.waitFor(() => expect(commands).toHaveLength(2));
  expect(commands).toEqual([
    { type: "usageLimit", commandId: "command", sessionId: "host", action: "resumeAtReset", enabled: true },
    { type: "usageLimit", commandId: "command", sessionId: "host", action: "resume" },
  ]);
  expect(submit).not.toHaveBeenCalled();
});
