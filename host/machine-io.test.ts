import { expect, it } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertMachinePath, currentMachineIO, localMachineIO, machineFs, machinePath,
  withMachineIO, WslMachineIO, type MachineTransport,
} from "./machine-io";
import { checkoutPath } from "./checkout-guards";
import { hostBranches, createHostBranch } from "./git-branches";
import { createHostWorktree, hostWorktrees, hostWorktreeAt, resolveHostWorktree, withValidatedHostWorktree } from "./git-worktrees";
import { createHostPath, hostFileDiff, hostGitIndex, listHostFiles, readHostFile, writeHostFile } from "./workspace";
import { SessionCheckpoints } from "./session-checkpoints";
import { WslConnection } from "./machines/wsl";
import { HostStore } from "./store";
import { WorkspaceCommands } from "./workspace-commands";
import { discoverHostSkills, HostSkills } from "./skills";
import { HostOrchestrationWorkspace } from "./orchestration-workspace";
import type { OrchestrationRun, OrchestrationTask } from "../src/features/orchestration/model/orchestrationState";
import type { HostProvider } from "./providers";
import { evalSnippet } from "./workflows/compile";
import { listSavedWorkflows, saveSavedWorkflow } from "./workflows/saved/store";

const unusedTransport: MachineTransport = { request: async () => { throw new Error("Unexpected remote call"); } };

it("rejects foreign path syntax and WSL UNC paths before touching a filesystem", () => {
  expect(() => assertMachinePath("/home/wy/project", { key: "local", pathStyle: "win32" })).toThrow("Invalid win32 path");
  expect(() => assertMachinePath("C:\\project", { key: "wsl:Ubuntu", pathStyle: "posix" })).toThrow("Invalid posix path");
  expect(() => assertMachinePath("\\\\wsl.localhost\\Ubuntu\\home\\wy", { key: "local", pathStyle: "win32" })).toThrow();
  expect(() => assertMachinePath("//wsl$/Ubuntu/home/wy", { key: "local", pathStyle: "posix" })).toThrow();
  withMachineIO(new WslMachineIO("Ubuntu", unusedTransport), () => {
    expect(machinePath.resolve("/project", "src/../file")).toBe("/project/file");
    expect(() => machinePath.resolve("/project", "D:\\other")).toThrow();
  });
});

it("keeps simultaneous machines and identical workspace lease paths isolated", async () => {
  const ubuntu = new WslMachineIO("Ubuntu", unusedTransport);
  const debian = new WslMachineIO("Debian", unusedTransport);
  const keys = await Promise.all([ubuntu, debian].map((io) => withMachineIO(io, async () => {
    await new Promise((done) => setTimeout(done, 2));
    expect(currentMachineIO()).toBe(io);
    return checkoutPath("/home/wy/project");
  })));
  expect(keys[0]).not.toBe(keys[1]);
  expect(currentMachineIO()).toBe(localMachineIO);
});

it("preserves binary bytes and process error details across the execution protocol", async () => {
  const requests: Array<{ op: string; params: Record<string, unknown> }> = [];
  const io = new WslMachineIO("Ubuntu", { request: async <T>(op: string, params = {}) => {
    requests.push({ op, params });
    if (op === "fs.readFile") return Buffer.from([0, 255, 13, 10]).toString("base64") as T;
    return { stdout: Buffer.from("partial").toString("base64"), stderr: Buffer.from("failed").toString("base64"), code: 7, signal: null } as T;
  } });
  await expect(io.fs.readFile("/tmp/file")).resolves.toEqual(Buffer.from([0, 255, 13, 10]));
  await expect(io.exec("git", ["status"], { cwd: "/project", input: Buffer.from([0, 255]) })).rejects.toMatchObject({ code: 7, stdout: "partial", stderr: "failed" });
  expect(requests[1]).toMatchObject({ op: "exec", params: { cwd: "/project", stdin: "AP8=", encoding: "base64" } });
});

