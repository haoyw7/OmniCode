import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";

/** Exercises the shipped bundle outside the checkout, with outbound network blocked. */
it("loads the Feishu SDK from an isolated Host bundle without source node_modules", async () => {
  const directory = mkdtempSync(join(tmpdir(), "monocode-im-package-"));
  const entry = join(directory, "host.mjs"), data = join(directory, "data");
  copyFileSync(resolve("build/host/monocode-host.mjs"), entry);
  copyFileSync(resolve("host/provider-guard.mjs"), join(directory, "provider-guard.mjs"));
  const marker = join(directory, "sdk-network-attempt");
  const preload = join(directory, "offline.mjs");
  writeFileSync(preload, `import https from 'node:https';\nimport {writeFileSync} from 'node:fs';\nimport {syncBuiltinESMExports} from 'node:module';\nhttps.request = () => { writeFileSync(${JSON.stringify(marker)}, 'attempted'); throw new Error('Network disabled by package smoke test'); };\nsyncBuiltinESMExports();\n`);
  const probe = createServer();
  await new Promise<void>(done => probe.listen(0, "127.0.0.1", done));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>(done => probe.close(() => done()));
  const device = JSON.parse((await promisify(execFile)(process.execPath, [entry, "pair", "--name", "Package test", "--data-dir", data, "--port", String(port)], { cwd: directory })).stdout);
  const child = spawn(process.execPath, ["--import", preload, entry, "serve", "--data-dir", data, "--port", String(port)], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const rpc = async (method: string, params: object = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/rpc`, { method: "POST", headers: { Authorization: `Bearer ${device.token}` }, body: JSON.stringify({ version: 1, environmentId: device.environmentId, method, params }), signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    return body.result;
  };
  try {
    await vi.waitFor(() => expect(existsSync(join(data, "running.json")), output).toBe(true), { timeout: 15_000 });
    expect((await rpc("environment.describe")).capabilities).toContain("im.feishu.v1");
    await rpc("im.configure", { appId: "cli_1234567890abcdef", appSecret: "fake-package-secret", ownerOpenId: "ou_package" });
    await rpc("im.control", { action: "enable" });
    await vi.waitFor(() => expect(existsSync(marker), output).toBe(true), { timeout: 5000 });
    await rpc("im.control", { action: "disable" });
    expect((await rpc("im.get")).status.state).toBe("stopped");
    expect(output).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find (?:module|package)/);
    expect(output).not.toContain("fake-package-secret");
  } finally {
    try {
      if (existsSync(join(data, "running.json"))) {
        const state = JSON.parse(readFileSync(join(data, "running.json"), "utf8"));
        await fetch(`http://127.0.0.1:${port}/lifecycle`, { method: "POST", headers: { Authorization: `Bearer ${state.secret}` }, body: '{"action":"stop"}', signal: AbortSignal.timeout(5000) }).catch(() => undefined);
      }
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(timer);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
}, 30_000);
