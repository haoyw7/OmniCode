// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryClient } from "../../../shared/lib/queryClient";
import { watchHostSession, type HostSessionLease } from "./workflowSessionWatch";
import { loadRemoteSession, remoteRequest } from "../../connections/model/connections";
import type { HostSession } from "../../connections/model/protocol";

vi.mock("../../connections/model/connections", () => ({
  loadRemoteSession: vi.fn(), remoteRequest: vi.fn(async () => ({})),
  remoteMachineFor: vi.fn(async () => ({ id: "host" })), remoteSessionFor: (id: string) => id,
}));
vi.mock("../../connections/model/remoteProjects", () => ({
  remoteProjectFor: (cwd: string) => ({ environmentId: "env", projectId: cwd }),
}));
let leases: HostSessionLease[];
const snapshot = (status = "idle", title = "Task") => ({
  status, revision: 1, runId: "run", session: { id: "child", title, blocks: [] },
}) as HostSession;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
beforeEach(() => { queryClient.clear(); vi.clearAllMocks(); vi.useFakeTimers(); leases = []; });
afterEach(() => { leases.forEach(lease => lease.release()); queryClient.clear(); vi.useRealTimers(); });
const acquire = (cwd = "/repo") => { const lease = watchHostSession(cwd, "child"); leases.push(lease); return lease; };

it("shares reads between leases, retains the snapshot offline, and stops when the last lease ends", async () => {
  const data = snapshot();
  vi.mocked(loadRemoteSession).mockResolvedValue(data);
  const first = acquire(), second = acquire();
  await flush();
  expect(loadRemoteSession).toHaveBeenCalledOnce();
  expect(first.getSnapshot()).toBe(data.session);
  const changed = vi.fn();
  second.subscribe(changed);
  first.release();
  vi.mocked(loadRemoteSession).mockRejectedValueOnce(new Error("offline"));
  await vi.advanceTimersByTimeAsync(4000);
  expect(second.getSnapshot()).toBe(data.session);
  expect(changed).not.toHaveBeenCalled();
  second.release();
  await vi.advanceTimersByTimeAsync(12000);
  expect(loadRemoteSession).toHaveBeenCalledTimes(2);
});

it("polls running sessions faster and refreshes after an acknowledged approval", async () => {
  vi.mocked(loadRemoteSession).mockResolvedValue(snapshot("running"));
  const lease = acquire();
  await flush();
  await vi.advanceTimersByTimeAsync(900);
  expect(loadRemoteSession).toHaveBeenCalledTimes(2);
  await lease.approve(7, "allow");
  await flush();
  expect(remoteRequest).toHaveBeenCalledWith("host", "commands.dispatch", expect.objectContaining({
    type: "approve", sessionId: "child", runId: "run", requestId: 7, decision: "allow",
  }));
  expect(loadRemoteSession).toHaveBeenCalledTimes(3);
});

it("isolates identical session ids in different projects and rejects a late released read", async () => {
  let finish!: (value: HostSession) => void;
  vi.mocked(loadRemoteSession).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue(snapshot("idle", "Other"));
  const first = acquire("/one"), second = acquire("/two");
  await flush();
  first.release();
  finish(snapshot("idle", "Late"));
  await flush();
  expect(second.getSnapshot()?.title).toBe("Other");
  expect(first.getSnapshot()).toBeUndefined();
});
