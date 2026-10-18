// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { initializeSharedHost } from "./sharedHost";
import {
  remoteProjectFor,
  ensureSharedProject,
  configureSharedHost,
} from "./remoteProjects";
import {
  getSession,
  listSessionsByProject,
  setSessionArchived,
  shouldPersistSession,
  searchSessions,
  deleteSession,
  upsertSession,
} from "../../sessions/data/sessionStore";
import { setSharedSessionBackend, sharedSessionBackend } from "../../sessions/data/sharedSessionBackend";
import type { HostSession } from "./protocol";
import { remoteSessionFor, rememberRemoteSession } from "./connections";
import { isRetiredSession } from "../../sessions/model/retiredSessions";
import { sessionUsesHost } from "./remoteProjects";
import { loadRecents, projectRailItems, rememberProject, saveProjectRailOrder } from "../../projects/model/recents";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./remoteOutbox", () => ({
  OUTBOX_PREFIX: "monocode.remote-command.v1:",
  loadRemoteOutbox: vi.fn(async () => undefined),
  outboxKeys: () => [],
  outboxEntry: () => undefined,
  putOutboxEntry: vi.fn(async () => undefined),
  deleteOutboxEntries: vi.fn(async () => undefined),
}));
const machine = {
  id: "computer",
  environmentId: "local",
  name: "This computer",
  endpoint: "http://127.0.0.1:3774",
};
const project = { id: "project", cwd: "/home/me/repo", name: "repo" };
let value: HostSession;
let workspace: unknown;
beforeEach(() => {
  localStorage.clear();
  workspace = null;
  value = {
    projectId: project.id,
    revision: 1,
    status: "idle",
    createdAt: 10,
    updatedAt: 20,
    session: {
      id: "history",
      cwd: project.cwd,
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
      title: "Shared chat",
      blocks: [{ id: "user", role: "user", text: "Phone message" }],
    },
  };
  vi.mocked(invoke).mockImplementation(async (command, args: any) => {
    if (command === "shared_host_prepare")
      return {
        machine,
        projects: [project],
        sessions: [{ id: "history", cwd: project.cwd }],
      };
    if (command === "remote_machines") return [machine];
    if (command === "workspace_get_snapshot") return workspace;
    if (command === "session_delete") return;
    if (command === "session_upsert")
      return {
        id: args.session.id,
        cwd: args.session.cwd,
        title: args.session.title,
        harness: args.session.harness,
        createdAt: 1,
        updatedAt: 2,
      };
    if (command === "remote_request") {
      if (args.method === "nativeSources.import") return value;
      if (args.method === "sessions.delete") return { deleted: true };
      if (args.method === "projects.list") return [project];
      if (args.method === "sessions.sync") return { kind: "snapshot", value };
      if (args.method === "sessions.list")
        return [
          {
            id: "history",
            title: value.session.title,
            harness: "codex",
            model: "codex:test",
            runtimeMode: "supervised",
            updatedAt: 20,
          },
        ];
      if (args.method === "projects.open")
        return { ...project, id: "new-project", cwd: args.params.cwd };
      if (args.method === "sessions.update") {
        value.archived = args.params.archived;
        return {};
      }
    }
    throw new Error(`Unexpected local operation: ${command}`);
  });
});
afterEach(() => {
  setSharedSessionBackend();
  configureSharedHost(undefined, []);
});
it("restores a WSL session by project identity when distributions share a Linux cwd", async () => {
  const projects = ["Ubuntu", "Debian"].map((distribution) => ({ ...project, id: distribution, machine: { kind: "wsl" as const, distribution } }));
  value = { ...value, projectId: "Debian" };
  const implementation = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args: any) => {
    if (command === "shared_host_prepare") return { machine, projects, sessions: [{ id: "history", cwd: project.cwd, projectId: "Debian" }] };
    if (command === "remote_request" && args.method === "projects.list") return projects;
    return implementation(command, args);
  });
  await initializeSharedHost();
  const session = await getSession("history");
  expect(session?.cwd).toBe("wsl://Debian/home/me/repo");
  expect(remoteProjectFor(session!.cwd)?.projectId).toBe("Debian");
  expect((await listSessionsByProject("wsl://Ubuntu/home/me/repo"))[0].cwd).toBe("wsl://Ubuntu/home/me/repo");
});
it("routes desktop history, changes and search to the Host while retaining native paths", async () => {
  await initializeSharedHost();
  expect(remoteProjectFor(project.cwd)).toMatchObject({
    local: true,
    projectId: project.id,
    cwd: project.cwd,
  });
  expect((await listSessionsByProject(project.cwd))[0].id).toBe("history");
  const session = (await getSession("history"))!;
  expect(session.cwd).toBe(project.cwd);
  expect(session.blocks[0].text).toBe("Phone message");
  expect(shouldPersistSession(session)).toBe(false);
  await setSessionArchived("history", true);
  expect(value.archived).toBe(true);
  value.archived = false;
  expect(
    (await searchSessions({ query: "Phone", searchOwner: "desktop" })).hits[0]
      .blockId,
  ).toBe("user");
  expect(
    (await searchSessions({ query: "Phone", cwd: "~", searchOwner: "home" }))
      .hits[0].blockId,
  ).toBe("user");
});
it("registers a newly opened local folder on the same Host once", async () => {
  await initializeSharedHost();
  const [a, b] = await Promise.all([
    ensureSharedProject("/home/me/new"),
    ensureSharedProject("/home/me/new"),
  ]);
  expect(a).toEqual(b);
  expect(a).toMatchObject({
    local: true,
    cwd: "/home/me/new",
    environmentId: "local",
  });
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(
        ([cmd, args]: any) =>
          cmd === "remote_request" && args.method === "projects.open",
      ),
  ).toHaveLength(1);
});
it("deletes canonical history and clears legacy native references without removing recovery images", async () => {
  await initializeSharedHost();
  await deleteSession("history");
  expect(invoke).toHaveBeenCalledWith("remote_request", {
    machineId: machine.id,
    method: "sessions.delete",
    params: { projectId: project.id, sessionId: "history" },
  });
  expect(invoke).toHaveBeenCalledWith("session_delete", {
    sessionId: "history",
    imagePaths: [],
  });
});
it("rejects bootstrap failure instead of silently selecting a local runtime", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("Host unavailable"));
  await expect(initializeSharedHost()).rejects.toThrow("Host unavailable");
});
it("runs imported native conversations on the Host and never saves them on the desktop", async () => {
  await initializeSharedHost();
  const session = {
    ...value.session,
    nativeSession: {
      provider: "codex" as const,
      providerSessionId: "native",
      path: "/native/history.jsonl",
      revision: "1:1",
      blockIds: ["user"],
      createdAt: 1,
      updatedAt: 2,
    },
    providerSessionId: "native",
  };
  // The Host owns native history and execution; the desktop does not save it.
  expect(sessionUsesHost(session)).toBe(true);
  expect(shouldPersistSession(session)).toBe(false);
  expect(await upsertSession(session)).toBeNull();
});
it("removes deleted Host bindings before restoring a desktop workspace", async () => {
  localStorage.setItem(
    "monocode.remote-tabs.v2",
    JSON.stringify({ shell: "history", "unknown-shell": "history" }),
  );
  rememberRemoteSession("remote-shell", "history", { environmentId: "other-host", projectId: "other-project" });
  workspace = { sessions: [
    { id: "shell", cwd: project.cwd },
    { id: "remote-shell", cwd: "remote://other-host/home/me/repo" },
  ] };
  vi.mocked(invoke).mockResolvedValueOnce({
    machine,
    projects: [project],
    sessions: [{ id: "history", cwd: project.cwd, deleted: true }],
  });
  await initializeSharedHost();
  expect(remoteSessionFor("shell")).toBeUndefined();
  expect(remoteSessionFor("history")).toBeUndefined();
  expect(isRetiredSession("shell")).toBe(true);
  expect(remoteSessionFor("remote-shell")).toBe("history");
  expect(remoteSessionFor("unknown-shell")).toBe("history");
  expect(isRetiredSession("remote-shell")).toBe(false);
  vi.mocked(invoke).mockRejectedValue(
    new Error("Session not found on this machine"),
  );
  expect(await getSession("history")).toBeNull();
});

