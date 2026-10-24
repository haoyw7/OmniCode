import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostProviderLogin } from "./provider-login";

const roots: string[] = [];
const owners: HostProviderLogin[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function setup() {
  const root = mkdtempSync(join(tmpdir(), "omnicode-provider-login-"));
  roots.push(root);
  const child = Object.assign(new EventEmitter(), { exitCode: null, kill: vi.fn(() => true) });
  const launch = vi.fn(async () => child as unknown as ChildProcess);
  const owner = new HostProviderLogin(root, launch);
  owners.push(owner);
  return { owner, root, launch, child };
}

describe("Host provider login", () => {
  it("owns the child, deduplicates receipts and rejects different content for the same operation", async () => {
    const { owner, launch, child } = setup();
    const command = { provider: "grok", operationId: "op-one" };
    expect(await owner.start(command)).toEqual({ id: "op-one", status: "running" });
    expect(await owner.start(command)).toEqual({ id: "op-one", status: "running" });
    expect(launch).toHaveBeenCalledExactlyOnceWith("grok", ["login", "--oauth"]);
    await expect(owner.start({ ...command, provider: "cursor" })).rejects.toThrow("different input");
    child.emit("exit", 0);
    expect(owner.status({ id: "op-one" })).toEqual({ id: "op-one", status: "succeeded" });
    expect(await owner.start(command)).toEqual({ id: "op-one", status: "succeeded" });
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported profiles and simultaneous OAuth flows", async () => {
    const { owner, launch } = setup();
    await expect(owner.start({ provider: "pi", operationId: "one" })).rejects.toThrow("single browser");
    await expect(owner.start({ provider: "cursor", operationId: "one", accountId: "private" })).rejects.toThrow("named sign-in");
    await owner.start({ provider: "cursor", operationId: "one" });
    await expect(owner.start({ provider: "cursor", operationId: "two" })).rejects.toThrow("already running");
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("retains interrupted operations across Host restart without replaying sign-in", async () => {
    const { owner, root, launch } = setup();
    const command = { provider: "fx", operationId: "persisted" };
    await owner.start(command);
    const restarted = new HostProviderLogin(root, launch);
    owners.push(restarted);
    expect(await restarted.start(command)).toMatchObject({ id: "persisted", status: "failed", error: expect.stringContaining("interrupted") });
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("cleans up a process whose resolution finishes after shutdown", async () => {
    const { owner, launch, child } = setup();
    let release!: (child: ChildProcess) => void;
    launch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = owner.start({ provider: "cursor", operationId: "late" });
    owner.close();
    release(child as unknown as ChildProcess);
    expect(await pending).toEqual({ id: "late", status: "failed", error: "Host stopped" });
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
