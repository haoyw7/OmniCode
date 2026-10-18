// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { createProjectPreferenceCodec, projectPreferenceIdentity } from "./projectPreferenceCodec";
import { configureSharedHost, rememberRemoteProject } from "../../connections/model/remoteProjects";
import { rememberRemoteSession } from "../../connections/model/connections";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => {
  localStorage.clear();
  configureSharedHost("host-a", [{ id: "project-a", cwd: "/app", name: "App" }], "machine-a");
});

it("uses one project identity for local and remote path representations", () => {
  const codec = createProjectPreferenceCodec();
  const key = "monocode.projectProviderSettings.v1";
  const wire = codec.encode(key, { "/app": { defaultHarness: "codex" } });
  expect(wire).toEqual({ "@project:host-a:project-a": { defaultHarness: "codex" } });
  configureSharedHost("host-b", [], "machine-b");
  rememberRemoteProject("host-a", { id: "project-a", cwd: "/app", name: "App" });
  expect(codec.decode(key, wire)).toEqual({ "remote://host-a/app": { defaultHarness: "codex" } });
  expect(codec.encode(key, { "remote://host-a/app": { defaultHarness: "codex" } })).toEqual(wire);
});

it("preserves unknown remote entries when editing visible projects", () => {
  const codec = createProjectPreferenceCodec();
  const key = "monocode.projectRailOrder";
  const remote = projectPreferenceIdentity("other", "not-paired");
  expect(codec.decode(key, [remote, "@project:host-a:project-a"])).toEqual(["/app"]);
  expect(codec.encode(key, [])).toEqual([remote]);
  const mapKey = "monocode.providerAccountSelections.v1";
  codec.decode(mapKey, { [remote]: { codex: "work" }, "@project:host-a:project-a": { codex: "default" } });
  expect(codec.encode(mapKey, { "/app": { codex: "changed" } })).toEqual({
    [remote]: { codex: "work" }, "@project:host-a:project-a": { codex: "changed" },
  });
});

it("preserves recency metadata and does not send unregistered client paths", () => {
  const codec = createProjectPreferenceCodec();
  const key = "monocode.recentProjects";
  const wire = codec.encode(key, [{ path: "/app", openedAt: 42 }]);
  expect(wire).toEqual([{ path: "@project:host-a:project-a", openedAt: 42 }]);
  expect(codec.decode(key, wire)).toEqual([{ path: "/app", openedAt: 42 }]);
  expect(() => codec.encode(key, [{ path: "/private/unregistered", openedAt: 50 }])).toThrow("Open this project");
});

it("normalizes session aliases without rewriting user folder names", () => {
  const codec = createProjectPreferenceCodec();
  rememberRemoteSession("shell", "host-session", { environmentId: "host-a", projectId: "project-a" });
  expect(codec.encode("monocode.sessionFolders", { "/app": [{ name: "shell", sessionIds: ["shell"] }] }))
    .toEqual({ "@project:host-a:project-a": [{ name: "shell", sessionIds: ["host-session"] }] });
});


it("shares mixed pinned projects and sessions by Host identity without leaking local paths", () => {
  const codec = createProjectPreferenceCodec();
  const key = "monocode.sidebarPinnedOrder.v1";
  rememberRemoteSession("shell", "wire-session", { environmentId: "host-a", projectId: "project-a" });
  const wire = codec.encode(key, ["/app", 'session:["/app","shell"]']);
  expect(wire).toEqual(["@project:host-a:project-a", 'session:["@project:host-a:project-a","wire-session"]']);
  expect(JSON.stringify(wire)).not.toContain("/app");
  configureSharedHost("host-b", [], "machine-b");
  rememberRemoteProject("host-a", { id: "project-a", cwd: "/app", name: "App" });
  expect(codec.decode(key, wire)).toEqual(["remote://host-a/app", 'session:["remote://host-a/app","wire-session"]']);
  const hidden = 'session:["@project:missing:unpaired","other-session"]';
  expect(codec.decode(key, [...(wire as string[]), hidden])).toEqual(["remote://host-a/app", 'session:["remote://host-a/app","wire-session"]']);
  expect(codec.encode(key, [])).toEqual([hidden]);
  expect(() => codec.encode(key, ['session:["/private/unregistered","draft"]'])).toThrow("Open this project");
});