it("forgets bindings to sessions this Host dropped unless a workspace tab still uses them", async () => {
  const local = { environmentId: "local", projectId: "project" };
  rememberRemoteSession("dropped", "dropped", local);
  rememberRemoteSession("open", "dropped-open", local);
  rememberRemoteSession("elsewhere", "dropped", { environmentId: "other", projectId: "project" });
  workspace = { sessions: [{ id: "open", cwd: project.cwd }] };
  await initializeSharedHost();
  expect(remoteSessionFor("dropped")).toBeUndefined();
  expect(remoteSessionFor("open")).toBe("dropped-open");
  expect(remoteSessionFor("elsewhere")).toBe("dropped");
  expect(remoteSessionFor("history")).toBe("history");
  expect(isRetiredSession("dropped")).toBe(false);
});

it("retires scoped local aliases before hydration without requiring workspace evidence", async () => {
  rememberRemoteSession("local-alias", "history", { environmentId: "local", projectId: "project" });
  rememberRemoteSession("other-project-alias", "history", { environmentId: "local", projectId: "other-project" });
  vi.mocked(invoke).mockResolvedValueOnce({ machine, projects: [project], sessions: [], retiredSessionIds: ["history"] });
  await initializeSharedHost();
  expect(remoteSessionFor("local-alias")).toBeUndefined();
  expect(isRetiredSession("local-alias")).toBe(true);
  expect(remoteSessionFor("other-project-alias")).toBe("history");
  expect(isRetiredSession("other-project-alias")).toBe(false);
});

