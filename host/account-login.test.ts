import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async original => ({ ...await original<typeof import("node:child_process")>(), spawn: mocks.spawn }));
vi.mock("./process", () => ({ resolveProvider: async () => "/fixture/provider", providerLaunch: async () => ({ command: "/fixture/provider", args: [] }) }));
import { HostAccountManagement } from "./account-management";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.clearAllMocks(); });
function setup() {
  const root = mkdtempSync(join(tmpdir(), "account-login-")); roots.push(root);
  const child = Object.assign(new EventEmitter(), { exitCode: null, kill: vi.fn() });
  mocks.spawn.mockReturnValue(child);
  return { api: new HostAccountManagement(root), root, child };
}
it("runs named sign-in on Host, strips environment credentials and shares one job across clients", async () => {
  const { api, root, child } = setup();
  vi.stubEnv("OPENAI_API_KEY", "private-environment-token");
  api.save({ operationId: "create", provider: "codex", accountId: "work", label: "Work" });
  const params = { operationId: "login-one", provider: "codex", accountId: "work" };
  expect(await api.loginStart(params)).toEqual({ id: "login-one", status: "running" });
  expect(await api.loginStart({ ...params, operationId: "login-two" })).toEqual({ id: "login-one", status: "running" });
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
  const options = mocks.spawn.mock.calls[0][2];
  expect(options.env.CODEX_HOME).toBe(join(root, "provider-accounts", "codex", "work"));
  expect(options.env.OPENAI_API_KEY).toBeUndefined();
  expect(mocks.spawn.mock.calls[0][1]).toEqual(["login"]);
  child.emit("exit", 0);
  expect(api.loginStatus({ id: "login-one" })).toEqual({ id: "login-one", status: "succeeded" });
  expect(await api.loginStart(params)).toEqual({ id: "login-one", status: "succeeded" });
  expect(() => new HostAccountManagement(root).loginStart(params)).toThrow("interrupted");
  api.close();
});
it("keeps Claude's implicit default keychain selector and stops pending jobs on Host shutdown", async () => {
  const { api, child } = setup();
  vi.stubEnv("CLAUDE_CONFIG_DIR", "");
  vi.stubEnv("CLAUDE_SECURESTORAGE_CONFIG_DIR", "");
  await api.loginStart({ operationId: "login", provider: "claude", accountId: "default" });
  const options = mocks.spawn.mock.calls[0][2];
  expect(options.env.CLAUDE_CONFIG_DIR).toBe("");
  expect(mocks.spawn.mock.calls[0][1]).toEqual(["auth", "login"]);
  api.close();
  expect(child.kill).toHaveBeenCalledOnce();
  expect(api.loginStatus({ id: "login" })).toMatchObject({ status: "failed", error: "Host stopped" });
});
