// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { pendingRemoteCommand, pendingRemoteFollowup, savePendingRemoteCommand, remotePendingExecutionCwd, rememberRemotePendingExecutionCwd, dispatchRemoteCommand, remoteSessionFor } from "./connections";
import { loadRemoteOutbox } from "../../../platform/tauri/remoteOutbox";
import type { HostCommand } from "../../../contracts/protocol";

const native = vi.hoisted(() => ({ rows: new Map<string, string>(), fail: false, dispatch: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => undefined),
  listen: vi.fn(async () => () => undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args: { key: string; entry: string; keys: string[] }) => {
    if (command === "remote_request") return native.dispatch(args);
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
  native.dispatch.mockReset();
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

it("binds a created conversation before a lost first-message receipt and preserves that command", async () => {
  native.dispatch.mockImplementation(async ({ params }: { params: HostCommand }) => {
    if (params.type === "send") throw new Error("connection lost");
    return { commandId: params.commandId, sessionId: "created", revision: 1 };
  });
  await expect(dispatchRemoteCommand("machine", "project", "env", create, "shell", followup)).rejects.toThrow("connection lost");
  expect(remoteSessionFor("shell")).toBe("created");
  expect(pendingRemoteCommand("project", "env", "created", "shell")).toEqual({ ...followup, sessionId: "created" });
  expect(native.rows.size).toBe(1);
});

it("journals a deferred first message and clears an unsupported command instead of replaying forever", async () => {
  native.dispatch.mockResolvedValueOnce({ commandId: create.commandId, sessionId: "created", revision: 1 });
  await dispatchRemoteCommand("machine", "project", "env", create, "shell", followup, { deferFollowup: true });
  expect(native.dispatch).toHaveBeenCalledTimes(1);
  const saved = pendingRemoteCommand("project", "env", "created", "shell")!;
  expect(saved).toEqual({ ...followup, sessionId: "created" });
  native.dispatch.mockRejectedValueOnce(new Error("Host rejected request: Unsupported command"));
  await expect(dispatchRemoteCommand("machine", "project", "env", saved, "shell")).rejects.toThrow("Unsupported command");
  expect(pendingRemoteCommand("project", "env", "created", "shell")).toBeUndefined();
  expect(native.rows.size).toBe(0);
});

it("migrates an old pending create without losing its execution directory", async () => {
  const key = `omnicode.remote-command.v1:${JSON.stringify(["project", "env"])}:create-1`;
  native.rows.set(key, JSON.stringify({ ...create, worktreeCwd: "/repo/subdir" }));
  await loadRemoteOutbox();
  const command = pendingRemoteCommand("project", "env");
  expect(command).toMatchObject({ type: "create", executionCwd: "/repo/subdir" });
  expect(command).not.toHaveProperty("worktreeCwd");
});

it("moves the saved pending-directory selection to the execution-directory key", () => {
  localStorage.setItem("omnicode.remote-pending-worktrees.v1", JSON.stringify({ shell: "/repo/subdir" }));
  expect(remotePendingExecutionCwd("shell")).toBe("/repo/subdir");
  expect(localStorage.getItem("omnicode.remote-pending-worktrees.v1")).toBeNull();
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
  const key = 'omnicode.remote-command.v1:["project","env"]:create-1';
  localStorage.setItem(key, JSON.stringify(create));
  await loadRemoteOutbox();
  expect(pendingRemoteCommand("project", "env", null, "first-tab")).toEqual(
    create,
  );
  expect(native.rows.get(key)).toBe(JSON.stringify(create));
  expect(localStorage.getItem(key)).toBeNull();
});
