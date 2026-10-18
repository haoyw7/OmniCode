import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { currentMachineIO, localMachineIO, withMachineIO, WslMachineIO } from "./machine-io";
import { refreshCodexAccountBeforeWsl } from "./provider-account-refresh";
import { withProviderAccountLock } from "./provider-account-lock";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const now = 1_800_000_000_000;
const credential = (exp: number) => ({ auth_mode: "chatgpt", tokens: {
  access_token: `e30.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.signature`, refresh_token: "test-refresh",
} });
async function account(auth?: unknown) {
  const home = await mkdtemp(join(tmpdir(), "monocode-refresh-test-")); directories.push(home);
  if (auth !== undefined) await writeFile(join(home, "auth.json"), JSON.stringify(auth));
  return { command: "codex", home, accountId: "named" };
}

it("refreshes an expiring managed account on the local backend, including under a reentrant account lock", async () => {
  const input = await account(credential(now / 1000 + 599));
  const request = vi.fn(async () => { expect(currentMachineIO()).toBe(localMachineIO); return {}; });
  const remote = new WslMachineIO("Ubuntu", { request: async () => { throw new Error("Should not use WSL"); } });
  const result = await withMachineIO(remote, () => withProviderAccountLock(`codex:${input.home}`, () =>
    refreshCodexAccountBeforeWsl(input, { now: () => now, request })));
  expect(result).toBe("refreshed");
  expect(request).toHaveBeenCalledWith("codex", expect.any(String), "account/read", { refreshToken: true }, "named", expect.stringMatching(/^monocode-codex-refresh-/));
});

it.each([
  undefined,
  credential(now / 1000 + 600),
  { OPENAI_API_KEY: "test-key" },
  { ...credential(now / 1000), auth_mode: "chatgptAuthTokens" },
  { tokens: { access_token: "not-a-jwt", refresh_token: "test-refresh" } },
  { tokens: { access_token: credential(now / 1000).tokens.access_token } },
])("does not refresh fresh, external, API-key, or unrecognized credentials (%#)", async auth => {
  const request = vi.fn();
  expect(await refreshCodexAccountBeforeWsl(await account(auth), { now: () => now, request })).toBe("not-needed");
  expect(request).not.toHaveBeenCalled();
});

it("serializes refreshes and rechecks the updated account after taking the lock", async () => {
  const input = await account(credential(now / 1000 - 1));
  const request = vi.fn(async () => {
    await writeFile(join(input.home, "auth.json"), JSON.stringify(credential(now / 1000 + 3600)));
    return {};
  });
  expect(await Promise.all([1, 2].map(() => refreshCodexAccountBeforeWsl(input, { now: () => now, request })))).toEqual(["refreshed", "not-needed"]);
  expect(request).toHaveBeenCalledTimes(1);
});

it("does not expose credential-bearing provider errors", async () => {
  const request = vi.fn(async () => { throw new Error("test-secret-token"); });
  await expect(refreshCodexAccountBeforeWsl(await account(credential(now / 1000)), { now: () => now, request }))
    .rejects.toThrow(/^Unable to refresh the desktop Codex account before starting WSL$/);
});
