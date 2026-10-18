import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { McpConnection } from "./mcp";
import {
  clearMcpSettingsCache,
  getCachedMcpSettings,
  loadMcpSettings,
  subscribeMcpSettings,
} from "./mcpSettingsCache";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const configured: McpConnection[] = [
  {
    provider: "claude",
    name: "docs",
    scope: "project",
    configPath: "/repo/.mcp.json",
    transport: "stdio",
  },
];

beforeEach(() => {
  clearMcpSettingsCache();
  invoke.mockReset();
});
afterEach(clearMcpSettingsCache);

it("publishes discovery before slow health and shares both requests across consumers", async () => {
  let resolveHealth!: (output: string) => void;
  invoke.mockImplementation((command: string) =>
    command === "mcp_discover"
      ? Promise.resolve(configured)
      : new Promise((resolve) => {
          resolveHealth = resolve;
        }),
  );
  const onChange = vi.fn();
  const stop = subscribeMcpSettings("/repo", onChange);
  try {
    const [picker, settings] = await Promise.all([
      loadMcpSettings("/repo", false, { claudeHealth: false }),
      loadMcpSettings("/repo"),
    ]);
    expect(picker.servers[0].status).toBe("Configured");
    expect(settings.servers[0].name).toBe("docs");
    expect(invoke).toHaveBeenCalledTimes(2);
    await loadMcpSettings("/repo");
    expect(invoke).toHaveBeenCalledTimes(2);
    resolveHealth(
      "docs: local - Connected\nremote: https://example.com - Needs authentication",
    );
    await vi.waitFor(() =>
      expect(getCachedMcpSettings("/repo")?.servers).toHaveLength(2),
    );
    expect(onChange.mock.calls.at(-1)?.[0].servers[0].status).toBe("Connected");
  } finally {
    stop();
  }
});

