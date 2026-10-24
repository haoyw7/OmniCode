// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { revealHostSession } from "./useAgentAppBridge";
import { newSession } from "../../features/sessions/model/session";
import { leafIds, newTab } from "../../features/workspace/model/layout";
import type { DesktopAppCommand } from "../../contracts/app";
const mocks = vi.hoisted(() => ({ load: vi.fn(), remember: vi.fn(), bindings: new Map<string, string>() }));
vi.mock("../../features/connections/model/connections", () => ({
  loadRemoteSession: mocks.load, remoteSessionFor: (id: string) => mocks.bindings.get(id),
  rememberRemoteSession: mocks.remember, useRemoteMachines: () => ({ machines: [] }), REMOTE_HISTORY_CHANGE: "history",
}));
vi.mock("../../features/connections/model/remoteProjects", () => ({
  remoteProjectFor: (cwd: string) => cwd === "/repo" ? { key: "/repo", cwd: "/repo", local: true, projectId: "project", environmentId: "env" } : undefined,
  projectPath: (_project: unknown, path: string) => path,
}));
vi.mock("../../features/sessions/data/sharedSessionBackend", () => ({ sharedSessionBackend: () => undefined }));
vi.mock("../../features/connections/model/desktopAppCommands", () => ({ consumeDesktopAppCommands: vi.fn() }));
const machine = { id: "machine", environmentId: "env", name: "local", endpoint: "http://localhost" };
const command = (patch: Partial<DesktopAppCommand> = {}): DesktopAppCommand => ({
  id: "delivery", sourceSessionId: "host-source", sessionId: "host-target", projectId: "project", action: "sessions.reveal", reveal: true, ...patch,
});
function fixture() {
  const source = { ...newSession("codex", "/repo"), id: "source" };
  const sessionsRef = { current: [source] }; const tabsRef = { current: [newTab(source.id)] };
  const setSessions = vi.fn(); const setTabs = vi.fn(); const appendTab = vi.fn(); const revealTab = vi.fn();
  return { sessionsRef, tabsRef, setSessions, setTabs, appendTab, revealTab };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.bindings.clear(); mocks.bindings.set("source", "host-source");
  mocks.remember.mockImplementation((shellId: string, hostId: string) => mocks.bindings.set(shellId, hostId));
  mocks.load.mockResolvedValue({ projectId: "project", session: { ...newSession("codex", "/repo"), id: "host-target", blocks: [{ id: "accepted", role: "user", text: "already accepted on Host" }] } });
});
it("opens a Host-created session without submitting another turn", async () => {
  const options = fixture();
  const result = await revealHostSession(machine, command(), options);
  expect(mocks.load).toHaveBeenCalledExactlyOnceWith("machine", "host-target");
  expect(options.appendTab).toHaveBeenCalledTimes(1); expect(options.revealTab).toHaveBeenCalledWith(result.tabId, "/repo");
  expect(options.sessionsRef.current[1].blocks[0].text).toBe("already accepted on Host");
});
it("deduplicates replayed placement even before React commits the first tab", async () => {
  const options = fixture();
  const first = await revealHostSession(machine, command(), options);
  const second = await revealHostSession(machine, command(), options);
  expect(second).toEqual(first); expect(options.appendTab).toHaveBeenCalledTimes(1);
  expect(options.sessionsRef.current).toHaveLength(2);
});
it("splits beside the source using Host IDs and keeps focus when reveal is false", async () => {
  const options = fixture(); const originalTab = options.tabsRef.current[0];
  await revealHostSession(machine, command({ reveal: false, placement: { direction: "down", besideSessionId: "host-source" } }), options);
  expect(leafIds(options.tabsRef.current[0].layout)).toEqual(["source", "host-target"]);
  expect(options.tabsRef.current[0].focusedId).toBe(originalTab.focusedId);
  expect(options.revealTab).not.toHaveBeenCalled(); expect(options.appendTab).not.toHaveBeenCalled();
});
it("rejects another Host project's session before altering the workspace", async () => {
  const options = fixture(); mocks.load.mockResolvedValue({ projectId: "other", session: { id: "host-target" } });
  await expect(revealHostSession(machine, command(), options)).rejects.toThrow("not attached");
  expect(options.setSessions).not.toHaveBeenCalled(); expect(options.appendTab).not.toHaveBeenCalled();
});
it("does not resurrect a workspace after its pending session load finishes", async () => {
  const options = fixture();
  await expect(revealHostSession(machine, command(), options, () => false)).rejects.toThrow("closed");
  expect(options.setSessions).not.toHaveBeenCalled(); expect(mocks.remember).not.toHaveBeenCalled();
});