it("does not claim another Host or project's shell through an identical local wire ID", async () => {
  rememberRemoteSession("remote-alias", "history", { environmentId: "other", projectId: "project" });
  rememberRemoteSession("project-alias", "history", { environmentId: "local", projectId: "other-project" });
  rememberRemoteSession("local-alias", "history", { environmentId: "local", projectId: "project" });
  await initializeSharedHost();
  expect(sharedSessionBackend()?.ownsSession("remote-alias")).toBe(false);
  expect(sharedSessionBackend()?.ownsSession("project-alias")).toBe(false);
  expect(sharedSessionBackend()?.ownsSession("local-alias")).toBe(true);
});

it("reuses verified bootstrap metadata offline without deleting newer session bindings", async () => {
  await initializeSharedHost();
  rememberRemoteSession("newer-shell", "newer-session", { environmentId: "local", projectId: "project" });
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "shared_host_prepare") throw new Error("connection refused");
    return original(command, args);
  });
  configureSharedHost(undefined, []);
  await initializeSharedHost();
  expect(remoteProjectFor(project.cwd)?.environmentId).toBe("local");
  expect(remoteSessionFor("newer-shell")).toBe("newer-session");
  expect(sharedSessionBackend()?.ownsProject(project.cwd)).toBe(true);
});

it("never falls back to bootstrap cache after authentication rejection or native removal", async () => {
  await initializeSharedHost();
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "shared_host_prepare") throw new Error("Authentication failed");
    return original(command, args);
  });
  await expect(initializeSharedHost()).rejects.toThrow("Authentication failed");
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "shared_host_prepare") throw new Error("offline");
    if (command === "remote_machines") return [];
    return original(command, args);
  });
  await expect(initializeSharedHost()).rejects.toThrow("offline");
});

it("imports native history without promoting its project in the sidebar", async () => {
  await initializeSharedHost();
  rememberProject(project.cwd);
  rememberProject("/work/current");
  saveProjectRailOrder(["/work/current", project.cwd]);
  const previous = loadRecents();

  expect(await sharedSessionBackend()!.native!.import("native-source")).toBe("history");
  expect(loadRecents()).toEqual(previous);
  expect(projectRailItems(loadRecents(), "").map((row) => row.path)).toEqual([
    "/work/current", project.cwd,
  ]);
});

it("does not overwrite legacy project preferences during pre-settings bootstrap", async () => {
  const legacy = JSON.stringify([{ path: "/old-project", openedAt: 1 }]);
  localStorage.setItem("monocode.recentProjects", legacy);
  await initializeSharedHost();
  expect(localStorage.getItem("monocode.recentProjects")).toBe(legacy);
});
