// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

const { remoteRequest, remoteMachineFor, invokeLocal } = vi.hoisted(() => ({
  remoteRequest: vi.fn(),
  invokeLocal: vi.fn(),
  remoteMachineFor: vi.fn(async (environmentId: string) =>
    environmentId === "env"
      ? { id: "machine", name: "Home", endpoint: "", environmentId }
      : undefined,
  ),
}));
vi.mock("./connections", () => ({ remoteRequest, remoteMachineFor }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeLocal }));

import { runRemoteCommand } from "./remoteCommands";
import { parseRemotePath, remotePath, configureSharedHost } from "./remoteProjects";
import { listDir, readBinaryFile, readTextFile, statFiles, writeTextFile } from "../../../platform/tauri/fs";
import { rememberProject } from "../../projects/model/recents";
import { inspectAttachmentPaths, readAttachmentBase64 } from "../../../platform/tauri/attachmentFiles";
import { HOST_PROTOCOL_VERSION } from "../../../contracts/protocol";

beforeEach(() => {
  remoteRequest.mockReset();
  invokeLocal.mockReset();
  configureSharedHost(undefined, []);
  localStorage.clear();
});

it("routes WSL files through the desktop Host with explicit distribution and never native Windows IO", async () => {
  configureSharedHost("env", [], "machine");
  remoteRequest.mockResolvedValue([{ path: "/home/dev/repo/a.txt", mtimeMs: 1 }]);
  expect(await statFiles(["wsl://Ubuntu/home/dev/repo/a.txt"])).toEqual([
    { path: "wsl://Ubuntu/home/dev/repo/a.txt", mtimeMs: 1 },
  ]);
  expect(remoteRequest).toHaveBeenCalledWith("machine", "workspace.run", {
    command: "stat_files", args: { paths: ["/home/dev/repo/a.txt"] }, machine: { kind: "wsl", distribution: "Ubuntu" },
  });
  expect(invokeLocal).not.toHaveBeenCalled();
});

it("rejects copies between WSL distributions or WSL and the Windows host", async () => {
  configureSharedHost("env", [], "machine");
  for (const destParent of ["wsl://Debian/home/dev", "remote://env/C:/work"])
    await expect(runRemoteCommand("copy_path", { from: "wsl://Ubuntu/home/dev/a", destParent })).rejects.toThrow("one machine");
  expect(remoteRequest).not.toHaveBeenCalled();
});

it("keeps local writes local when their content mentions a remote path", async () => {
  await writeTextFile("/home/me/note.txt", "remote://env/home/me/repo");
  expect(invokeLocal).toHaveBeenCalledWith("write_text_file", {
    path: "/home/me/note.txt",
    content: "remote://env/home/me/repo",
  });
  expect(remoteRequest).not.toHaveBeenCalled();
});

it("routes registered local project reads and writes to Host while app data stays native", async () => {
  configureSharedHost("env", [{ id: "project", cwd: "/home/me/repo", name: "repo" }], "machine");
  remoteRequest.mockResolvedValue("content");
  expect(await readTextFile("/home/me/repo/file.txt")).toBe("content");
  await writeTextFile("/home/me/repo/file.txt", "changed");
  expect(remoteRequest).toHaveBeenLastCalledWith("machine", "workspace.run", {
    command: "write_text_file", args: { path: "/home/me/repo/file.txt", content: "changed" },
  });
  expect(invokeLocal).not.toHaveBeenCalled();
  await readTextFile("/home/me/app-data/settings.json");
  expect(invokeLocal).toHaveBeenCalledWith("read_text_file", { path: "/home/me/app-data/settings.json" });
});

it("does not fall back to native file writes when the project Host is unavailable", async () => {
  configureSharedHost("env", [{ id: "project", cwd: "/home/me/repo", name: "repo" }], "machine");
  remoteRequest.mockRejectedValue(new Error("Host unavailable"));
  await expect(writeTextFile("/home/me/repo/file.txt", "changed")).rejects.toThrow("Host unavailable");
  expect(invokeLocal).not.toHaveBeenCalled();
});

