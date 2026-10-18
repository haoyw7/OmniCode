// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import {
  OrchestrationClient,
  type OrchestrationSource,
} from "./orchestrationClient";
import type { HostSession } from "../../connections/model/protocol";

vi.mock("../../connections/model/connections", () => ({
  rememberRemoteSession: vi.fn(),
}));
beforeEach(() => localStorage.clear());
const source = (
  environmentId: string,
  projectId = "project",
): OrchestrationSource => ({
  machineId: environmentId,
  project: {
    key: `remote://${environmentId}/repo`,
    environmentId,
    projectId,
    cwd: "/repo",
  },
});
const snapshot = (projectId = "project", revision = 1): HostSession => ({
  projectId,
  revision,
  status: "idle",
  updatedAt: 1,
  session: {
    id: "lead",
    cwd: "/repo",
    harness: "codex",
    model: "model",
    runtimeMode: "supervised",
    blocks: [],
    title: "lead",
  },
  orchestration: {
    id: "run",
    leadId: "lead",
    cwd: "/repo",
    status: "paused",
    allowedHarnesses: ["codex"],
    maxWorkers: 2,
    workspace: {
      id: "checkout:/repo",
      projectCwd: "/repo",
      checkoutCwd: "/repo",
      kind: "main",
    },
    tasks: [
      {
        id: "task",
        sessionId: "worker",
        title: "task",
        harness: "codex",
        model: "model",
        status: "interrupted",
      },
    ],
  },
});

it("isolates identical lead and worker IDs across Host environments and projects", () => {
  const client = new OrchestrationClient();
  for (const entry of [source("one"), source("two"), source("one", "other")])
    client.accept(entry, snapshot(entry.project.projectId));
  const runs = client.snapshot();
  expect(new Set(runs.map((run) => run.leadId)).size).toBe(3);
  expect(new Set(runs.map((run) => run.tasks[0].sessionId)).size).toBe(3);
  expect(runs[0].workspace?.checkoutCwd).toBe("remote://one/repo");
  expect(runs[1].workspace?.checkoutCwd).toBe("remote://two/repo");
});

it("rejects stale revisions and wrong project snapshots without losing current state", () => {
  const client = new OrchestrationClient();
  const entry = source("one");
  client.accept(entry, snapshot("project", 3));
  const current = client.snapshot();
  client.accept(entry, { ...snapshot("project", 2), orchestration: undefined });
  client.accept(entry, snapshot("other", 4));
  expect(client.snapshot()).toBe(current);
  client.accept(entry, { ...snapshot("project", 4), orchestration: undefined });
  expect(client.snapshot()).toEqual([]);
});

it("binds worker details to shell identities while keeping Host command references", () => {
  const client = new OrchestrationClient();
  const entry = source("one");
  client.bindShell(entry, "lead", "open-shell");
  client.accept(entry, snapshot());
  const run = client.snapshot()[0];
  expect(run.leadId).toBe("open-shell");
  expect(client.reference(run.tasks[0].sessionId)).toMatchObject({
    sessionId: "worker",
    leadId: "lead",
    project: { environmentId: "one" },
  });
  client.retire("two", ["lead", "worker"]);
  expect(client.snapshot()).toHaveLength(1);
  client.retire("one", ["lead", "worker"]);
  expect(client.snapshot()).toEqual([]);
});
