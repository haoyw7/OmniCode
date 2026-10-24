// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { remotePath, remoteProjectFor, remoteSessionGitCwd, configureSharedHost, sharedProjects, sessionUsesHost, rememberProjectMove } from "./remoteProjects";

it("keeps nested Host project IDs while rebasing the local project cache", () => {
  configureSharedHost("env", [{ id: "root", cwd: "/old", name: "old" }, { id: "child", cwd: "/old/nested", name: "nested" }]);
  rememberProjectMove(remoteProjectFor("/old")!, { id: "root", cwd: "/new", name: "new" });
  expect(remoteProjectFor("/new")?.projectId).toBe("root");
  expect(remoteProjectFor("/new/nested")?.projectId).toBe("child");
  expect(sharedProjects().some(project => project.cwd.startsWith("/old"))).toBe(false);
  configureSharedHost(undefined, []);
});

it("keeps project ownership on the Host before startup and after disconnect", () => {
  for (const environment of [undefined, "desktop", undefined]) {
    configureSharedHost(environment, []);
    for (const cwd of ["/repo", "C:\\repo", "wsl://Ubuntu/home/dev/repo", "remote://unknown/repo"])
      expect(sessionUsesHost({ cwd })).toBe(true);
    expect(sessionUsesHost({ cwd: "~" })).toBe(false);
    expect(sessionUsesHost({ cwd: "" })).toBe(false);
    expect(sessionUsesHost({ cwd: "/repo", inboxAsk: {
      key: "github:issue", title: "Issue", url: "https://example.com/issue", provider: "github",
    } })).toBe(true);
  }
});

it("keeps equal Linux paths in different distributions distinct under the shared Host", () => {
  configureSharedHost("desktop", [
    { id: "ubuntu", name: "repo", cwd: "/home/dev/repo", machine: { kind: "wsl", distribution: "Ubuntu" } },
    { id: "debian", name: "repo", cwd: "/home/dev/repo", machine: { kind: "wsl", distribution: "Debian" } },
  ]);
  try {
    expect(sharedProjects()).toHaveLength(2);
    expect(remoteProjectFor("wsl://Ubuntu/home/dev/repo")).toMatchObject({ projectId: "ubuntu", local: true });
    expect(remoteProjectFor("wsl://Debian/home/dev/repo")).toMatchObject({ projectId: "debian", local: true });
    const project = remoteProjectFor("wsl://Ubuntu/home/dev/repo")!;
    expect(remoteSessionGitCwd(project, "/home/dev/worktree", project.cwd)).toBe("wsl://Ubuntu/home/dev/worktree");
  } finally { configureSharedHost(undefined, []); }
});

it("finds a saved UNC project through its corrected remote path", () => {
  const legacyKey = "remote://env/server/share/repo";
  const project = {
    key: legacyKey,
    environmentId: "env",
    projectId: "project",
    cwd: "\\\\server\\share\\repo",
  };
  localStorage.setItem("omnicode.remote-projects.v2", JSON.stringify({ [legacyKey]: project }));
  expect(remoteProjectFor(remotePath("env", project.cwd))).toEqual(project);
  localStorage.removeItem("omnicode.remote-projects.v2");
});

const gitProject = { environmentId: "env", cwd: "/home/dev/repo" };

it("diffs a linked worktree in the worktree, not the project root", () => {
  expect(
    remoteSessionGitCwd(gitProject, "/home/dev/repo/.omnicode/worktrees/fix", "/home/dev/repo"),
  ).toBe(remotePath("env", "/home/dev/repo/.omnicode/worktrees/fix"));
});

it("keeps the project root when the session has no separate work path", () => {
  expect(remoteSessionGitCwd(gitProject, "/home/dev/repo", "/home/dev/repo")).toBe(
    remotePath("env", "/home/dev/repo"),
  );
  expect(remoteSessionGitCwd(gitProject, undefined, "/home/dev/repo")).toBe(
    remotePath("env", "/home/dev/repo"),
  );
});

it("passes an already-remote session work path through untouched", () => {
  const wrapped = remotePath("env", "/home/dev/repo/.omnicode/worktrees/fix");
  expect(remoteSessionGitCwd(gitProject, wrapped, "/home/dev/repo")).toBe(wrapped);
});


it("keeps native Git paths for a shared Host on this machine", () => {
  const project = { ...gitProject, local: true };
  expect(remoteSessionGitCwd(project, "/home/dev/worktree", project.cwd)).toBe(
    "/home/dev/worktree",
  );
  expect(remoteSessionGitCwd(project, undefined, project.cwd)).toBe(project.cwd);
});

it("diffs the worktree a remote tab picked before its session starts", () => {
  // A pending worktree pick is stored as a host path while the git cwd still
  // sits on the `remote://` project root; the sidebar's Changes panel lists
  // the pick, so the diff must run in it too.
  const root = remotePath("env", "/home/dev/repo");
  expect(
    remoteSessionGitCwd(
      gitProject,
      root,
      root,
      "/home/dev/repo/.omnicode/worktrees/fix",
    ),
  ).toBe(remotePath("env", "/home/dev/repo/.omnicode/worktrees/fix"));
});

it("keeps the tab's session checkout ahead of a stray remote git cwd", () => {
  expect(
    remoteSessionGitCwd(
      gitProject,
      remotePath("env", "/home/dev/other"),
      remotePath("env", "/home/dev/repo"),
      "/home/dev/repo",
    ),
  ).toBe(remotePath("env", "/home/dev/repo"));
});

it("passes an already-remote tab checkout through untouched", () => {
  const wrapped = remotePath("env", "/home/dev/repo/.omnicode/worktrees/fix");
  expect(
    remoteSessionGitCwd(
      gitProject,
      remotePath("env", "/home/dev/repo"),
      remotePath("env", "/home/dev/repo"),
      wrapped,
    ),
  ).toBe(wrapped);
});
