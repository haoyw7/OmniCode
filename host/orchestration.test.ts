import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import type { HostProvider } from "./providers";
import { HostEngine } from "./engine";
import { HostStore } from "./store";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const assignment = { id: "code", title: "Implement", prompt: "Change result.txt", harness: "codex", model: "codex:test", files: ["result.txt"], dependsOn: [] };
const response = JSON.stringify({ title: "Change result", summary: "Apply a reviewed change", tasks: [assignment] });

async function setup(harness: "codex" | "pi" | "omp" = "codex") {
  const directory = mkdtempSync(join(tmpdir(), "host-orchestration-test-"));
  const cwd = join(directory, "project"); mkdirSync(cwd);
  execFileSync("git", ["init", "-q", cwd]);
  execFileSync("git", ["-C", cwd, "config", "user.name", "Host test"]);
  execFileSync("git", ["-C", cwd, "config", "user.email", "test@example.invalid"]);
  writeFileSync(join(cwd, "result.txt"), "before\n");
  execFileSync("git", ["-C", cwd, "add", "."]);
  execFileSync("git", ["-C", cwd, "commit", "-qm", "Seed"]);
  const store = new HostStore(join(directory, "host.db"));
  const project = store.addProject(cwd, "Test");
  const turns: Array<{ input: SendTurnInput; finish(): void }> = [];
  const provider: HostProvider = {
    send: vi.fn((input) => new Promise<void>((resolve) => turns.push({ input, finish: resolve }))),
    stop: vi.fn(async (id) => { for (const turn of turns.filter((turn) => turn.input.sessionId === id)) turn.finish(); }),
    cancel: vi.fn(async (id) => { for (const turn of turns.filter((turn) => turn.input.sessionId === id)) turn.finish(); }),
    bind: vi.fn(), approve: vi.fn(), answer: vi.fn(), steer: vi.fn(async () => {}),
  };
  let engine = new HostEngine(store, { [harness]: provider });
  const catalog = async () => [{ harness, model: `${harness}:test`, name: "Test model" }];
  engine.orchestration.setCatalog(catalog);
  await engine.ready;
  const id = engine.command({ type: "create", commandId: "create", projectId: project.id, harness, model: `${harness}:test`, runtimeMode: "supervised" }).sessionId;
  cleanups.push(async () => { await engine.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const plan = async () => {
    const count = turns.length;
    engine.command({ type: "send", commandId: `plan:${count}`, sessionId: id, text: "Update result", intent: "orchestrate" });
    await vi.waitFor(() => expect(turns.length).toBe(count + 1));
    const turn = turns.at(-1)!;
    turn.input.onEvent({ type: "message.delta", text: JSON.stringify({ title: "Change result", summary: "Apply a reviewed change", tasks: [{ ...assignment, harness, model: `${harness}:test` }] }) }); turn.finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    return store.session(id).session.blocks.findLast((block) => block.orchestration)!;
  };
  const confirm = async () => {
    const block = await plan();
    const command = { type: "orchestration", action: "confirmProposal", commandId: `confirm:${turns.length}`, projectId: project.id, sessionId: id, proposalBlockId: block.id, expectedRevision: store.session(id).revision };
    const receipt = engine.command(command);
    expect(engine.command(command)).toEqual(receipt);
    await vi.waitFor(() => expect(engine.orchestration.scheduler.run(id)?.tasks[0].status).toBe("running"));
    // Starting a worker prepares a real Git checkout before provider dispatch.
    await vi.waitFor(() => expect(turns.filter((turn) => turn.input.sessionId !== id)).toHaveLength(1), { timeout: 3_000 });
    return engine.orchestration.scheduler.run(id)!;
  };
  return { store, project, cwd, provider, turns, id, plan, confirm, get engine() { return engine; }, restart: async (crashSnapshot?: ReturnType<HostStore["session"]>) => {
    await engine.close();
    if (crashSnapshot) store.transaction(() => store.save({ ...crashSnapshot, revision: store.session(crashSnapshot.session.id).revision + 1 }, { type: "fixture.crashSnapshot" }));
    engine = new HostEngine(store, { [harness]: provider }); engine.orchestration.setCatalog(catalog); await engine.ready; return engine;
  } };
}

describe("Host orchestration ownership", () => {
  it("plans in Host, rejects stale edits, and repairs invalid output once", async () => {
    const f = await setup();
    f.engine.command({ type: "send", commandId: "planning", sessionId: f.id, text: "Make assignments", intent: "orchestrate" });
    await vi.waitFor(() => expect(f.turns).toHaveLength(1));
    f.turns[0].input.onEvent({ type: "message.delta", text: "bad json" }); f.turns[0].finish();
    await vi.waitFor(() => expect(f.turns).toHaveLength(2));
    expect(f.turns[1].input.text).toContain("bad json");
    f.turns[1].input.onEvent({ type: "message.delta", text: response }); f.turns[1].finish();
    await vi.waitFor(() => expect(f.store.session(f.id).status).toBe("idle"));
    const value = f.store.session(f.id), block = value.session.blocks.find((block) => block.orchestration)!;
    expect(block.orchestration?.settings.maxWorkers).toBe(2);
    expect(block.orchestration?.author.model).toBe("codex:test");
    expect(block.orchestration?.status).toBe("ready");
    expect(value.session.blocks.some((block) => block.text === "bad json")).toBe(false);
    expect(() => f.engine.command({ type: "orchestration", action: "editProposal", commandId: "stale", projectId: f.project.id, sessionId: f.id, proposalBlockId: block.id, expectedRevision: value.revision - 1, edit: { maxWorkers: 1, tasks: [assignment] } })).toThrow("changed in another client");
  });

  it("executes isolated workers, rejects direct writes, and integrates only reviewed results", async () => {
    const f = await setup(), run = await f.confirm(), task = run.tasks[0];
    const worker = f.store.session(task.sessionId);
    expect(worker.session.cwd).toBe(task.workspace?.checkoutCwd);
    expect(worker.session.orchestrationLeadId).toBe(f.id);
    expect(() => f.engine.command({ type: "send", commandId: "direct", sessionId: task.sessionId, text: "Bypass the lead" })).toThrow("managed by its lead");
    expect(() => f.engine.assertWorkspaceWrite(join(worker.session.cwd, "result.txt"))).toThrow("managed by its lead");
    writeFileSync(join(worker.session.cwd, "result.txt"), "after\n");
    const turn = f.turns.find((turn) => turn.input.sessionId === task.sessionId)!;
    turn.input.onEvent({ type: "message.delta", text: "Updated" }); turn.finish();
    await vi.waitFor(() => expect(f.engine.orchestration.scheduler.run(f.id)?.tasks[0].status).toBe("completed"));
    expect(readFileSync(join(f.cwd, "result.txt"), "utf8")).toBe("before\n");
    await f.engine.orchestration.scheduler.handle(f.id, "review-result", "review", { taskId: task.id });
    expect(readFileSync(join(f.cwd, "result.txt"), "utf8")).toBe("after\n");
    const accepted = f.engine.orchestration.scheduler.run(f.id)!.tasks[0];
    expect(accepted.accepted).toBe(true);
    expect(accepted.workspace).toBeUndefined();
    expect(f.store.session(task.sessionId).session.worktreeRemoved).toBe(true);
    expect(existsSync(worker.session.cwd)).toBe(false);
    expect(await f.engine.orchestration.scheduler.handle(f.id, "finish-reviewed", "finish", {})).toMatchObject({ finished: true });
    expect(f.engine.orchestration.control.environment(f.id)).toEqual({});
    expect(() => f.engine.assertWorkspaceWrite(join(f.cwd, "result.txt"))).not.toThrow();
    f.turns.findLast((turn) => turn.input.sessionId === f.id)!.finish();
    await vi.waitFor(() => expect(f.store.session(f.id).status).toBe("idle"));
    await f.engine.deleteSession(f.id);
    expect(f.engine.orchestration.scheduler.run(f.id)).toBeUndefined();
    expect(f.store.orchestration(f.id)).toBeUndefined();
  });

  it("blocks final out-of-scope writes without failing the whole run", async () => {
    const f = await setup(), run = await f.confirm(), task = run.tasks[0];
    writeFileSync(join(task.workspace!.checkoutCwd, "outside.txt"), "keep for review\n");
    f.turns.find((turn) => turn.input.sessionId === task.sessionId)!.finish();
    await vi.waitFor(() => expect(f.engine.orchestration.scheduler.run(f.id)?.tasks[0].status).toBe("blocked"));
    expect(f.engine.orchestration.scheduler.run(f.id)?.status).toBe("active");
    expect(existsSync(task.workspace!.checkoutCwd)).toBe(true);
    await expect(f.engine.orchestration.scheduler.handle(f.id, "invalid-review", "review", { taskId: task.id })).rejects.toThrow();
    expect(existsSync(join(f.cwd, "outside.txt"))).toBe(false);
  });

  it("recovers a running generation as paused without replaying provider sends", async () => {
    const f = await setup(), run = await f.confirm();
    const generation = f.store.session(f.id).orchestration!.id;
    writeFileSync(join(run.tasks[0].workspace!.checkoutCwd, "result.txt"), "partial\n");
    const count = f.turns.length;
    await f.restart();
    expect(f.engine.orchestration.scheduler.run(f.id)?.status).toBe("paused");
    expect(f.store.session(f.id).orchestration?.id).toBe(generation);
    expect(f.engine.orchestration.scheduler.run(f.id)?.tasks[0].status).toBe("interrupted");
    expect(f.turns).toHaveLength(count);
    expect(() => f.engine.command({ type: "orchestration", action: "resume", commandId: "wrong-generation", projectId: f.project.id, sessionId: f.id, orchestrationId: "replaced" })).toThrow("replaced");
    f.engine.command({ type: "orchestration", action: "resume", commandId: "resume", projectId: f.project.id, sessionId: f.id, orchestrationId: generation });
    await vi.waitFor(() => expect(f.engine.orchestration.scheduler.run(f.id)?.status).toBe("active"));
    expect(readFileSync(join(run.tasks[0].workspace!.checkoutCwd, "result.txt"), "utf8")).toBe("partial\n");
  });

  for (const status of ["running", "idle"] as const) it(`makes a crashed ${status} planning card retryable without replaying the provider turn`, async () => {
    const f = await setup();
    f.engine.command({ type: "send", commandId: "crashed-plan", sessionId: f.id, text: "Prepare assignments", intent: "orchestrate" });
    await vi.waitFor(() => expect(f.turns).toHaveLength(1));
    const crash = f.store.session(f.id), block = crash.session.blocks.find((block) => block.orchestration)!;
    expect(block.orchestration?.status).toBe("planning");
    await f.restart({ ...crash, status, session: { ...crash.session, busy: status === "running" } });
    expect(f.turns).toHaveLength(1);
    const recovered = f.store.session(f.id).session.blocks.find((entry) => entry.id === block.id)!;
    expect(recovered.orchestration?.status).toBe("invalid");
    expect(recovered.streaming).toBe(false);
    expect(recovered.orchestration?.error).toMatch(/interrupted|Host restarted/);
    f.engine.command({ type: "send", commandId: "retry-crashed-plan", sessionId: f.id, text: "Retry assignments", intent: "orchestrate", retryProposalBlockId: block.id });
    await vi.waitFor(() => expect(f.turns).toHaveLength(2));
    f.turns[1].input.onEvent({ type: "message.delta", text: response }); f.turns[1].finish();
    await vi.waitFor(() => expect(f.store.session(f.id).session.blocks.find((entry) => entry.id === block.id)?.orchestration?.status).toBe("ready"));
    expect(f.store.session(f.id).session.blocks.filter((entry) => entry.orchestration)).toHaveLength(1);
  });

  it("persists steering acceptance before dispatch and does not repeat guidance after a lost run save or restart", async () => {
    const f = await setup(), run = await f.confirm(), task = run.tasks[0];
    const input = { taskId: task.id, text: "Preserve the partial result" };
    const save = vi.spyOn(f.store, "saveOrchestration").mockImplementationOnce(() => { throw new Error("steer receipt write failed"); });
    await expect(f.engine.orchestration.scheduler.handle(f.id, "steer-accepted", "steer", input)).rejects.toThrow("write failed");
    save.mockRestore();
    expect(f.provider.steer).toHaveBeenCalledTimes(1);
    expect(await f.engine.orchestration.scheduler.handle(f.id, "steer-accepted", "steer", input)).toEqual({ taskId: task.id, steered: true });
    await f.restart();
    expect(await f.engine.orchestration.scheduler.handle(f.id, "steer-accepted", "steer", input)).toEqual({ taskId: task.id, steered: true });
    expect(f.provider.steer).toHaveBeenCalledTimes(1);
    expect(f.store.session(task.sessionId).session.blocks.filter((block) => block.role === "user" && block.text === input.text)).toHaveLength(1);
    await expect(f.engine.orchestration.scheduler.handle(f.id, "steer-accepted", "steer", { ...input, text: "Another instruction" })).rejects.toThrow("different input");
  });

  for (const harness of ["pi", "omp"] as const) it(`${harness}: routes trusted steering, approval and question receipts exactly once`, async () => {
    const f = await setup(harness), run = await f.confirm(), task = run.tasks[0];
    const turn = f.turns.find((turn) => turn.input.sessionId === task.sessionId)!;
    await f.engine.orchestration.scheduler.handle(f.id, "steer", "steer", { taskId: task.id, text: "Focus on tests" });
    expect(f.provider.steer).toHaveBeenCalledWith(expect.objectContaining({ sessionId: task.sessionId, text: "Focus on tests", cwd: task.workspace!.checkoutCwd }));
    turn.input.onEvent({ type: "approval.requested", requestId: 7, title: "Run tests" });
    const worker = f.store.session(task.sessionId);
    expect(() => f.engine.command({ type: "approve", commandId: "bypass-approve", sessionId: task.sessionId, runId: worker.runId, requestId: 7, decision: "allow" })).toThrow("managed by its lead");
    const save = vi.spyOn(f.store, "saveOrchestration").mockImplementationOnce(() => { throw new Error("run receipt write failed"); });
    const respond = { taskId: task.id, requestId: 7, decision: "allow" };
    await expect(f.engine.orchestration.scheduler.handle(f.id, "approve-retry", "respond", respond)).rejects.toThrow("write failed");
    save.mockRestore();
    expect(await f.engine.orchestration.scheduler.handle(f.id, "approve-retry", "respond", respond)).toEqual({ taskId: task.id, decision: "allow" });
    expect(f.provider.approve).toHaveBeenCalledTimes(1);
    await expect(f.engine.orchestration.scheduler.handle(f.id, "approve-retry", "respond", { ...respond, decision: "deny" })).rejects.toThrow("different input");
    // A failed run-state write pauses the run. Resume explicitly before another effect.
    const generation = f.store.orchestration(f.id)!.id;
    if (f.engine.orchestration.scheduler.run(f.id)?.status === "paused") {
      f.engine.command({ type: "orchestration", action: "resume", commandId: "resume-control", projectId: f.project.id, sessionId: f.id, orchestrationId: generation });
      await vi.waitFor(() => expect(f.engine.orchestration.scheduler.run(f.id)?.status).toBe("active"));
      await vi.waitFor(() => expect(f.turns.filter((turn) => turn.input.sessionId === task.sessionId).length).toBe(2));
    }
    const current = f.turns.findLast((turn) => turn.input.sessionId === task.sessionId)!;
    current.input.onEvent({ type: "question.asked", requestId: 8, questions: [{ id: "choice", prompt: "Choose", options: [{ id: "yes", label: "Yes" }], multiSelect: false, allowCustom: false }] });
    const saveAnswer = vi.spyOn(f.store, "saveOrchestration").mockImplementationOnce(() => { throw new Error("answer receipt write failed"); });
    const answer = { taskId: task.id, requestId: 8, answers: { choice: ["yes"] } };
    await expect(f.engine.orchestration.scheduler.handle(f.id, "answer-retry", "answer", answer)).rejects.toThrow("write failed");
    saveAnswer.mockRestore();
    expect(await f.engine.orchestration.scheduler.handle(f.id, "answer-retry", "answer", answer)).toEqual({ taskId: task.id, answered: true });
    expect(f.provider.answer).toHaveBeenCalledTimes(1);
  });

  it("keeps active lead approvals public and cancelling its turn pauses retained workers", async () => {
    const f = await setup(), run = await f.confirm();
    const lead = f.turns.findLast((turn) => turn.input.sessionId === f.id)!;
    lead.input.onEvent({ type: "approval.requested", requestId: 13, title: "Supervise" });
    const value = f.store.session(f.id);
    f.engine.command({ type: "approve", commandId: "lead-approve", sessionId: f.id, runId: value.runId, requestId: 13, decision: "allow" });
    expect(f.provider.approve).toHaveBeenCalledWith(f.id, 13, "allow");
    writeFileSync(join(run.tasks[0].workspace!.checkoutCwd, "result.txt"), "partial\n");
    f.engine.command({ type: "cancel", commandId: "lead-cancel", sessionId: f.id, runId: value.runId });
    await vi.waitFor(() => expect(f.engine.orchestration.scheduler.run(f.id)?.status).toBe("paused"));
    await vi.waitFor(() => expect(f.store.session(run.tasks[0].sessionId).status).toBe("idle"));
    expect(existsSync(run.tasks[0].workspace!.checkoutCwd)).toBe(true);
  });

  it("rejects a queued control mutation after its lead grant is replaced", async () => {
    const f = await setup(), run = await f.confirm(), task = run.tasks[0];
    let release!: () => void;
    vi.mocked(f.provider.steer!).mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = f.engine.orchestration.scheduler.handle(f.id, "first-steer", "steer", { taskId: task.id, text: "Wait" });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const token = f.engine.orchestration.control.environment(f.id).MONOCODE_CONTROL_TOKEN;
    const queued = f.engine.orchestration.scheduler.handle(f.id, "old-grant-delegate", "delegate", { title: "Old request", harness: "codex", model: "codex:test", prompt: "Do work", files: ["other.txt"] }, () => f.engine.orchestration.control.environment(f.id).MONOCODE_CONTROL_TOKEN === token);
    f.engine.orchestration.control.disable(f.id);
    f.engine.orchestration.control.enable(f.id);
    release();
    await first;
    await expect(queued).rejects.toThrow("inactive");
    expect(f.engine.orchestration.scheduler.run(f.id)?.tasks).toHaveLength(1);
  });
});
