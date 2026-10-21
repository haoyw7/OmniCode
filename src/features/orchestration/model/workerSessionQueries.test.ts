// @vitest-environment happy-dom
import { QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryClient } from "../../../shared/lib/queryClient";
import { loadRemoteSession } from "../../connections/model/connections";
import type { HostSession } from "../../connections/model/protocol";
import { newSession } from "../../sessions/model/session";
import type { HostWorkerReference } from "./orchestrationClient";
import { workerSessionQuery } from "./workerSessionQueries";

vi.mock("../../connections/model/connections", () => ({ loadRemoteSession: vi.fn() }));
const source: HostWorkerReference = {
  machineId: "machine-a", leadId: "lead", sessionId: "worker",
  project: { key: "remote://env/repo", cwd: "/repo", environmentId: "env", projectId: "project" },
};
const snapshot = (status: HostSession["status"] = "running"): HostSession => ({
  projectId: "project", revision: 1, updatedAt: 1, status,
  session: { ...newSession("codex", "/repo"), id: "worker", orchestrationLeadId: "lead" },
});
const read = vi.mocked(loadRemoteSession);
beforeEach(() => { queryClient.clear(); vi.useFakeTimers(); read.mockReset(); });
afterEach(() => { queryClient.clear(); vi.useRealTimers(); });

it("reuses the known snapshot, retains history on errors and slows disconnected polling", async () => {
  const first = snapshot();
  read.mockResolvedValueOnce(first).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(snapshot("idle"));
  const observer = new QueryObserver(queryClient, workerSessionQuery(source));
  const stop = observer.subscribe(() => {});
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(750);
  expect(read).toHaveBeenLastCalledWith("machine-a", "worker", first);
  expect(observer.getCurrentResult().data).toEqual(first);
  await vi.advanceTimersByTimeAsync(2999);
  expect(read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(observer.getCurrentResult().data?.status).toBe("idle");
  observer.setOptions({ ...workerSessionQuery(source), enabled: false });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(read).toHaveBeenCalledTimes(3);
  stop();
});

it.each(["project", "lead", "session"])("rejects a snapshot belonging to a different %s", async (identity) => {
  const first = snapshot();
  read.mockResolvedValueOnce(first);
  const options = workerSessionQuery(source);
  await queryClient.fetchQuery(options);
  const wrong = snapshot();
  if (identity === "project") wrong.projectId = "other";
  else if (identity === "lead") wrong.session.orchestrationLeadId = "other";
  else wrong.session.id = "other";
  read.mockResolvedValueOnce(wrong);
  await expect(queryClient.fetchQuery(options)).rejects.toThrow("does not match");
  expect(queryClient.getQueryData(options.queryKey)).toEqual(first);
});

it("isolates Hosts sharing session IDs and discards a late read after switching", async () => {
  let finish!: (value: HostSession) => void;
  read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(snapshot("idle"));
  const old = workerSessionQuery(source);
  const observer = new QueryObserver(queryClient, old);
  const stop = observer.subscribe(() => {});
  observer.setOptions(workerSessionQuery({ ...source, machineId: "machine-b" }));
  await vi.advanceTimersByTimeAsync(0);
  finish(snapshot());
  await vi.advanceTimersByTimeAsync(0);
  expect(observer.getCurrentResult().data?.status).toBe("idle");
  expect(queryClient.getQueryData(old.queryKey)).toBeUndefined();
  expect(read).toHaveBeenLastCalledWith("machine-b", "worker", undefined);
  stop();
});
