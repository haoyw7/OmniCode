// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import type { ProjectList } from "./ProjectList";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import type { RemoteProjectSessions } from "../../features/connections/model/connections";
import { REMOTE_HISTORY_UPDATED } from "../../features/connections/model/connections";

const captured = vi.hoisted(() => ({
  projectList: undefined as ComponentProps<typeof ProjectList> | undefined,
  remote: new Map<string, Omit<RemoteProjectSessions, "machine">>(),
  bindings: new Map<string, string>(),
}));
vi.mock("./ProjectList", () => ({
  ProjectList: (props: ComponentProps<typeof ProjectList>) => {
    captured.projectList = props;
    return null;
  },
  AddProjectButton: () => null,
}));
vi.mock("./ProjectSessionSection", () => ({
  ProjectSessionSection: () => null,
}));
vi.mock("../../features/source-control/ui/SidebarWorktreeSwitcher", () => ({
  SidebarWorktreeSwitcher: () => null,
}));
vi.mock("../../features/source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: () => null,
}));
vi.mock("../../features/source-control/hooks/useGitFileStatuses", () => ({
  useGitFileStatuses: () => ({ files: new Map(), dirs: new Map() }),
}));
vi.mock(
  "../../features/connections/model/connections",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../features/connections/model/connections")
    >()),
    remoteSessionFor: (id: string) => captured.bindings.get(id),
    remoteSessionResolver: () => (id: string) => captured.bindings.get(id),
    cachedRemoteSessions: (path: string) =>
      captured.remote.get(path)?.sessions ?? [],
    hasCachedRemoteProjectSessions: (path: string) =>
      captured.remote.get(path)?.loaded ?? false,
    cachedRemoteProjectSessionsState: (path: string) =>
      captured.remote.get(path) ?? {
        loaded: false,
        pending: false,
        offline: false,
      },
  }),
);

const A = "/projects/alpha";
const B = "/projects/beta";
const row = (id: string, cwd = A): SessionSummary => ({
  id,
  cwd,
  harness: "codex",
  model: "",
  runtimeMode: "supervised",
  title: id,
  createdAt: 1,
  updatedAt: 2,
});
let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof Sidebar>;
const render = () => root.render(createElement(Sidebar, props));
const summary = (path: string) =>
  captured.projectList!.projectSummaries!.get(path)!;
const hover = (path: string) => captured.projectList!.onProjectHoverOpen!(path);
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  captured.projectList = undefined;
  captured.remote.clear();
  captured.bindings.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    cwd: A,
    open: true,
    recents: [
      { path: A, openedAt: 2 },
      { path: B, openedAt: 1 },
    ],
    sessions: [row("a")],
    projectHistory: [row("a")],
    loadedProjectPaths: new Set([A]),
    failedProjectPaths: new Set(),
    busySessionIds: new Set(),
    approvalSessionIds: new Set(),
    status: "idle",
    pending: false,
    tab: "sessions",
    filesSearchOpen: false,
    onSelectSession: vi.fn(),
    onOpenFile: vi.fn(),
    onTabChange: vi.fn(),
    onFilesSearchOpenChange: vi.fn(),
  };
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("passes counts for all main conversations without using the tree's five-row preview", () => {
  props.projectHistory = [
    ...Array.from({ length: 9 }, (_, index) => row(`history-${index}`)),
    { ...row("archived"), archived: true },
    { ...row("worker"), orchestrationLeadId: "history-0" },
    row("beta", B),
  ];
  props.openSessions = [row("history-0"), row("blank"), row("retained-closed")];
  props.openSessionIds = new Set(["history-0", "blank"]);
  props.unseenFinishedIds = new Set([
    "history-8",
    "beta",
    "worker",
    "archived",
  ]);
  act(() => render());
  expect(summary(A)).toEqual({
    total: 10,
    unread: 1,
    opened: 2,
    historyState: "ready",
    canRetry: false,
  });
  expect(summary(B)).toBeUndefined();
  expect(captured.projectList!.onProjectHoverOpen).toBeUndefined();
});

it("keeps the session tree while separating projectless chats from local and remote Code projects", () => {
  const chat = "/home/me/Documents/ohmymonocode/2026-10-13/chat-120000-abcdef";
  const remote = "remote://machine/projects/remote";
  props.recents = [...props.recents!, { path: remote, openedAt: 3 }];
  props.projectHistory = [row("local", A), row("remote", remote), row("chat", chat), row("draft", "~")];
  props.desktopMode = "chat";
  props.tab = "files";
  act(() => render());
  expect(container.querySelector('[data-desktop-sidebar="chat"]')).not.toBeNull();
  expect(captured.projectList!.visibleProjectPaths?.size).toBe(0);
  expect(captured.projectList!.showProjectSections).toBe(false);
  expect(captured.projectList!.chatEntries?.map(({ id }) => id)).toEqual(expect.arrayContaining([`${chat}:chat`, "~:draft"]));
  expect(container.querySelector('[role="tablist"]')).toBeNull();

  props.desktopMode = "code";
  act(() => render());
  expect(captured.projectList!.visibleProjectPaths).toEqual(new Set([A, B, remote]));
  expect(captured.projectList!.showProjectSections).toBe(true);
  expect(captured.projectList!.chatEntries).toBeUndefined();
  expect(props.recents).toHaveLength(3);
});

