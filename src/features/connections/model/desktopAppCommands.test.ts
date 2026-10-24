// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { consumeDesktopAppCommands } from "./desktopAppCommands";
import type { DesktopAppCommand } from "../../../contracts/app";
const mocks = vi.hoisted(() => ({ request: vi.fn(), describe: vi.fn() }));
vi.mock("./connections", () => ({ remoteRequest: mocks.request }));
vi.mock("./remoteHostMetadata", () => ({ loadRemoteHostDescriptor: mocks.describe }));
const machine = { id: "machine", environmentId: "env", name: "Host", endpoint: "http://localhost" };
const command: DesktopAppCommand = { id: "request", sourceSessionId: "source", sessionId: "target", projectId: "project", action: "sessions.reveal", reveal: true };
beforeEach(() => { vi.clearAllMocks(); mocks.describe.mockResolvedValue({ capabilities: ["app.desktopCommands.v1"] }); });
it("claims only this window's sessions and replays the same presentation receipt once", async () => {
  let polls = 0;
  mocks.request.mockImplementation(async (_machine, method) => {
    if (method === "app.commands.poll") return ++polls <= 2 ? { commands: [command] } : new Promise(() => {});
    return { ok: true };
  });
  const handle = vi.fn(async () => ({ tabId: "tab" }));
  const stop = consumeDesktopAppCommands(machine, "window", () => ["source"], handle);
  try {
    await vi.waitFor(() => expect(mocks.request.mock.calls.filter(([, method]) => method === "app.commands.complete")).toHaveLength(2));
    expect(handle).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledWith("machine", "app.commands.poll", { windowId: "window", sessionIds: ["source"], waitMs: 25_000 });
    expect(mocks.request).toHaveBeenCalledWith("machine", "app.commands.complete", { windowId: "window", id: "request", response: { ok: true, result: { tabId: "tab" } } });
  } finally { stop(); }
});
it("does not execute a lease delivery received after the window closes", async () => {
  let finish!: (value: unknown) => void;
  mocks.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const handle = vi.fn(); const stop = consumeDesktopAppCommands(machine, "window", () => ["source"], handle);
  await vi.waitFor(() => expect(mocks.request).toHaveBeenCalled());
  stop(); finish({ commands: [command] }); await Promise.resolve(); await Promise.resolve();
  expect(handle).not.toHaveBeenCalled(); expect(mocks.request).toHaveBeenCalledTimes(1);
});
it("does not poll a Host without desktop delivery capabilities", async () => {
  mocks.describe.mockResolvedValue({ capabilities: [] });
  const stop = consumeDesktopAppCommands(machine, "window", () => ["source"], vi.fn());
  await Promise.resolve(); await Promise.resolve(); stop();
  expect(mocks.request).not.toHaveBeenCalled();
});
