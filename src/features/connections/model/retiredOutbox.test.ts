// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { clearRetiredHostOutbox } from "./sharedHost";
import { forgetDeletedRemoteBindings, remoteSessionFor, rememberRemoteSession } from "./connections";
import { loadRemoteOutbox, outboxEntry } from "./remoteOutbox";
const native = vi.hoisted(() => new Map<string, string>());
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => undefined),
  listen: vi.fn(async () => () => undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args: { keys: string[] }) => {
    if (command === "remote_outbox_list") return [...native];
    if (command === "remote_outbox_delete") for (const key of args.keys) native.delete(key);
  }),
}));
beforeEach(() => {
  localStorage.clear();
  native.clear();
});

it("removes only retired local-Host commands, retaining uncertain unrelated requests", async () => {
  const key = (environment: string, id: string) => `monocode.remote-command.v1:${JSON.stringify(["/repo", environment])}:${id}`;
  native.set(key("local", "old"), JSON.stringify({ command: { sessionId: "old-lead" } }));
  native.set(key("other", "same"), JSON.stringify({ command: { sessionId: "old-lead" } }));
  native.set(key("local", "ordinary"), JSON.stringify({ command: { sessionId: "ordinary" } }));
  native.set(key("local", "malformed"), "invalid");
  await loadRemoteOutbox();
  clearRetiredHostOutbox("local", new Set(["old-lead"]));
  expect(outboxEntry(key("local", "old"))).toBeUndefined();
  await vi.waitFor(() => expect(native.has(key("local", "old"))).toBe(false));
  expect(outboxEntry(key("other", "same"))).toBeDefined();
  expect(outboxEntry(key("local", "ordinary"))).toBeDefined();
  expect(outboxEntry(key("local", "malformed"))).toBe("invalid");
});

it("retires a local shell without removing another Host's identical wire ID", () => {
  rememberRemoteSession("old-lead", "old-lead");
  rememberRemoteSession("other-host-shell", "old-lead");
  rememberRemoteSession("ordinary", "ordinary");
  forgetDeletedRemoteBindings(["old-lead"]);
  expect(remoteSessionFor("old-lead")).toBeUndefined();
  expect(remoteSessionFor("other-host-shell")).toBe("old-lead");
  expect(remoteSessionFor("ordinary")).toBe("ordinary");
});
