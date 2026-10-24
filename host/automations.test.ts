import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostAutomations, HostAutomationStore } from "./automations";
import type { AutomationUpsert } from "../src/contracts/automations";
import { createAutomationTrigger } from "../src/domain/automationSchedule";

const roots: string[] = [];
const services: HostAutomations[] = [];
const stores: HostAutomationStore[] = [];
function directory() { const root = mkdtempSync(join(tmpdir(), "omnicode-automation-")); roots.push(root); return root; }
function create(desktop?: string) { const store = new HostAutomationStore(directory(), () => desktop); stores.push(store); return store; }
function draft(overrides: Partial<AutomationUpsert> = {}): AutomationUpsert {
  return { id: "a1", name: "Review", prompt: "Review changes", harness: "codex", model: "model", cwd: "/repo", workspaceMode: "current", reuseSession: false,
    runtimeMode: "auto", triggerKind: "time", triggerEvent: "hourly", scheduleKind: "hourly", minute: 0, time: "09:00", dayOfWeek: 1,
    missedRunGraceMinutes: 60, enabled: true, nextRunAt: 0, triggers: [createAutomationTrigger("time", "hourly", { minute: 0 })], ...overrides };
}
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.useRealTimers(); vi.restoreAllMocks();
});

it("claims overdue occurrences once, records grace-period skips, and keeps the schedule advancing", () => {
  const store = create();
  const now = new Date(2026, 9, 22, 10, 30).getTime();
  const saved = store.upsert(draft(), now);
  const dueAt = saved.nextRunAt + 3 * 3600_000;
  store.claimDue(dueAt);
  const runs = store.runs("a1");
  expect(runs).toHaveLength(4);
  expect(runs.filter(run => run.status === "skipped")).toHaveLength(2);
  expect(runs.filter(run => run.status === "pending")).toHaveLength(2);
  expect(store.get("a1")!.nextRunAt).toBeGreaterThan(dueAt);
  store.claimDue(dueAt);
  expect(store.runs("a1")).toHaveLength(4);
});

it("retains event deduplication after completed history is trimmed", () => {
  const store = create();
  store.upsert(draft({ triggers: [createAutomationTrigger("github", "issue_opened")] }));
  const claim = { eventKey: "github:issue:org/repo:1", eventKind: "github", event: "issue_opened", scheduledFor: 1, prompt: "Event snapshot" };
  const first = store.claimEvent("a1", claim, 2)!;
  store.update(first.run.id, "succeeded", {}, 3);
  for (let index = 0; index < 105; index++) { const run = store.manual("a1", index + 10); store.update(run.id, "succeeded", {}, index + 11); }
  expect(store.runs("a1")).toHaveLength(100);
  expect(store.runs("a1").some(run => run.id === first.run.id)).toBe(false);
  expect(store.claimEvent("a1", claim)).toBeNull();
});

it("imports desktop definitions, pending prompts and event claims without writing the legacy database", () => {
  const desktop = directory();
  const db = new DatabaseSync(join(desktop, "omnicode.db"));
  const definition = { ...draft({ triggers: [createAutomationTrigger("github", "issue_opened")] }), createdAt: 1, updatedAt: 2, worktreeCwd: "/old-tree" };
  const run = { id: "old-run", automationId: "a1", trigger: "event", eventKey: "github:issue:org/repo:1", eventKind: "github", event: "issue_opened", scheduledFor: 1, createdAt: 2, status: "pending", prompt: "Persisted event prompt" };
  db.exec("CREATE TABLE automations(id TEXT PRIMARY KEY,definition_json TEXT); CREATE TABLE automation_runs(automation_id TEXT,run_json TEXT); CREATE TABLE automation_event_claims(automation_id TEXT,event_key TEXT,created_at INTEGER)");
  db.prepare("INSERT INTO automations VALUES (?,?)").run("a1", JSON.stringify(definition));
  db.prepare("INSERT INTO automation_runs VALUES (?,?)").run("a1", JSON.stringify(run));
  try {
    const store = create(desktop);
    expect(store.list()[0]).toMatchObject({ id: "a1", executionCwd: "/old-tree" });
    expect(store.active()[0].run.prompt).toBe("Persisted event prompt");
    store.delete("a1");
    expect(store.list()).toEqual([]);
    expect(JSON.parse(String(db.prepare("SELECT definition_json FROM automations").get()!.definition_json))).toEqual(definition);
  } finally { db.close(); }
});

it("runs and settles from the Host timer while no client is mounted", async () => {
  vi.useFakeTimers();
  const store = create();
  store.upsert(draft({ enabled: false }));
  const run = store.manual("a1");
  const launch = vi.fn(async () => "host-session");
  let complete = false;
  const service = new HostAutomations(store, { launch, outcome: () => ({ status: complete ? "succeeded" : "running" }) });
  stores.splice(stores.indexOf(store), 1); services.push(service);
  service.start();
  await vi.advanceTimersByTimeAsync(1);
  expect(store.runs("a1")[0]).toMatchObject({ id: run.id, status: "running", sessionId: "host-session" });
  complete = true;
  await vi.advanceTimersByTimeAsync(1000);
  expect(store.runs("a1")[0].status).toBe("succeeded");
  expect(launch).toHaveBeenCalledTimes(1);
});
