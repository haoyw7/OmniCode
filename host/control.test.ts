import { connect } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostControl, runControlCli } from "./control";

const exec = promisify(execFile);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function call(environment: Record<string, string>, request: unknown) {
  const [host, port] = environment.MONOCODE_CONTROL_ENDPOINT.split(":");
  return new Promise<any>((resolve, reject) => {
    const socket = connect(Number(port), host);
    let response = "";
    socket.setEncoding("utf8");
    socket.setTimeout(2_000, () => socket.destroy(new Error("fixture timeout")));
    socket.on("error", reject);
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", data => { response += data; });
    socket.on("end", () => { try { resolve(JSON.parse(response)); } catch (error) { reject(error); } });
  });
}

it("scopes control grants to the lead and revokes them without device RPC authority", async () => {
  const handle = vi.fn(async (lead, requestId, action) => ({ lead, requestId, action }));
  const service = new HostControl(handle);
  await service.ready;
  try {
    service.enable("lead");
    const environment = service.environment("lead");
    expect(service.environment("worker")).toEqual({});
    const request = { namespace: "control", token: environment.MONOCODE_CONTROL_TOKEN,
      requestId: "same-request", action: "list", input: {} };
    expect(await call(environment, request)).toMatchObject({ ok: true, result: { lead: "lead", requestId: "same-request" } });
    expect(await call(environment, { ...request, namespace: "app" })).toMatchObject({ ok: false });
    service.disable("lead");
    expect(await call(environment, request)).toMatchObject({ ok: false });
    expect(handle).toHaveBeenCalledTimes(1);
  } finally { await service.close(); }
});

it("validates control requests before invoking the scheduler", async () => {
  const handle = vi.fn(async () => ({}));
  const service = new HostControl(handle);
  await service.ready;
  try {
    service.enable("lead");
    const environment = service.environment("lead");
    const base = { namespace: "control", token: environment.MONOCODE_CONTROL_TOKEN,
      requestId: "valid", action: "list", input: {} };
    for (const invalid of [{ ...base, action: "app.send" }, { ...base, requestId: "" }, { ...base, input: [] }])
      expect(await call(environment, invalid)).toMatchObject({ ok: false });
    expect(handle).not.toHaveBeenCalled();
  } finally { await service.close(); }
});

it("the CLI preserves request IDs on success and uncertain failure and never prints the token", async () => {
  const service = new HostControl(async (_lead, _id, action) => ({ action }));
  await service.ready;
  service.enable("lead");
  const environment = service.environment("lead");
  for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { lines.push(String(chunk)); return true; });
  try {
    expect(await runControlCli(["list", "--request-id", "receipt-1"])).toBe(0);
    expect(JSON.parse(lines.at(-1)!)).toEqual({ ok: true, result: { action: "list" }, requestId: "receipt-1" });
    service.disable("lead");
    expect(await runControlCli(["list", "--request-id", "receipt-1"])).toBe(1);
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ ok: false, requestId: "receipt-1" });
    expect(lines.join("")).not.toContain(environment.MONOCODE_CONTROL_TOKEN);
  } finally { await service.close(); }
});

it("rejects misspelled and duplicate flags without contacting the service", async () => {
  const handle = vi.fn(async () => ({}));
  const service = new HostControl(handle);
  await service.ready;
  service.enable("lead");
  for (const [key, value] of Object.entries(service.environment("lead"))) vi.stubEnv(key, value);
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { lines.push(String(chunk)); return true; });
  try {
    for (const args of [["list", "--jso", "{}"], ["list", "--json", "{}", "--json", "{}"], ["list", "--json", "[]"]]) {
      expect(await runControlCli(args)).toBe(1);
      expect(JSON.parse(lines.at(-1)!)).toMatchObject({ ok: false });
    }
    expect(handle).not.toHaveBeenCalled();
  } finally { await service.close(); }
});

it("the generated launcher preserves executable/entry paths and JSON arguments with spaces", async () => {
  const directory = await mkdtemp(join(tmpdir(), "monocode launcher space-"));
  const service = new HostControl(async () => ({}));
  try {
    const entry = join(directory, "entry space.mjs");
    await writeFile(entry, "process.stdout.write(JSON.stringify(process.argv.slice(2)))");
    const launcher = await service.launcher(directory, entry);
    const args = ["control", "delegate", "--json", '{"title":"worker with spaces"}'];
    const output = process.platform === "win32"
      ? await exec(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c",
        `""${launcher}" control delegate --json "{\\"title\\":\\"worker with spaces\\"}""`], { windowsVerbatimArguments: true })
      : await exec(launcher, args);
    expect(JSON.parse(output.stdout)).toEqual(args);
    expect(await readFile(launcher, "utf8")).not.toContain("MONOCODE_CONTROL_TOKEN");
  } finally { await service.close(); await rm(directory, { recursive: true, force: true }); }
});
