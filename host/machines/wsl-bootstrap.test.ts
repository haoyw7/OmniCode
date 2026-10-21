import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { WslConnection } from "./wsl";
import { withStartupProgress } from "../startup-progress";
import type { StartupProgress } from "../../src/integrations/harness/core/startupProgress";

it.runIf(process.platform === "win32" && process.env.OMNICODE_TEST_WSL === "1")("reports real WSL bootstrap copying and completes the handshake in an isolated home", async () => {
  const distribution = process.env.OMNICODE_TEST_WSL_DISTRIBUTION ?? "Ubuntu-26.04";
  const home = `/tmp/omnicode-wsl-bootstrap-${randomUUID()}`;
  const script = (await readFile("host/machines/wsl-bootstrap.sh", "utf8")).replaceAll("\r\n", "\n");
  const progress: StartupProgress[] = [];
  const connection = new WslConnection({ distribution, launch: () => {
    const child = spawn("wsl.exe", ["--distribution", distribution, "--exec", "bash", "-s", "--", resolve("build/wsl-host"), home],
      { stdio: "pipe", windowsHide: true });
    child.stdin.write(`export HOME="$2"\n${script.trimEnd()}\n`);
    return child;
  } });
  try {
    const info = await withStartupProgress(value => progress.push(value), () => connection.request<{ home: string }>("env.info"));
    expect(info.home).toBe(home);
    expect(progress.some(value => value.stage === "copying-runtime" && value.total! > 0 && value.completed === value.total)).toBe(true);
    expect(progress.some(value => value.stage === "checking-runtime")).toBe(true);
    const result = await connection.request<{ stdout: string }>("exec", { command: "/bin/echo", args: ["connected"] });
    expect(result.stdout.trim()).toBe("connected");
  } finally {
    if (connection.isConnected()) await connection.request("service.shutdown").catch(() => {});
    await connection.close();
    if (!/^\/tmp\/omnicode-wsl-bootstrap-[a-f0-9-]{36}$/.test(home)) throw new Error("Invalid test cleanup path");
    await promisify(execFile)("wsl.exe", ["--distribution", distribution, "--exec", "chmod", "-R", "u+w", "--", home], { windowsHide: true });
    await promisify(execFile)("wsl.exe", ["--distribution", distribution, "--exec", "rm", "-rf", "--", home], { windowsHide: true });
  }
}, 60_000);