it.runIf(process.env.MONOCODE_TEST_WSL === "1")("runs Linux workspace, branch, worktree and checkpoint operations while retaining metadata on Windows", async () => {
  const distribution = process.env.MONOCODE_TEST_WSL_DISTRO ?? "Ubuntu-26.04";
  const node = process.env.MONOCODE_TEST_WSL_NODE;
  if (!node) throw new Error("MONOCODE_TEST_WSL_NODE must name the Linux runtime");
  const source = execFileSync("wsl.exe", ["-d", distribution, "--exec", "wslpath", "-a", path.resolve("host/wsl-exec.mjs")], { encoding: "utf8" }).trim();
  const root = `/tmp/monocode-machine-io-${randomUUID()}`;
  const script = `import { createWslExecServer, bridgeWslExec } from ${JSON.stringify(`file://${source}`)};
    import { rm } from 'node:fs/promises';
    const root = ${JSON.stringify(root)}, socket = root + '/run/rpc.sock';
    const service = await createWslExecServer({runDirectory: root + '/run', socket});
    try { await bridgeWslExec(socket); } finally { await service.close(); await rm(root, {recursive:true,force:true}); }`;
  const connection = new WslConnection({ distribution, launch: () => spawn("wsl.exe", ["-d", distribution, "--exec", node, "--input-type=module", "-e", script], { stdio: "pipe", windowsHide: true }) });
  const io = new WslMachineIO(distribution, connection);
  const metadata = await mkdtemp(path.join(tmpdir(), "monocode-machine-metadata-"));
  const store = new HostStore(path.join(metadata, "host.db"));
  try {
    await withMachineIO(io, async () => {
      const cwd = `${root}/workspace`;
      await machineFs.mkdir(cwd, { recursive: true });
      await io.exec("git", ["init", "-q", "-b", "main"], { cwd });
      await io.exec("git", ["config", "user.name", "MachineIO Test"], { cwd });
      await io.exec("git", ["config", "user.email", "machine-io@example.invalid"], { cwd });
      await createHostPath(cwd, "", "src/file.txt", false);
      await writeHostFile(cwd, "src/file.txt", "", "before\n");
      await io.exec("git", ["add", "."], { cwd });
      await io.exec("git", ["commit", "-qm", "baseline"], { cwd });
      expect((await listHostFiles(cwd, "src"))[0].name).toBe("file.txt");
      await expect(createHostPath(cwd, "src", "file.txt", false)).rejects.toMatchObject({ code: "EEXIST" });
      await createHostBranch(cwd, "feature");
      expect((await hostBranches(cwd)).current).toBe("feature");
      const tree = await createHostWorktree(cwd, "worker", "HEAD", false);
      expect(tree.path).toBe(`${root}/workspace-worktrees/wt-worker`);
      expect((await hostWorktrees(cwd)).worktrees).toHaveLength(2);
      expect(() => resolveHostWorktree(cwd, tree.path)).toThrow("Resolve the WSL worktree");
      await withValidatedHostWorktree(cwd, tree.path, () => {
        expect(resolveHostWorktree(cwd, tree.path)).toBe(tree.path);
        expect(hostWorktreeAt(cwd, tree.path)?.branch).toBe("worker");
      });
      expect(() => resolveHostWorktree(cwd, tree.path)).toThrow("Resolve the WSL worktree");
      store.addProject(metadata, "local");
      store.addProject(cwd, "other-distro", undefined, { kind: "wsl", distribution: "Other-Distro" });
      const project = store.addProject(cwd, "wsl", undefined, { kind: "wsl", distribution });
      const selected: string[] = [];
      const commands = new WorkspaceCommands(store, async (projectId, operation) => { selected.push(projectId); return operation(); });
      expect(await commands.run("read_text_file", { path: `${cwd}/src/file.txt` })).toBe("before\n");
      await commands.run("git_stash", { cwd, message: "nothing" });
      expect(selected).toEqual([project.id]);
      await io.exec("ln", ["-s", "/etc", `${cwd}/escape`], { cwd });
      await expect(readHostFile(cwd, "escape/passwd")).rejects.toThrow("outside the workspace");
      await machineFs.rm(`${cwd}/escape`);
      const checkpoints = new SessionCheckpoints(metadata);
      await checkpoints.beginTurn("session", cwd, "turn");
      await writeHostFile(cwd, "src/file.txt", "before\n", "after\n");
      await checkpoints.finishTurn("session", cwd, "turn");
      expect((await hostGitIndex(cwd)).files[0].relative).toBe("src/file.txt");
      expect((await hostFileDiff(cwd, "src/file.txt", false)).current).toBe("after\n");
      expect((await checkpoints.status("session", cwd)).files[0]).toMatchObject({ relative: "src/file.txt", undoable: true });
      expect(JSON.parse(await readFile(path.join(metadata, "session", "turn-review.json"), "utf8")).machine).toBe(io.key);
      await checkpoints.undo("session", cwd);
      expect(await readHostFile(cwd, "src/file.txt")).toBe("before\n");
      await checkpoints.forget("session");
      const desktopHome = path.join(metadata, "desktop-home");
      const desktopSkill = path.join(desktopHome, ".agents", "skills", "desktop");
      await mkdir(desktopSkill, { recursive: true });
      await writeFile(path.join(desktopSkill, "SKILL.md"), "---\nname: desktop\ndescription: Shared desktop skill\n---\nDesktop skill body");
      await machineFs.mkdir(`${cwd}/.agents/skills/linux`, { recursive: true });
      await machineFs.writeFile(`${cwd}/.agents/skills/linux/SKILL.md`, "---\nname: linux\ndescription: Linux project skill\n---\nLinux skill body");
      const skills = await discoverHostSkills(cwd, desktopHome, path.join(metadata, "managed"));
      expect(skills.map((skill) => skill.name).sort()).toEqual(["desktop", "linux"]);
      expect(skills.find((skill) => skill.name === "desktop")?.path).toMatch(/^\/mnt\//);
      const catalog = new HostSkills(desktopHome, path.join(metadata, "managed"));
      const prompt = await catalog.prepare("/desktop /linux", { cwd, harness: "pi" }, {} as HostProvider);
      expect(prompt).toContain("Desktop skill body");
      expect(prompt).toContain("Linux skill body");
      catalog.close();
      await machineFs.rm(`${cwd}/.agents`, { recursive: true });
      const task: OrchestrationTask = {
        id: "task1234567890", sessionId: "worker123", title: "Worker", harness: "codex", model: "codex:test",
        prompt: "Work", files: ["."], scopes: [cwd], dependsOn: [], status: "queued", accepted: false,
        result: "", delivered: false, workspacePolicy: "isolated-child",
      };
      const run: OrchestrationRun = { version: 2, leadId: "lead123", cwd, status: "active", allowedHarnesses: ["codex"], maxWorkers: 2, cli: "", tasks: [task], continuations: 0, requests: {} };
      const workers = new HostOrchestrationWorkspace(store);
      const prepared = await workers.createWorker(run, task);
      task.workspace = prepared.workspace;
      task.scratchDir = prepared.scratchDir;
      expect(task.scratchDir).toMatch(/^\/mnt\//);
      expect((await machineFs.stat(task.scratchDir!)).isDirectory()).toBe(true);
      workers.releasePreparation(task.sessionId);
      await machineFs.writeFile(`${prepared.workspace.checkoutCwd}/src/file.txt`, "worker result\n");
      expect(await workers.captureWorker(run, task)).toEqual({ files: ["src/file.txt"] });
      await workers.integrateWorker(run, task);
      expect(await machineFs.readFile(`${cwd}/src/file.txt`, "utf8")).toBe("worker result\n");
      expect(await workers.cleanupWorker(run, task, false)).toBe(true);
      // Non-Git workspaces use local snapshot blobs and preserve Linux modes.
      const plain = `${root}/plain`;
      await machineFs.mkdir(plain);
      await machineFs.writeFile(`${plain}/script`, "before\n");
      await machineFs.chmod(`${plain}/script`, 0o755);
      await checkpoints.ensure("plain", plain);
      await checkpoints.prepare("plain", plain, ["script"]);
      await machineFs.writeFile(`${plain}/script`, "after\n");
      await checkpoints.capture("plain", plain, ["script"]);
      await checkpoints.undo("plain", plain);
      expect((await machineFs.stat(`${plain}/script`)).mode & 0o777).toBe(0o755);
      expect(await machineFs.readFile(`${plain}/script`, "utf8")).toBe("before\n");
      const snippet = await evalSnippet({ cwd: plain, code: 'const text = await files.read("script"); const command = await world.run("sh", ["-c", "printf Linux; exit 7"]); return { text, command };', timeoutMs: 10_000 });
      expect(snippet).toMatchObject({ kind: "completed", result: { text: "before\n", command: { stdout: "Linux", exitCode: 7 } } });
      const saved = await saveSavedWorkflow({ cwd: plain, name: "linux", scope: "project", homeDir: desktopHome,
        meta: { description: "Linux saved workflow" }, script: 'phase("Read"); return await files.read("script");' });
      expect(saved.path).toBe(`${plain}/.monocode/workflows/linux.dwf.ts`);
      expect((await listSavedWorkflows({ cwd: plain, scope: "project", homeDir: desktopHome })).entries.map((entry) => entry.name)).toEqual(["linux"]);
    });
  } finally {
    await connection.close();
    store.close();
    await rm(metadata, { recursive: true, force: true });
  }
}, 90_000);