it("loads a collapsed local project once per in-flight hover and recognizes successful empty", async () => {
  const request = deferred();
  props.onLoadProject = vi.fn(() => request.promise);
  act(() => render());
  await act(async () => {
    hover(B);
    hover(B);
  });
  expect(props.onLoadProject).toHaveBeenCalledTimes(1);
  expect(summary(B)).toMatchObject({
    total: undefined,
    historyState: "loading",
  });
  props.loadedProjectPaths = new Set([A, B]);
  await act(async () => {
    render();
    request.resolve();
  });
  expect(summary(B)).toEqual({
    total: 0,
    unread: 0,
    opened: 0,
    historyState: "ready",
  });
  await act(async () => hover(B));
  expect(props.onLoadProject).toHaveBeenCalledTimes(1);
});

it("retains known counts without retry and omits unknown entries for a backend without a loader", () => {
  const remote = "remote://machine/projects/no-loader";
  props.recents = [
    { path: A, openedAt: 3 },
    { path: B, openedAt: 2 },
    { path: remote, openedAt: 1 },
  ];
  props.onLoadProject = vi.fn(async () => {});
  act(() => render());
  expect(summary(B)).toMatchObject({ total: undefined, historyState: "idle" });
  expect(summary(remote)).toBeUndefined();

  captured.remote.set(remote, {
    sessions: [],
    loaded: true,
    pending: false,
    offline: true,
  });
  act(() => window.dispatchEvent(new Event(REMOTE_HISTORY_UPDATED)));
  expect(summary(remote)).toMatchObject({
    total: 0,
    historyState: "error",
    cached: true,
    canRetry: false,
  });
  expect(captured.projectList!.onProjectHoverOpen).toBeDefined();

  props.onLoadProject = undefined;
  act(() => render());
  expect(summary(A)).toMatchObject({
    total: 1,
    historyState: "ready",
    canRetry: false,
  });
  expect(summary(B)).toBeUndefined();
  expect(captured.projectList!.onProjectHoverOpen).toBeUndefined();
});

it("uses project-local failure props even when the existing loader resolves after failure", async () => {
  props.onLoadProject = vi.fn(async () => {
    props.failedProjectPaths = new Set([B]);
    render();
  });
  act(() => render());
  await act(async () => hover(B));
  expect(summary(B)).toMatchObject({ total: undefined, historyState: "error" });
  props.loadedProjectPaths = new Set([A, B]);
  props.projectHistory = [row("cached-beta", B)];
  act(() => render());
  expect(summary(B)).toMatchObject({
    total: 1,
    historyState: "error",
    cached: true,
  });
  expect(summary(A)).toMatchObject({ historyState: "ready" });
});

it("keeps remote cache on failure and isolates equal Host ids and completion flags by project", async () => {
  const remoteA = "remote://machine/projects/alpha";
  const remoteB = "remote://machine/projects/beta";
  const remoteRow = {
    id: "same-id",
    title: "Remote",
    harness: "codex" as const,
    updatedAt: 1,
    projectId: "project",
    revision: 1,
    status: "idle" as const,
  };
  captured.remote.set(remoteA, {
    sessions: [remoteRow],
    loaded: true,
    pending: false,
    offline: false,
  });
  captured.remote.set(remoteB, {
    sessions: [remoteRow],
    loaded: true,
    pending: false,
    offline: false,
  });
  captured.bindings.set("shell-a", "same-id");
  captured.bindings.set("shell-b", "same-id");
  props = {
    ...props,
    cwd: remoteA,
    recents: [
      { path: remoteA, openedAt: 2 },
      { path: remoteB, openedAt: 1 },
    ],
    projectHistory: [row("shell-a", remoteA), row("shell-b", remoteB)],
    openSessions: [row("shell-a", remoteA), row("shell-b", remoteB)],
    openSessionIds: new Set(["shell-a"]),
    unseenFinishedIds: new Set(["shell-a"]),
  };
  const request = deferred();
  props.onPrefetchRemoteProject = vi.fn(() => request.promise);
  act(() => render());
  expect(summary(remoteA)).toMatchObject({ total: 1, unread: 1, opened: 1 });
  expect(summary(remoteB)).toMatchObject({ total: 1, unread: 0, opened: 0 });
  await act(async () => {
    hover(remoteA);
    hover(remoteA);
  });
  expect(props.onPrefetchRemoteProject).toHaveBeenCalledTimes(1);
  expect(summary(remoteA)).toMatchObject({
    total: 1,
    historyState: "loading",
    cached: true,
  });
  captured.remote.get(remoteA)!.offline = true;
  await act(async () => request.reject(new Error("Offline")));
  expect(summary(remoteA)).toMatchObject({
    total: 1,
    historyState: "error",
    cached: true,
  });
  expect(summary(remoteB)).toMatchObject({ historyState: "ready" });
  captured.remote.get(remoteA)!.offline = false;
  act(() => window.dispatchEvent(new Event(REMOTE_HISTORY_UPDATED)));
  expect(summary(remoteA)).toMatchObject({ total: 1, historyState: "ready" });
  expect(summary(remoteA).cached).toBeUndefined();
});
