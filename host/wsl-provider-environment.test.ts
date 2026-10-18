import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { wslSharedProviderEnvironment } from "./wsl-provider-environment";

const home = resolve("fixture-desktop-home");
const mapped: string[] = [];
const rpc = { request: async <T>(_op: string, params?: Record<string, unknown>): Promise<T> => {
  const path = (params?.args as string[])[2]; mapped.push(path);
  return { code: 0, stdout: `/mounted/${mapped.length}\n` } as T;
} };

it("maps the desktop Pi account and session directories while removing WSL overrides", async () => {
  mapped.length = 0;
  const result = await wslSharedProviderEnvironment("pi", rpc, { home, env: {} });
  expect(mapped).toContain(join(home, ".pi/agent"));
  expect(result.PI_CODING_AGENT_DIR).toBe(`/mounted/${mapped.indexOf(join(home, ".pi/agent")) + 1}`);
  expect(result.PI_CODING_AGENT_SESSION_DIR).toBeNull();
});

it.each(["omp", "cursor", "grok", "fx", "hermes", "antigravity"])("rejects %s before any RPC when desktop account/session sharing is unsupported", async provider => {
  mapped.length = 0;
  await expect(wslSharedProviderEnvironment(provider, rpc, { home, env: {} })).rejects.toThrow("cannot use the shared WSL Host yet");
  expect(mapped).toEqual([]);
});

it("shares OpenCode data and configuration while leaving executable caches in Linux", async () => {
  mapped.length = 0;
  const result = await wslSharedProviderEnvironment("opencode", rpc, { home, env: {} });
  expect(mapped.slice(-3)).toEqual([join(home, ".local/share"), join(home, ".config"), join(home, ".local/state")]);
  expect(result).toMatchObject({ XDG_DATA_HOME: "/mounted/4", XDG_CONFIG_HOME: "/mounted/5", OPENCODE_CONFIG: null, OPENCODE_TEST_HOME: null });
  expect(result).not.toHaveProperty("XDG_CACHE_HOME");
});

it.each(["pi", "opencode"])("uses desktop %s credential variables and files without changing the Linux tool user", async provider => {
  mapped.length = 0;
  const credentials = join(home, "desktop-auth.json");
  const result = await wslSharedProviderEnvironment(provider, rpc, { home, env: {
    OPENAI_API_KEY: "desktop-key", GOOGLE_APPLICATION_CREDENTIALS: credentials, AWS_PROFILE: "work",
    HOME: "ignored-desktop-home", PATH: "ignored-desktop-path", UNRELATED_TOOL_TOKEN: "untouched",
  } });
  expect(result).toMatchObject({ OPENAI_API_KEY: "desktop-key", ANTHROPIC_API_KEY: null, COPILOT_GITHUB_TOKEN: null,
    AWS_PROFILE: "work", AWS_ACCESS_KEY_ID: null, AWS_EC2_METADATA_DISABLED: "true", GOOGLE_APPLICATION_CREDENTIALS: "/mounted/1" });
  expect(mapped.slice(0, 3)).toEqual([credentials, join(home, ".aws/credentials"), join(home, ".aws/config")]);
  for (const key of ["HOME", "PATH", "UNRELATED_TOOL_TOKEN"]) expect(result).not.toHaveProperty(key);
  if (provider === "pi") expect(result).not.toHaveProperty("GITHUB_TOKEN");
});

it.each(["claude", "codex"])("maps the selected %s catalog home without requiring account files", async provider => {
  mapped.length = 0;
  const dataHome = join(home, "nonexistent-account");
  const result = await wslSharedProviderEnvironment(provider, rpc, { home, dataHome, env: {} });
  expect(mapped).toEqual([dataHome]);
  expect(result[provider === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME"]).toBe("/mounted/1");
});
