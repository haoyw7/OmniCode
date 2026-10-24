import { afterEach, expect, it, vi } from "vitest";
import { CommandOutcomeClient } from "./commandOutcome";

afterEach(() => vi.useRealTimers());

it("shares completion observations and retries disconnects without reading a transcript", async () => {
  vi.useFakeTimers();
  const outcome = { status: "completed", text: "done" };
  const request = vi.fn().mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ sessionId: "session", commandId: "command", revision: 1 })
    .mockResolvedValueOnce({ sessionId: "session", commandId: "command", revision: 2, outcome });
  const client = new CommandOutcomeClient({ key: (target: string) => target, request });
  const first = client.wait("host", "session", "command");
  expect(client.wait("host", "session", "command")).toBe(first);
  await vi.advanceTimersByTimeAsync(1_500);
  expect(await first).toEqual(outcome);
  expect(request.mock.calls).toEqual(Array.from({ length: 3 }, () => ["host", "commands.outcome", { sessionId: "session", commandId: "command" }]));
});

it("rejects unsupported old Hosts once and releases the observer for later reconnect", async () => {
  const request = vi.fn().mockRejectedValue(new Error("Host rejected request: Unsupported host method"));
  const client = new CommandOutcomeClient({ key: (target: string) => target, request });
  await expect(client.wait("host", "session", "command")).rejects.toThrow("Unsupported host method");
  expect(request).toHaveBeenCalledTimes(1);
  const outcome = { status: "failed", text: "", error: "stopped" };
  request.mockResolvedValue({ sessionId: "session", commandId: "command", revision: 2, outcome });
  expect(await client.wait("host", "session", "command")).toEqual(outcome);
});
