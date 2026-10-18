import { expect, it } from "vitest";
import {
  mcpContextText,
  mcpPickerServers,
  mcpTagParts,
  newMcpTag,
  taggedMcpServers,
} from "./mcpPicker";
import type { McpConnection } from "../../settings/model/mcp";

const servers: McpConnection[] = [
  {
    provider: "cursor",
    name: "other",
    scope: "user",
    configPath: "/cursor",
    transport: "stdio",
  },
  {
    provider: "claude",
    name: "needs-login",
    scope: "user",
    configPath: "/claude",
    transport: "http",
  },
  {
    provider: "claude",
    name: "docs",
    scope: "project",
    configPath: "/repo/.mcp.json",
    transport: "stdio",
  },
];

it("prioritizes usable servers while retaining authentication and other providers", () => {
  const ranked = mcpPickerServers(
    servers,
    "claude",
    new Map([["needs-login", "Needs authentication"]]),
    "",
  );
  expect(ranked.map((server) => [server.name, server.availability])).toEqual([
    ["docs", "available"],
    ["needs-login", "authentication"],
    ["other", "unavailable"],
  ]);
  expect(
    mcpPickerServers(servers, "claude", new Map(), "cursor").map(
      (server) => server.name,
    ),
  ).toEqual(["other"]);
});

it("adds only selected server names to outgoing context", () => {
  expect(mcpContextText([servers[2]], "Find the docs")).toContain(
    '"docs" (claude)',
  );
  expect(mcpContextText([], "Find the docs")).toBe("Find the docs");
});

it("makes disabled provider entries unselectable even when health says Connected", () => {
  for (const provider of ["claude", "codex", "opencode", "pi"] as const) {
    const [server] = mcpPickerServers(
      [{ ...servers[2], provider, enabled: false }],
      provider,
      new Map([["docs", "Connected"]]),
      "",
    );
    expect(server.availability).toBe("unavailable");
    expect(server.detail).toBe("Disabled in provider configuration");
  }
});

it("offers Pi servers only to Pi sessions", () => {
  const pi: McpConnection = { ...servers[2], provider: "pi" };
  expect(mcpPickerServers([pi], "pi", new Map(), "Pi")[0].availability).toBe(
    "available",
  );
  expect(mcpPickerServers([pi], "omp", new Map(), "")[0].availability).toBe(
    "unavailable",
  );
});

it.each([
  "needs-auth",
  "failed",
  "disabled",
  "checking",
  "not-loaded",
  "overridden",
  "unavailable",
  "disconnected",
  "closed",
] as const)("uses Pi native %s in the picker", (nativeState) => {
  const [server] = mcpPickerServers(
    [{ ...servers[2], provider: "pi", nativeState }],
    "pi",
    new Map(),
    "",
  );
  expect(server.availability).toBe(
    nativeState === "needs-auth" ? "authentication" : "unavailable",
  );
});

it("keeps connected Pi entries selectable and ignores their health for another provider", () => {
  const pi: McpConnection = {
    ...servers[2],
    provider: "pi",
    nativeState: "connected",
  };
  expect(mcpPickerServers([pi], "pi", new Map(), "")[0].availability).toBe(
    "available",
  );
  expect(mcpPickerServers([pi], "omp", new Map(), "")[0].availability).toBe(
    "unavailable",
  );
});

it("uses Pi's effective enablement after a trusted project enables a disabled global server", () => {
  const pi: McpConnection = {
    ...servers[2],
    provider: "pi",
    enabled: false,
    nativeState: "connected",
  };
  expect(mcpPickerServers([pi], "pi", new Map(), "")[0].availability).toBe(
    "available",
  );
});

it("keeps MCP references inline and only uses tags still in the draft", () => {
  const docs = newMcpTag(servers[2], []);
  const anotherDocs = newMcpTag({ ...servers[2], provider: "cursor" }, [docs]);
  expect(docs.token).toBe("@mcp/docs");
  expect(anotherDocs.token).toBe("@mcp/cursor/docs");
  const text = `Ask ${docs.token} about this, then ${anotherDocs.token}.`;
  expect(
    mcpTagParts(text, [docs, anotherDocs]).filter((part) => part.tag),
  ).toHaveLength(2);
  expect(taggedMcpServers(text, [docs, anotherDocs])).toHaveLength(2);
  expect(taggedMcpServers(`Ask ${docs.token}2 about this`, [docs])).toEqual([]);
  expect(taggedMcpServers("Ask about this", [docs])).toEqual([]);
});