it("keeps remembered project files Host-owned before the startup handshake", async () => {
  rememberProject("/home/me/repo");
  await expect(writeTextFile("/home/me/repo/file.txt", "changed")).rejects.toThrow("not connected");
  expect(invokeLocal).not.toHaveBeenCalled();
});

it("registers a remembered project before its first file operation", async () => {
  rememberProject("/home/me/repo");
  configureSharedHost("env", [], "machine");
  remoteRequest.mockImplementation(async (_machine, method) => method === "projects.open"
    ? { id: "project", cwd: "/home/me/repo", name: "repo" } : "content");
  expect(await readTextFile("/home/me/repo/file.txt")).toBe("content");
  expect(remoteRequest.mock.calls.map(call => call[1])).toEqual(["projects.open", "workspace.run"]);
  expect(invokeLocal).not.toHaveBeenCalled();
});

it("runs the same file command on the machine with host paths", async () => {
  remoteRequest.mockResolvedValue([
    { name: "src", path: "/home/me/repo/src", isDir: true, ignored: false },
  ]);
  expect(await listDir("remote://env/home/me/repo")).toEqual([
    {
      name: "src",
      path: "remote://env/home/me/repo/src",
      isDir: true,
      ignored: false,
    },
  ]);
  expect(remoteRequest).toHaveBeenCalledWith("machine", "workspace.run", {
    command: "list_dir",
    args: { path: "/home/me/repo" },
  });
});

it("maps path results back and leaves file contents alone", async () => {
  remoteRequest.mockResolvedValueOnce("remote://not-a-path");
  expect(await readTextFile("remote://env/home/me/a.txt")).toBe(
    "remote://not-a-path",
  );
  remoteRequest.mockResolvedValueOnce([
    { path: "/home/me/a.txt", mtimeMs: 1 },
  ]);
  expect(await statFiles(["remote://env/home/me/a.txt"])).toEqual([
    { path: "remote://env/home/me/a.txt", mtimeMs: 1 },
  ]);
  remoteRequest.mockResolvedValueOnce("/home/me/b.txt");
  expect(
    await runRemoteCommand("rename_path", {
      path: "remote://env/home/me/a.txt",
      name: "b.txt",
    }),
  ).toBe("remote://env/home/me/b.txt");
  remoteRequest.mockResolvedValueOnce("C:/work/x.ts");
  expect(
    await runRemoteCommand("create_path", {
      parent: "remote://env/C:/work",
      name: "x.ts",
      isDir: false,
    }),
  ).toBe("remote://env/C:/work/x.ts");
  expect(remoteRequest).toHaveBeenLastCalledWith("machine", "workspace.run", {
    command: "create_path",
    args: { parent: "C:/work", name: "x.ts", isDir: false },
  });
});

it("decodes remote binary reads", async () => {
  remoteRequest.mockResolvedValueOnce("AAEC/w==");
  expect(await readBinaryFile("remote://env/home/me/image.png")).toEqual(
    new Uint8Array([0, 1, 2, 255]),
  );
});

it("preserves Windows drive and UNC paths", () => {
  expect(parseRemotePath(remotePath("env", "C:\\work\\repo"))?.hostPath).toBe(
    "C:/work/repo",
  );
  expect(parseRemotePath(remotePath("env", "\\\\server\\share\\repo"))?.hostPath).toBe(
    "//server/share/repo",
  );
});

it("adds remote paths to Git index entries", async () => {
  remoteRequest.mockResolvedValueOnce({
    branch: "main",
    files: [{ path: "src/app.ts", relative: "src/app.ts", status: "modified" }],
  });
  const index = await runRemoteCommand("git_diff_index", {
    cwd: "remote://env/home/me/repo",
  }) as { files: { path: string }[] };
  expect(index.files[0].path).toBe("remote://env/home/me/repo/src/app.ts");
});

it("routes project search through the host and maps match paths", async () => {
  remoteRequest.mockResolvedValueOnce({
    matches: [{ path: "/home/me/repo/src/app.ts", relative: "src/app.ts", line: 4 }],
    truncated: false,
  });
  expect(await runRemoteCommand("search_project", {
    options: { cwd: "remote://env/home/me/repo", query: "hello" },
  })).toMatchObject({
    matches: [{ path: "remote://env/home/me/repo/src/app.ts", line: 4 }],
  });
  expect(remoteRequest).toHaveBeenCalledWith("machine", "workspace.run", {
    command: "search_project",
    args: { options: { cwd: "/home/me/repo", query: "hello" } },
  });
});

