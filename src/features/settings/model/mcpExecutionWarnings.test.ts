// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryClient } from "../../../shared/lib/queryClient";
import type { HostSession } from "../../connections/model/protocol";
import { useMcpExecutionWarnings } from "./mcpExecutionWarnings";

vi.mock("../../connections/model/connections", () => ({
  knownRemoteMachine: () => ({ id: "host" }), REMOTE_MACHINES_CHANGED: "machines-changed",
}));
vi.mock("../../connections/model/remoteProjects", () => ({
  remoteProjectFor: (cwd: string) => ({ projectId: cwd, environmentId: "environment" }), REMOTE_PROJECTS_CHANGED: "projects-changed",
}));

let container: HTMLDivElement;
let root: Root;
function View({ cwd }: { cwd: string }) {
  return createElement("div", null, useMcpExecutionWarnings(cwd).join("\n"));
}
function cache(id: string, warnings: string[] | undefined, options: { host?: string; project?: string; account?: string; time?: number } = {}) {
  queryClient.setQueryData(["remoteSession", "snapshot", options.host ?? "host", id], {
    projectId: options.project ?? "/repo", executionWarnings: warnings,
    session: { cwd: "/repo", harness: "codex", providerAccountId: options.account },
  } as HostSession, { updatedAt: options.time ?? 1 });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  queryClient.clear();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  vi.unstubAllGlobals();
});

it("shows only configuration notices for the selected project and Host", async () => {
  cache("one", ["MCP: node_repl", "Hook: notify", "Imported history"]);
  cache("elsewhere", ["MCP: other-project"], { project: "/other" });
  cache("another-host", ["MCP: other-host"], { host: "another" });
  await act(async () => root.render(createElement(View, { cwd: "/repo" })));
  expect(container.textContent).toBe("Hook: notify\nMCP: node_repl");
  await act(async () => root.render(createElement(View, { cwd: "/other" })));
  expect(container.textContent).toBe("MCP: other-project");
});

it("updates from the newest account snapshot, clears resolved notices, and deduplicates accounts", async () => {
  cache("old", ["MCP: obsolete"]);
  cache("new", ["MCP: current"], { time: 2 });
  cache("named", ["MCP: current", "Hook: notify"], { account: "named" });
  cache("unstarted-draft", undefined, { time: 4 });
  await act(async () => root.render(createElement(View, { cwd: "/repo" })));
  expect(container.textContent).toBe("Hook: notify\nMCP: current");
  await act(async () => {
    cache("new", [], { time: 3 });
    cache("named", [], { account: "named", time: 3 });
  });
  expect(container.textContent).toBe("");
});
