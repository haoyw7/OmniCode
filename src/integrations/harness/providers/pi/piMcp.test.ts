import { expect, it } from "vitest";
import { piMcpHealth, type PiMcpList } from "./piMcp";
import type { McpConnection } from "../../../../features/settings/model/mcp";

const server: McpConnection = {
  provider: "pi",
  name: "docs",
  scope: "user",
  configPath: "/home/.pi/agent/mcp.json",
  transport: "http",
};
const list: PiMcpList = {
  servers: [
    {
      name: "docs",
      scope: "global",
      source: server.configPath,
      enabled: true,
      state: "connected",
      toolCount: 3,
    },
  ],
  errors: [],
};

it.each([
  ["connected", "Connected"],
  ["needs-auth", "Needs authentication"],
  ["failed", "Connection failed"],
  ["disabled", "Disabled"],
  ["connecting", "Connecting"],
  ["disconnected", "Disconnected"],
  ["closed", "Closed"],
  ["future-state", "Status unavailable"],
])(
  "normalizes native %s without inferring authentication from HTTP",
  (state, status) => {
    const result = piMcpHealth(server, {
      ...list,
      servers: [{ ...list.servers[0], state }],
    });
    expect(result.status).toBe(status);
    expect(result.nativeState).toBe(
      state === "future-state" ? "unavailable" : state,
    );
    expect(result.toolCount).toBe(state === "connected" ? 3 : undefined);
  },
);

it("retains native error details separately from translated labels", () => {
  expect(
    piMcpHealth(server, {
      ...list,
      servers: [
        { ...list.servers[0], state: "failed", error: "Provider detail" },
      ],
    }).statusDetail,
  ).toBe("Provider detail");
});

it("does not give an untrusted project entry the global connection's health", () => {
  expect(
    piMcpHealth(
      { ...server, scope: "project", configPath: "/repo/.pi/mcp.json" },
      list,
    ),
  ).toMatchObject({ nativeState: "not-loaded" });
  expect(
    piMcpHealth(
      {
        ...server,
        name: "project-only",
        scope: "project",
        configPath: "/repo/.pi/mcp.json",
      },
      list,
    ),
  ).toMatchObject({ nativeState: "not-loaded" });
});

it("applies a project replacement only to its native source", () => {
  const project = {
    ...server,
    scope: "project" as const,
    configPath: "/repo/.pi/mcp.json",
  };
  const replacement = {
    ...list,
    servers: [
      { ...list.servers[0], scope: "project", source: project.configPath },
    ],
  };
  expect(piMcpHealth(project, replacement).nativeState).toBe("connected");
  expect(piMcpHealth(server, replacement).nativeState).toBe("overridden");
});

it("keeps native effective state when a project disables a global entry", () => {
  const disabled = {
    ...list,
    servers: [
      {
        ...list.servers[0],
        enabled: false,
        state: "disabled",
        override: "/repo/.pi/mcp.json",
      },
    ],
  };
  expect(piMcpHealth(server, disabled).nativeState).toBe("disabled");
  expect(
    piMcpHealth(
      { ...server, scope: "project", configPath: "/repo/.pi/mcp.json" },
      disabled,
    ).nativeState,
  ).toBe("overridden");
});