it("refuses what the host cannot do and explains outdated hosts", async () => {
  await expect(
    runRemoteCommand("reveal_path", { path: "remote://env/home/me/a" }),
  ).rejects.toThrow("isn’t available for projects on another machine");
  await expect(
    runRemoteCommand("copy_path", {
      from: "/Users/me/local.txt",
      destParent: "remote://env/home/me",
    }),
  ).rejects.toThrow("within one machine");
  await expect(
    runRemoteCommand("move_path", {
      from: "remote://env/home/me/a",
      destParent: "remote://other/home/me",
    }),
  ).rejects.toThrow("within one machine");
  await expect(
    runRemoteCommand("list_dir", { path: "remote://gone/home/me" }),
  ).rejects.toThrow("isn’t connected");
  remoteRequest.mockRejectedValueOnce("Unsupported remote operation");
  await expect(
    runRemoteCommand("list_dir", { path: "remote://env/home/me" }),
  ).rejects.toThrow("Update OmniCode Host");
  expect(remoteRequest).toHaveBeenCalledTimes(1);
});

it("keeps mixed picked and project attachment paths on their respective owners and reads Host chunks", async () => {
  configureSharedHost("env", [{ id: "project", cwd: "/home/me/repo", name: "repo" }], "machine");
  remoteRequest.mockImplementation(async (_machine, method, params) => {
    if (method === "environment.describe") return { protocolVersion: HOST_PROTOCOL_VERSION, environmentId: "env", name: "Host", providers: ["codex"], capabilities: ["workspace.attachments.v1"] };
    if (method === "workspace.run" && params.command === "inspect_paths") return params.args.paths.map((path: string) => ({ path, name: "image.png", size: 5, isDir: false }));
    if (method === "workspace.run" && params.command === "read_file_base64") return { transfer: "snapshot", size: 5 };
    if (method === "workspace.run" && params.command === "read_attachment_chunk") return params.args.offset === 0
      ? { data: "YWJj", offset: 3, size: 5 } : { data: "ZGU=", offset: 5, size: 5 };
    throw new Error(`Unexpected ${method}`);
  });
  invokeLocal.mockImplementation(async (command, args) => command === "inspect_paths"
    ? args.paths.map((path: string) => ({ path, name: "picked.png", size: 5, isDir: false })) : "bG9jYWw=");
  const paths = ["/home/me/repo/image.png", "/Downloads/picked.png", "remote://env/other/image.png"];
  expect((await inspectAttachmentPaths(paths)).map(entry => entry.path)).toEqual(paths);
  expect(invokeLocal).toHaveBeenCalledExactlyOnceWith("inspect_paths", { paths: ["/Downloads/picked.png"] });
  expect(await readAttachmentBase64("/home/me/repo/image.png")).toBe("YWJjZGU=");
  expect(invokeLocal).not.toHaveBeenCalledWith("read_file_base64", expect.anything());
  expect(await readAttachmentBase64("/Downloads/picked.png")).toBe("bG9jYWw=");
  expect(remoteRequest.mock.calls.filter(call => call[1] === "workspace.run").every(call => !JSON.stringify(call[2]).includes("/Downloads/"))).toBe(true);
});

it("rejects project attachment reads on an old Host without falling back to Rust", async () => {
  configureSharedHost("env", [{ id: "project", cwd: "/home/me/repo", name: "repo" }], "machine");
  remoteRequest.mockResolvedValue({ protocolVersion: HOST_PROTOCOL_VERSION, environmentId: "env", name: "Old Host", providers: ["codex"], capabilities: ["workspace.run"] });
  await expect(readAttachmentBase64("/home/me/repo/image.png")).rejects.toThrow("Update OmniCode Host");
  expect(invokeLocal).not.toHaveBeenCalled();
  expect(remoteRequest.mock.calls.map(call => call[1])).toEqual(["environment.describe"]);
});