it("loads non-Claude pickers without running Claude and lets a later Claude consumer request health", async () => {
  invoke.mockImplementation(async (command: string) =>
    command === "mcp_discover" ? configured : "docs: local - Connected",
  );
  await loadMcpSettings("/repo", false, { claudeHealth: false });
  await loadMcpSettings("/repo", false, { claudeHealth: false });
  expect(invoke).toHaveBeenCalledTimes(1);
  await loadMcpSettings("/repo");
  await vi.waitFor(() =>
    expect(getCachedMcpSettings("/repo")?.servers[0].status).toBe("Connected"),
  );
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("ignores health from a request superseded by refresh", async () => {
  const health: ((output: string) => void)[] = [];
  invoke.mockImplementation((command: string) =>
    command === "mcp_discover"
      ? Promise.resolve(configured)
      : new Promise((resolve) => {
          health.push(resolve);
        }),
  );
  await loadMcpSettings("/repo");
  await loadMcpSettings("/repo", true);
  health[1]("docs: local - Connected");
  await vi.waitFor(() =>
    expect(getCachedMcpSettings("/repo")?.servers[0].status).toBe("Connected"),
  );
  health[0]("docs: local - Failed\nstale: local - Connected");
  await Promise.resolve();
  expect(
    getCachedMcpSettings("/repo")?.servers.map((server) => server.name),
  ).toEqual(["docs"]);
  expect(getCachedMcpSettings("/repo")?.servers[0].status).toBe("Connected");
});

it("keeps configured rows when health fails and preserves disabled status", async () => {
  invoke.mockImplementation((command: string) =>
    command === "mcp_discover"
      ? Promise.resolve([{ ...configured[0], enabled: false }])
      : Promise.reject(new Error("Health unavailable")),
  );
  await loadMcpSettings("/repo");
  await vi.waitFor(() =>
    expect(getCachedMcpSettings("/repo")?.claudeError).toContain(
      "Health unavailable",
    ),
  );
  expect(getCachedMcpSettings("/repo")?.servers[0].status).toBe("Disabled");
  expect(getCachedMcpSettings("/repo")?.error).toBe("");
});

const pi = {
  ...configured[0],
  provider: "pi" as const,
  transport: "http",
  configPath: "/home/.pi/agent/mcp.json",
  scope: "user" as const,
};
const piReport = (state: string) => ({
  servers: [
    {
      name: "docs",
      scope: "global",
      source: pi.configPath,
      enabled: true,
      state,
      toolCount: 3,
    },
  ],
  errors: [],
});

it("shares background Pi health without blocking discovery or another provider's health", async () => {
  let resolvePi!: (output: unknown) => void;
  invoke.mockImplementation((command: string) => {
    if (command === "mcp_discover") return Promise.resolve([pi, ...configured]);
    if (command === "pi_mcp_list")
      return new Promise((resolve) => {
        resolvePi = resolve;
      });
    return Promise.resolve("docs: local - Connected");
  });
  const snapshot = await loadMcpSettings("/repo");
  expect(snapshot.servers[0].nativeState).toBe("checking");
  await loadMcpSettings("/repo");
  expect(
    invoke.mock.calls.filter(([cmd]) => cmd === "pi_mcp_list"),
  ).toHaveLength(1);
  resolvePi(piReport("connected"));
  await vi.waitFor(() =>
    expect(getCachedMcpSettings("/repo")?.servers[0]).toMatchObject({
      nativeState: "connected",
      toolCount: 3,
    }),
  );
  expect(getCachedMcpSettings("/repo")?.servers[1].status).toBe("Connected");
});

it("runs Pi health only for consumers that request it and ignores stale refreshes", async () => {
  const resolvers: ((output: unknown) => void)[] = [];
  invoke.mockImplementation((command: string) =>
    command === "mcp_discover"
      ? Promise.resolve([pi])
      : new Promise((resolve) => {
          resolvers.push(resolve);
        }),
  );
  await loadMcpSettings("/repo", false, {
    claudeHealth: false,
    piHealth: false,
  });
  expect(invoke).toHaveBeenCalledTimes(1);
  await loadMcpSettings("/repo", false, {
    claudeHealth: false,
    piHealth: true,
  });
  await loadMcpSettings("/repo", true, { claudeHealth: false, piHealth: true });
  resolvers[1](piReport("connected"));
  await vi.waitFor(() =>
    expect(getCachedMcpSettings("/repo")?.servers[0].nativeState).toBe(
      "connected",
    ),
  );
  resolvers[0](piReport("needs-auth"));
  await Promise.resolve();
  expect(getCachedMcpSettings("/repo")?.servers[0].nativeState).toBe(
    "connected",
  );
});

it("preserves Pi rows and disabled configuration when its CLI cannot report health", async () => {
  invoke.mockImplementation((command: string) =>
    command === "mcp_discover"
      ? Promise.resolve([pi, { ...pi, name: "disabled", enabled: false }])
      : Promise.reject(new Error("Pi CLI not found")),
  );
  await loadMcpSettings("/repo", false, { claudeHealth: false });
  await vi.waitFor(() =>
    expect(getCachedMcpSettings("/repo")?.piError).toContain(
      "Pi CLI not found",
    ),
  );
  expect(
    getCachedMcpSettings("/repo")?.servers.map((server) => server.nativeState),
  ).toEqual(["unavailable", "disabled"]);
  expect(getCachedMcpSettings("/repo")?.error).toBe("");
});

it("retains Pi's trust note and configuration diagnostics with useful server states", async () => {
  invoke.mockImplementation(async (command: string) =>
    command === "mcp_discover"
      ? [pi]
      : {
          ...piReport("needs-auth"),
          errors: ["Config error"],
          note: "Project is not trusted",
        },
  );
  await loadMcpSettings("/repo", false, { claudeHealth: false });
  await vi.waitFor(() =>
    expect(getCachedMcpSettings("/repo")?.servers[0].nativeState).toBe(
      "needs-auth",
    ),
  );
  expect(getCachedMcpSettings("/repo")?.piError).toContain("Config error");
  expect(getCachedMcpSettings("/repo")?.piError).toContain(
    "Project is not trusted",
  );
});
