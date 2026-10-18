// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import {
  pendingRemoteCommand,
  pendingRemoteFollowup,
  savePendingRemoteCommand,
  remotePendingExecutionCwd,
  rememberRemotePendingExecutionCwd,
} from "./connections";
import { loadRemoteOutbox } from "./remoteOutbox";
import type { HostCommand } from "./protocol";

const native = vi.hoisted(() => ({ rows: new Map<string, string>(), fail: false }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => undefined),
  listen: vi.fn(async () => () => undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args: { key: string; entry: string; keys: string[] }) => {
    if (command === "remote_outbox_list") return [...native.rows];
    if (native.fail) throw new Error("disk full");
    if (command === "remote_outbox_put") native.rows.set(args.key, args.entry);
    if (command === "remote_outbox_delete") for (const key of args.keys) native.rows.delete(key);
  }),
}));

beforeEach(async () => {
  localStorage.clear();
  native.rows.clear();
  native.fail = false;
  await loadRemoteOutbox();
});
const create: HostCommand = {
  type: "create",
  commandId: "create-1",
  projectId: "p",
  harness: "codex",
  model: "test",
  runtimeMode: "supervised",
};
const followup: HostCommand = {
  type: "send",
  commandId: "send-1",
  sessionId: "",
  text: "First message",
};

it("migrates an old pending create without losing its execution directory", async () => {
  const key = `monocode.remote-command.v1:${JSON.stringify(["project", "env"])}:create-1`;
  native.rows.set(key, JSON.stringify({ ...create, worktreeCwd: "/repo/subdir" }));
  await loadRemoteOutbox();
  const command = pendingRemoteCommand("project", "env");
  expect(command).toMatchObject({ type: "create", executionCwd: "/repo/subdir" });
  expect(command).not.toHaveProperty("worktreeCwd");
});

it("moves the saved pending-directory selection to the execution-directory key", () => {
  localStorage.setItem("monocode.remote-pending-worktrees.v1", JSON.stringify({ shell: "/repo/subdir" }));
  expect(remotePendingExecutionCwd("shell")).toBe("/repo/subdir");
  expect(localStorage.getItem("monocode.remote-pending-worktrees.v1")).toBeNull();
  rememberRemotePendingExecutionCwd("shell", "/repo");
  expect(remotePendingExecutionCwd("shell")).toBe("/repo");
});

it("isolates unfinished creates by tab and keeps their original first message on retry", async () => {
  await savePendingRemoteCommand("project", "env", create, "first-tab", followup);
  expect(
    pendingRemoteCommand("project", "env", null, "second-tab"),
  ).toBeUndefined();
  expect(pendingRemoteCommand("project", "env", null, "first-tab")).toEqual(
    create,
  );
  await savePendingRemoteCommand("project", "env", create, "first-tab");
  expect(pendingRemoteFollowup("project", "env", create.commandId)).toEqual(
    followup,
  );
});

it("persists natively and refuses to dispatch when the request cannot be saved", async () => {
  await savePendingRemoteCommand("project", "env", create, "first-tab");
  expect(native.rows.size).toBe(1);
  expect(localStorage.length).toBe(0);
  native.fail = true;
  await expect(
    savePendingRemoteCommand("project", "env", followup, "first-tab"),
  ).rejects.toThrow("Cannot save your request locally");
  expect(pendingRemoteCommand("project", "env", "", "first-tab")).toBeUndefined();
});

it("moves commands saved by the earlier desktop into native storage", async () => {
  const key = 'monocode.remote-command.v1:["project","env"]:create-1';
  localStorage.setItem(key, JSON.stringify(create));
  await loadRemoteOutbox();
  expect(pendingRemoteCommand("project", "env", null, "first-tab")).toEqual(
    create,
  );
  expect(native.rows.get(key)).toBe(JSON.stringify(create));
  expect(localStorage.getItem(key)).toBeNull();
});
