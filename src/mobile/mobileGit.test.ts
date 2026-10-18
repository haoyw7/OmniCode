import { expect, it, vi } from "vitest";
import type { MobileClient } from "./client";
import { createMobileGitSource } from "./mobileGit";

function client() {
  return {
    connection: {
      endpoint: "https://host.test",
      environmentId: "host",
      name: "Computer",
      token: "test",
    },
    hasCapability: vi.fn<MobileClient["hasCapability"]>(() => true),
    rpc: vi.fn<MobileClient["rpc"]>(),
  };
}

it("binds Git reads to the selected worktree and combines HEAD with disk for partial staging", async () => {
  const host = client();
  host.rpc.mockResolvedValueOnce({ files: [] });
  host.rpc.mockResolvedValueOnce({
    original: "HEAD",
    current: "INDEX",
    binary: false,
    tooLarge: false,
  });
  host.rpc.mockResolvedValueOnce({
    original: "INDEX",
    current: "DISK",
    binary: false,
    tooLarge: false,
  });
  const source = createMobileGitSource(
    host,
    "project",
    "/repo/worktrees/session",
  )!;
  await source.loadIndex();
  expect(await source.loadDiff("src/file name.ts")).toMatchObject({
    original: "HEAD",
    current: "DISK",
  });
  expect(host.rpc.mock.calls).toEqual([
    ["git.index", { projectId: "project", cwd: "/repo/worktrees/session" }],
    [
      "git.fileDiff",
      {
        projectId: "project",
        cwd: "/repo/worktrees/session",
        path: "src/file name.ts",
        staged: true,
      },
    ],
    [
      "git.fileDiff",
      {
        projectId: "project",
        cwd: "/repo/worktrees/session",
        path: "src/file name.ts",
        staged: false,
      },
    ],
  ]);
});

it("omits review on older Hosts without both Git read capabilities", () => {
  const host = client();
  host.hasCapability.mockImplementation((name) => name === "git.index");
  expect(createMobileGitSource(host, "project", "/repo")).toBeUndefined();
  expect(host.rpc).not.toHaveBeenCalled();
});

it("discards an old Host's late response and refuses further requests through its bound source", async () => {
  const host = client();
  let finish!: (value: unknown) => void;
  host.rpc.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const source = createMobileGitSource(host, "project", "/repo")!;
  const pending = source.loadIndex();
  const rejected = expect(pending).rejects.toThrow("Host connection changed.");
  host.connection = { ...host.connection, environmentId: "new-host" };
  finish({});
  await rejected;
  await expect(source.loadDiff("old.txt")).rejects.toThrow(
    "Host connection changed.",
  );
  expect(host.rpc).toHaveBeenCalledTimes(1);
});

it.each(["binary", "tooLarge"] as const)(
  "preserves the %s guard from either side",
  async (flag) => {
    const host = client();
    host.rpc.mockResolvedValueOnce({
      original: "",
      current: "",
      binary: false,
      tooLarge: false,
      [flag]: true,
    });
    host.rpc.mockResolvedValueOnce({
      original: "",
      current: "text",
      binary: false,
      tooLarge: false,
    });
    expect(
      await createMobileGitSource(host, "project", "/repo")!.loadDiff("file"),
    ).toHaveProperty(flag, true);
  },
);
