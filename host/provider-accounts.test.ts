import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  desktopProviderAccounts,
  resolveDefaultAccount,
  namedProviderAccountHome,
  defaultProviderAccountHome,
} from "./provider-accounts";
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "shared-defaults-"));
  dirs.push(dir);
  for (const key of [
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "CODEX_ACCESS_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
  ])
    vi.stubEnv(key, "");
  vi.stubEnv("CODEX_HOME", dir);
  vi.stubEnv("CLAUDE_CONFIG_DIR", dir);
  const owner = join(dir, "desktop-owner.json");
  writeFileSync(owner, JSON.stringify({ desktopDirectory: dir }));
  const profiles = join(dir, "provider-accounts");
  mkdirSync(join(profiles, "codex", "work"), { recursive: true });
  writeFileSync(
    join(profiles, "accounts.json"),
    JSON.stringify({ codex: [{ id: "work", label: "Work" }] }),
  );
  return { dir, owner, profiles };
}
it("resolves only new default selections and rejects removed/corrupt defaults", () => {
  const { owner, profiles } = fixture();
  expect(resolveDefaultAccount(owner, "codex")).toBeUndefined();
  writeFileSync(
    join(profiles, "defaults.json"),
    JSON.stringify({ codex: "work" }),
  );
  expect(resolveDefaultAccount(owner, "codex")).toBe("work");
  expect(resolveDefaultAccount(owner, "codex", "work")).toBe("work");
  expect(resolveDefaultAccount(owner, "codex", "default")).toBeUndefined();
  expect(resolveDefaultAccount(owner, "pi")).toBeUndefined();
  writeFileSync(join(profiles, "accounts.json"), "{}");
  expect(() => resolveDefaultAccount(owner, "codex")).toThrow(
    "no longer available",
  );
  expect(desktopProviderAccounts(owner).codex?.[0].defaultError).toBeTruthy();
  writeFileSync(join(profiles, "defaults.json"), "invalid");
  expect(() => resolveDefaultAccount(owner, "codex")).toThrow(
    "Invalid shared account defaults",
  );
});
it("publishes public identity from the actual Host profile and the configured named default", () => {
  const { dir, owner, profiles } = fixture();
  const host = join(dir, "host-login");
  mkdirSync(host);
  vi.stubEnv("CODEX_HOME", host);
  const auth = (email: string) =>
    JSON.stringify({
      tokens: {
        id_token: `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.x`,
        refresh_token: "never-publish",
      },
    });
  writeFileSync(join(host, "auth.json"), auth("host@example.test"));
  writeFileSync(
    join(profiles, "codex", "work", "auth.json"),
    auth("work@example.test"),
  );
  writeFileSync(
    join(profiles, "defaults.json"),
    JSON.stringify({ codex: "work" }),
  );
  const accounts = desktopProviderAccounts(owner);
  expect(accounts.codex?.[0]).toMatchObject({
    id: "default",
    identity: { email: "host@example.test" },
    defaultAccountId: "work",
    defaultAccountLabel: "Work",
    defaultIdentity: { email: "work@example.test" },
  });
  expect(JSON.stringify(accounts)).not.toContain("never-publish");
  expect(JSON.stringify(accounts)).not.toContain(profiles);
});

it.each(["work", "default"])("reads %s identity from custom Homes without exposing paths and rejects invalid Homes", accountId => {
  const { dir, owner, profiles } = fixture();
  const codex = join(dir, "external-codex"), claude = join(dir, "external-claude");
  mkdirSync(codex); mkdirSync(claude);
  writeFileSync(join(codex, "auth.json"), JSON.stringify({ tokens: { id_token: `x.${Buffer.from(JSON.stringify({ email: "custom@example.test" })).toString("base64url")}.x` } }));
  writeFileSync(join(claude, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "claude@example.test" } }));
  writeFileSync(join(profiles, "accounts.json"), JSON.stringify({ codex: [{ id: accountId, label: "Work", dataHome: codex }], claude: [{ id: accountId, label: "Work", dataHome: claude }] }));
  if (accountId === "default") vi.stubEnv("OPENAI_API_KEY", "inherited");
  const accounts = desktopProviderAccounts(owner);
  expect(accounts.codex?.find(account => account.id === accountId)?.identity?.email).toBe("custom@example.test");
  expect(accounts.claude?.find(account => account.id === accountId)?.identity?.email).toBe("claude@example.test");
  expect(JSON.stringify(accounts)).not.toContain("external-");
  const home = () => accountId === "default" ? defaultProviderAccountHome(dir, "codex") : namedProviderAccountHome(dir, "codex", accountId);
  expect(home()).toBe(codex);
  writeFileSync(join(profiles, "accounts.json"), JSON.stringify({ codex: [{ id: accountId, label: "Work", dataHome: "relative" }] }));
  expect(home).toThrow("Invalid provider account Data Home");
});

it("does not silently use the CLI login when an existing desktop account configuration is unreadable", () => {
  const { owner } = fixture();
  writeFileSync(owner, "invalid");
  expect(() => resolveDefaultAccount(owner, "codex")).toThrow("Invalid desktop account configuration");
});
