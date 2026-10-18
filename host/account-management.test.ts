import { afterEach, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostAccountManagement } from "./account-management";
import { namedProviderAccountHome, providerAccountDirectory, resolveDefaultAccount } from "./provider-accounts";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "host-accounts-")); roots.push(root);
  const host = join(root, "host"), desktop = join(root, "desktop"), external = join(root, "external");
  for (const dir of [host, external, join(desktop, "provider-accounts", "codex", "work")]) mkdirSync(dir, { recursive: true });
  const owner = join(host, "desktop-owner.json");
  writeFileSync(owner, JSON.stringify({ desktopDirectory: desktop }));
  writeFileSync(join(desktop, "provider-accounts", "accounts.json"), JSON.stringify({ codex: [
    { id: "work", label: "Release work" }, { id: "custom", label: "Custom", dataHome: external },
  ] }));
  writeFileSync(join(desktop, "provider-accounts", "defaults.json"), JSON.stringify({ codex: "work" }));
  const jwt = `x.${Buffer.from(JSON.stringify({ email: "work@example.test" })).toString("base64url")}.x`;
  writeFileSync(join(desktop, "provider-accounts", "codex", "work", "auth.json"), JSON.stringify({ tokens: { id_token: jwt, refresh_token: "private-refresh-token" } }));
  return { root, host, desktop, external, owner, api: new HostAccountManagement(host) };
}
it("imports desktop metadata once, keeps CLI Homes in place and exposes no credentials or paths", () => {
  const { api, owner, host, desktop } = fixture();
  expect(api.read()).toMatchObject({ revision: 1, defaults: { codex: "work" }, accounts: { codex: expect.arrayContaining([
    expect.objectContaining({ id: "work", label: "Release work", identity: { email: "work@example.test" } }),
  ]) } });
  expect(providerAccountDirectory(owner)).toBe(host);
  expect(namedProviderAccountHome(host, "codex", "work")).toBe(join(desktop, "provider-accounts", "codex", "work"));
  expect(resolveDefaultAccount(owner, "codex")).toBe("work");
  const publicData = JSON.stringify(api.read());
  expect(publicData).not.toContain(desktop);
  expect(publicData).not.toContain("dataHome");
  expect(publicData).not.toContain("private-refresh-token");
  writeFileSync(join(desktop, "provider-accounts", "accounts.json"), "{}");
  rmSync(owner);
  expect(new HostAccountManagement(host).read().accounts.codex?.some(row => row.id === "work")).toBe(true);
});
it("keeps different account edits, preserves private Home on rename and deduplicates operation IDs", () => {
  const { api, host, external } = fixture();
  api.read();
  const request = { operationId: "rename", provider: "codex", accountId: "custom", label: "New name" };
  const first = api.save(request);
  expect(api.save(request).revision).toBe(first.revision);
  expect(namedProviderAccountHome(host, "codex", "custom")).toBe(external);
  api.save({ operationId: "add-other", provider: "claude", accountId: "other", label: "Other" });
  expect(api.read().accounts.codex?.find(row => row.id === "custom")?.label).toBe("New name");
  expect(() => api.save({ ...request, label: "Conflict" })).toThrow("reused");
  expect(() => api.save({ operationId: "invalid", provider: "codex", accountId: "relative", label: "Bad", dataHome: "relative/path" })).toThrow("absolute path");
});
it("stops account runs before removing managed credentials, preserves custom Homes and blocks removed profiles", async () => {
  const { api, host, owner, desktop, external } = fixture();
  api.read();
  await expect(api.remove({ operationId: "remove-default", provider: "codex", accountId: "work" })).rejects.toThrow("another shared default");
  api.setDefault({ operationId: "default", provider: "codex", accountId: "default" });
  const before = vi.fn(async () => { expect(existsSync(join(desktop, "provider-accounts", "codex", "work"))).toBe(true); });
  const managed = new HostAccountManagement(host, before);
  const command = { operationId: "remove", provider: "codex", accountId: "work" };
  await managed.remove(command); await managed.remove(command);
  expect(before).toHaveBeenCalledTimes(1);
  expect(existsSync(join(desktop, "provider-accounts", "codex", "work"))).toBe(false);
  expect(() => resolveDefaultAccount(owner, "codex", "work")).toThrow("no longer available");
  expect(() => namedProviderAccountHome(host, "codex", "work")).toThrow("no longer available");
  writeFileSync(join(external, "credentials"), "keep");
  await api.remove({ operationId: "remove-custom", provider: "codex", accountId: "custom" });
  expect(readFileSync(join(external, "credentials"), "utf8")).toBe("keep");
});
it.each(["explicit", "environment"])("does not remove a managed Home shared by another profile (%s)", async kind => {
  const { api, desktop } = fixture();
  api.setDefault({ operationId: "default", provider: "codex", accountId: "default" });
  const home = join(desktop, "provider-accounts", "codex", "work");
  if (kind === "environment") vi.stubEnv("CODEX_HOME", home);
  else api.save({ operationId: "alias", provider: "codex", accountId: "alias", label: "Alias", dataHome: home });
  await api.remove({ operationId: "remove", provider: "codex", accountId: "work" });
  expect(existsSync(join(home, "auth.json"))).toBe(true);
});
it("imports only Codex sign-in into a new Host-managed Home without changing defaults", () => {
  const { api, host, root } = fixture();
  const source = join(root, "source"); mkdirSync(source); vi.stubEnv("CODEX_HOME", source);
  writeFileSync(join(source, "auth.json"), JSON.stringify({ tokens: { refresh_token: "secret" } }));
  writeFileSync(join(source, "history.jsonl"), "private history");
  writeFileSync(join(source, "config.toml"), 'cli_auth_credentials_store = "keyring"\nmodel_provider = "custom"\n[model_providers.custom]\nbase_url = "https://fixture.test/v1"\n');
  const params = { operationId: "import", accountId: "imported", label: "Imported" };
  const first = api.importCodex(params);
  expect(api.importCodex(params).revision).toBe(first.revision);
  const home = join(host, "provider-accounts", "codex", "imported");
  expect(existsSync(join(home, "auth.json"))).toBe(true);
  expect(existsSync(join(home, "history.jsonl"))).toBe(false);
  const config = readFileSync(join(home, "config.toml"), "utf8");
  expect(config).toContain('cli_auth_credentials_store = "file"');
  expect(config).not.toContain("keyring");
  expect(config).toContain('base_url = "https://fixture.test/v1"');
  expect(api.read().defaults.codex).toBe("work");
  expect(JSON.stringify(api.read())).not.toContain("secret");
});
