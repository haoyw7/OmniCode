// @vitest-environment happy-dom
import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../features/sessions/model/session";
import { type Session } from "../../contracts/session";
import { configureSharedHost } from "../../features/connections/model/remoteProjects";
import { useSessionSubmission } from "./useSessionSubmission";
const mocks = vi.hoisted(() => ({ submit: vi.fn(), ensure: vi.fn(), create: vi.fn(), toast: vi.fn(), remember: vi.fn(), removing: vi.fn() }));
vi.mock("../../features/projects/model/projectLocation", () => ({ synchronizeProjectLocation: async (path: string) => ({ path, identity: "", moved: false }) }));
vi.mock("../../features/connections/model/hostSessionSubmission", () => ({ submitHostSession: mocks.submit, isHostSubmissionPreparing: () => false }));
vi.mock("../../features/connections/model/remoteProjects", async original => ({ ...await original<typeof import("../../features/connections/model/remoteProjects")>(), ensureSharedProject: mocks.ensure }));
vi.mock("../../platform/tauri/fs", () => ({ createPath: mocks.create }));
vi.mock("../../features/projects/model/chatFolders", async original => ({ ...await original<typeof import("../../features/projects/model/chatFolders")>(), rememberChatFolder: mocks.remember }));
vi.mock("../../shared/ui/StatusToast", () => ({ showStatusToast: mocks.toast }));
let root: Root; let container: HTMLDivElement;
let actions: ReturnType<typeof useSessionSubmission>;
let view: { sessions: Session[]; cwd: string };
async function mount(cwd: string, overrides: Partial<Session> = {}) {
  const initial = { ...newSession("codex", cwd), id: "session", ...overrides };
  function Harness() {
    const [sessions, setSessions] = useState([initial]);
    const [projectCwd, setProjectCwd] = useState(cwd);
    const sessionsRef = useRef(sessions); sessionsRef.current = sessions;
    actions = useSessionSubmission({ sessionData: { isRemoving: mocks.removing }, sessionsRef,
      navigation: { isSwitching: () => false, pinSessionToCurrentWorkspace: vi.fn() },
      removingWorktreePaths: useRef(new Set()), setSessions, setProjectCwd,
      submitAfterProjectSyncRef: useRef(() => false), dismissNoticesForContinuedSession: vi.fn(),
      projectLocationSyncs: useRef(new Map()), applyProjectLocationChange: vi.fn(),
    });
    view = { sessions, cwd: projectCwd }; return null;
  }
  await act(async () => root.render(createElement(Harness)));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks();
  configureSharedHost(undefined, []); mocks.submit.mockResolvedValue(true);
  mocks.create.mockResolvedValue("/chats/new"); mocks.ensure.mockResolvedValue({ cwd: "/chats/new" });
  mocks.removing.mockReturnValue(false); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); configureSharedHost(undefined, []); vi.unstubAllGlobals(); });
it.each(["/repo", "~"])("keeps the draft at %s when Host is unavailable", async cwd => {
  await mount(cwd); const onSettled = vi.fn();
  expect(actions.onSubmit("session", "keep", [], { onSettled })).toBe(false);
  expect(onSettled).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
});
it("sends a background project session without a mounted pane", async () => {
  configureSharedHost("local", []); await mount("/repo"); const onSettled = vi.fn();
  expect(await actions.submitSession("session", "work", [], { managed: true, onSettled })).toBe(true);
  expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ id: "session", cwd: "/repo" }), "work", [], { managed: true, onSettled, projectLocationReady: true, onWorktreeCreation: expect.any(Function) }, expect.any(Function));
});
it("creates the home folder and sends directly to Host before publishing the new path", async () => {
  configureSharedHost("local", []); await mount("~");
  await act(async () => { expect(await actions.submitSession("session", "hello")).toBe(true); });
  expect(mocks.ensure).toHaveBeenCalledWith("/chats/new");
  expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/chats/new" }), "hello", [], { onWorktreeCreation: expect.any(Function) }, expect.any(Function));
  expect(view.cwd).toBe("/chats/new"); expect(view.sessions[0].blocks).toEqual([]);
});
it("restores a failed home draft once without publishing its folder", async () => {
  configureSharedHost("local", []); await mount("~"); mocks.ensure.mockRejectedValue(new Error("Host offline"));
  const onSubmissionRejected = vi.fn(); const onSettled = vi.fn();
  await act(async () => { expect(actions.onSubmit("session", "keep", [], { onSubmissionRejected, onSettled })).toBe(true); await vi.waitFor(() => expect(onSubmissionRejected).toHaveBeenCalledTimes(1)); });
  expect(onSettled).toHaveBeenCalledTimes(1); expect(view.cwd).toBe("~"); expect(mocks.submit).not.toHaveBeenCalled();
});
it("does not publish a home folder after Host rejects the first message", async () => {
  configureSharedHost("local", []); await mount("~"); mocks.submit.mockRejectedValue(new Error("Host rejected"));
  await act(async () => { expect(await actions.submitSession("session", "keep")).toBe(false); });
  expect(view.cwd).toBe("~"); expect(mocks.remember).not.toHaveBeenCalled();
});
it("routes Inbox Ask to Host with its source marker", async () => {
  configureSharedHost("local", []); await mount("/repo", { inboxAsk: { source: "github", key: "test" } as Session["inboxAsk"] });
  expect(await actions.submitSession("session", "explain")).toBe(true);
  expect(mocks.submit.mock.calls[0][0].inboxAsk).toEqual({ source: "github", key: "test" });
});
it.each(["~", ""])("does not restart a local provider for legacy history at %s", async cwd => {
  configureSharedHost("local", []); await mount(cwd, { blocks: [{ id: "old", role: "user", text: "old" }] });
  expect(actions.onSubmit("session", "continue")).toBe(false); expect(mocks.submit).not.toHaveBeenCalled();
});
