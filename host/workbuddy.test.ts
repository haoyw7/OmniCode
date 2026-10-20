import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { resolveWorkBuddy, workBuddyAccounts, workBuddyLaunch, workBuddyOptionsForOwner, workBuddyVersion } from "./workbuddy";
import { desktopProviderAccounts, resolveDefaultAccount } from "./provider-accounts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "omnicode-wb-discovery-")); vi.stubEnv("LOCALAPPDATA", root); if (process.platform === "darwin") vi.stubEnv("HOME", root); });
afterEach(() => {
  vi.unstubAllEnvs();
  const resolved = realpathSync(root);
  if (!resolved.startsWith(realpathSync(tmpdir()) + sep)) throw new Error("Unsafe temporary cleanup");
  rmSync(resolved, { recursive: true, force: true });
});
function installation(edition: "cn" | "global", uid: string = edition, custom?: string) {
  const authId = edition === "cn" ? "workbuddy-desktop" : "workbuddy-desktop-ai";
  const macos = process.platform === "darwin";
  const executable = macos
    ? join(custom ?? join(root, "Applications", edition === "cn" ? "WorkBuddy.app" : "WorkBuddy AI.app"), "Contents/MacOS/WorkBuddy")
    : join(custom ?? join(root, "Programs", edition === "cn" ? "WorkBuddy" : "WorkBuddyAI"), edition === "cn" ? "WorkBuddy.exe" : "WorkBuddyAI.exe");
  const resources = macos ? join(dirname(dirname(executable)), "Resources") : join(dirname(executable), "resources");
  const cli = join(resources, "app.asar.unpacked", "cli");
  mkdirSync(join(cli, "bin"), { recursive: true }); mkdirSync(dirname(executable), { recursive: true }); writeFileSync(executable, ""); writeFileSync(join(cli, "bin", "codebuddy"), "");
  writeFileSync(join(cli, "product.json"), JSON.stringify({ endpoint: edition === "cn" ? "https://copilot.tencent.com" : "https://www.workbuddy.ai", authentication: { id: authId }, version: "5.test" }));
  writeFileSync(join(cli, "package.json"), JSON.stringify({ publishConfig: { customPackage: { version: "2.test-" + edition } } }));
  const data = macos ? join(root, "Library/Application Support") : root;
  const auth = join(data, "CodeBuddyExtension", "Data", "Public", "auth"); mkdirSync(auth, { recursive: true });
  writeFileSync(join(auth, authId + ".info"), JSON.stringify({ account: { uid, email: "user@example.test" }, auth: { accessToken: { $wbEncrypted: 1, envelope: "never-publish" }, refreshToken: "never-publish" } }));
  return executable;
}

it.skipIf(!["win32", "darwin"].includes(process.platform))("discovers regional read-only accounts without exposing credentials or install paths", () => {
  installation("cn"); installation("global");
  const accounts = workBuddyAccounts();
  expect(accounts.map(a => a.edition)).toEqual(["cn", "global"]);
  expect(accounts.every(a => a.readOnly && a.id.startsWith("wb-"))).toBe(true);
  expect(JSON.stringify(accounts)).not.toContain("never-publish");
  expect(JSON.stringify(accounts)).not.toContain(root);
  expect(desktopProviderAccounts(join(root, "missing-owner.json")).workbuddy).toEqual(accounts);
  const prior = accounts[0].id;
  installation("cn", "replacement");
  expect(workBuddyAccounts()[0].id).not.toBe(prior);
  expect(() => workBuddyLaunch({ accountId: prior }, [])).toThrow("no longer available");
});

it.skipIf(!["win32", "darwin"].includes(process.platform))("honors a configured installation and selects the engine matching the account", () => {
  const cn = installation("cn"), global = installation("global", "global", join(root, "custom"));
  const owner = join(root, "desktop-owner.json"); writeFileSync(owner, JSON.stringify({ desktopDirectory: root, providerBinaryPaths: { workbuddy: global } }));
  const options = workBuddyOptionsForOwner(owner);
  expect(resolveWorkBuddy(options)).toBe(global);
  expect(workBuddyVersion(options)).toBe("2.test-global");
  const account = workBuddyAccounts(options).find(a => a.edition === "cn")!;
  expect(workBuddyLaunch({ ...options, accountId: account.id }, ["--model", "auto"])).toMatchObject({ command: cn, args: expect.arrayContaining(["--model", "auto"]) });
  expect(desktopProviderAccounts(owner).workbuddy).toHaveLength(2);
  expect(() => resolveWorkBuddy({ binaryPath: join(root, "missing.exe") })).toThrow("Configured path");
});

it.skipIf(!["win32", "darwin"].includes(process.platform))("never chooses an account from another region when the requested login is absent", () => {
  installation("global");
  const owner = join(root, "missing-owner.json");
  expect(resolveDefaultAccount(owner, "workbuddy", undefined, "workbuddy:cn:auto")).toBeUndefined();
  expect(resolveDefaultAccount(owner, "workbuddy", undefined, "workbuddy:global:fast-model")).toBe(workBuddyAccounts()[0].id);
  expect(() => resolveDefaultAccount(owner, "workbuddy", "wb-cn-removed", "workbuddy:cn:auto")).toThrow("no longer available");
});
