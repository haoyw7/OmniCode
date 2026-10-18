import { currentMachineIO, machineFs, machinePath, withMachineIO, type MachineIO } from "./machine-io";
import { projectMachineKey } from "../src/integrations/harness/core/machine";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Orchestrator, type ControlOutcome, type ControlReceiptContext, type OrchestrationRun, type OrchestrationTask, type WorkerPreparation } from "../src/features/orchestration/model/orchestrationRuntime";
import { completeOrchestrationProposal, orchestrationPlanningPrompt, orchestrationRepairPrompt, proposalBlock, validateProposedTasks, validateOrchestrationSettings, withOrchestrationProposal, type OrchestrationChoice, type OrchestrationProposal } from "../src/features/orchestration/model/orchestrationPlan";
import { modelsFor } from "../src/features/sessions/model/models";
import type { Session, TurnOrigin } from "../src/features/sessions/model/session";
import type { HarnessEvent, ApprovalDecision } from "../src/integrations/harness/core/types";
import type { UserQuestionReply } from "../src/features/sessions/model/userQuestion";
import type { CommandReceipt, HostOrchestrationCommand, HostOrchestrationView, HostSession, RemoteProvider } from "../src/features/connections/model/protocol";
import { HostControl } from "./control";
import { HostOrchestrationWorkspace } from "./orchestration-workspace";
import { checkoutPathsOverlap, checkoutPath, waitForProviderDrain } from "./checkout-guards";
import type { HostStore } from "./store";

export type OrchestrationEngine = {
  machineIO?(sessionId: string): MachineIO;
  session(id: string): HostSession | undefined;
  values(): HostSession[];
  mutate(id: string, change: (value: HostSession) => HostSession, event: unknown): HostSession;
  createWorker(run: OrchestrationRun, task: OrchestrationTask, preparation: WorkerPreparation): void;
  submit(id: string, text: string, done: (outcome: ControlOutcome) => void, origin?: TurnOrigin): void;
  stop(id: string): Promise<void>;
  steer(id: string, text: string, receipt?: ControlReceiptContext): Promise<void>;
  approve(id: string, request: number, decision: ApprovalDecision, receipt?: ControlReceiptContext): void;
  answer(id: string, request: number, reply: UserQuestionReply, receipt?: ControlReceiptContext): void;
};
export type HostOrchestrationOptions = { entry?: string; node?: string };
type Planning = { blockId: string; draft: OrchestrationProposal; prompt: string; response: string };

/** Existing scheduler, with all filesystem, provider and persistence ownership in Host. */
export class HostOrchestration {
  readonly scheduler: Orchestrator;
  readonly control: HostControl;
  readonly workspace: HostOrchestrationWorkspace;
  readonly ready: Promise<void>;
  private identities = new Map<string, string>();
  private catalog = new Map<string, OrchestrationChoice[]>();
  private discover?: (projectId: string) => Promise<OrchestrationChoice[]>;
  private actions = Promise.resolve();
  private closing = false;
  private planning = new Map<string, Planning>();
  private publishing = false;
  private preserveCheckouts = false;
  constructor(readonly store: HostStore, private engine: OrchestrationEngine, private providers: RemoteProvider[], options: HostOrchestrationOptions = {}) {
    this.workspace = new HostOrchestrationWorkspace(store);
    this.control = new HostControl(async (lead, request, action, input, authorize) => {
      await this.ready;
      const value = store.session(lead);
      if (value.session.nativeSession || store.isRetired(lead)) throw new Error("Control connection is inactive");
      return this.inSession(lead, () => this.scheduler.handle(lead, request, action, input, authorize));
    });
    this.scheduler = new Orchestrator({
      receipt: (lead, request, signature) => {
        const id = this.store.orchestration(lead)?.id;
        if (!id) return;
        const row = this.store.db.prepare("SELECT value FROM metadata WHERE key=?").get(`orchestration-effect:${id}:${request}`);
        if (!row) return;
        const receipt = JSON.parse(String(row.value));
        if (receipt.signature !== signature) throw new Error("Request ID was already used with different input");
        return { result: receipt.result };
      },
      load: async (id) => {
        const value = store.orchestration(id);
        if (value) this.identities.set(id, value.id);
        return value?.run ?? null;
      },
      save: async (run) => {
        const id = this.identities.get(run.leadId) ?? randomUUID();
        this.identities.set(run.leadId, id);
        store.transaction(() => store.saveOrchestration(id, run));
        this.publish(run);
      },
      enable: async (id) => this.inSession(id, async () => {
        this.control.enable(id);
        return this.control.launcher(resolve(dirname(store.attachmentDir), "control"), options.entry ?? fileURLToPath(import.meta.url), options.node);
      }),
      disable: async (id) => { this.control.disable(id); },
      scopes: async (cwd, files) => {
        const root = await machineFs.realpath(cwd);
        return Promise.all(files.map(async (file) => {
          if (!file || machinePath.isAbsolute(file) || file.replaceAll("\\", "/").split("/").includes("..")) throw new Error("Write scopes must be project-relative without '..'");
          const path = await resolveWritePath(machinePath.resolve(root, file));
          const rel = machinePath.relative(root, path);
          if (rel === ".." || rel.startsWith(`..${machinePath.sep}`) || machinePath.isAbsolute(rel)) throw new Error("Write scope points outside the checkout");
          return path;
        }));
      },
      resolvePath: resolveWritePath,
    });
    this.scheduler.bind({
      session: (id) => this.projectSession(id),
      sessions: () => this.engine.values().map((value) => this.projectValue(value)),
      sameMachine: (left, right) => projectMachineKey(this.store.project(this.store.session(left).projectId).machine) === projectMachineKey(this.store.project(this.store.session(right).projectId).machine),
      choices: () => {
        const choices = [...this.catalog.values()].flat();
        const defaults = this.providers.flatMap((harness) => modelsFor(harness).map((model) => ({ harness, model: model.id, name: model.name })));
        return this.providers.map((harness) => ({ harness, models: (choices.length ? choices : defaults).filter((choice) => choice.harness === harness).map((choice) => ({ id: choice.model, name: choice.name })) }));
      },
      createWorker: async (run, task) => this.inSession(run.leadId, async () => {
        const preparation = await this.workspace.createWorker(run, task);
        this.engine.createWorker(run, task, preparation);
        this.workspace.releasePreparation(task.sessionId);
        return preparation;
      }),
      integrateWorker: async (run, task) => this.inSession(run.leadId, async () => { await this.engine.stop(task.sessionId); return this.workspace.integrateWorker(run, task); }),
      cleanupWorker: async (run, task, unchanged) => this.inSession(run.leadId, async () => { if (this.preserveCheckouts) return false; await this.engine.stop(task.sessionId); return this.workspace.cleanupWorker(run, task, unchanged); }),
      submit: (id, text, done, origin) => this.engine.submit(id, text, done, origin),
      stop: (id) => this.engine.stop(id),
      steer: (id, text, receipt) => this.engine.steer(id, text, receipt),
      respondApproval: (id, request, decision, receipt) => this.engine.approve(id, request, decision, receipt),
      answerQuestion: (id, request, reply, receipt) => this.engine.answer(id, request, reply, receipt),
    });
    this.scheduler.subscribe(() => {
      if (this.publishing || this.closing) return;
      // Pending approvals also change the public view without changing run state.
      for (const run of this.scheduler.snapshot()) this.publish(run);
    });
    this.ready = this.recover();
  }
  private inSession<T>(id: string, operation: () => T): T {
    return withMachineIO(this.engine.machineIO?.(id) ?? currentMachineIO(), operation);
  }
  setCatalog(discover: (projectId: string) => Promise<OrchestrationChoice[]>) { this.discover = discover; }
  private async choices(projectId: string) {
    const choices = this.discover ? await this.discover(projectId) : this.providers.flatMap((harness) => modelsFor(harness).map((model) => ({ harness, model: model.id, name: model.name })));
    if (!choices.length) throw new Error("No worker models are available on this Host");
    this.catalog.set(projectId, choices);
    return choices;
  }
  private projectValue(value: HostSession): Session {
    const project = this.store.project(value.projectId);
    return { ...value.session, cwd: project.cwd, executionCwd: value.session.executionCwd || value.session.cwd };
  }
  private projectSession(id: string) { const value = this.engine.session(id); return value ? this.projectValue(value) : undefined; }
  private async recover() {
    await this.control.ready;
    for (const value of this.store.scanSessions()) {
      if (!value.session.blocks.some((block) => block.orchestration?.status === "planning")) continue;
      this.engine.mutate(value.session.id, (current) => ({ ...current, session: { ...current.session,
        blocks: current.session.blocks.map((block) => block.orchestration?.status === "planning" ? {
          ...block, streaming: false,
          orchestration: completeOrchestrationProposal(block.orchestration, "", "Host restarted while preparing assignments. Review and retry the proposal."),
        } : block),
      } }), { type: "orchestration.planningInterrupted" });
    }
    for (const lead of this.store.orchestrationLeads()) {
      const saved = this.store.orchestration(lead)!;
      for (const task of saved.run.tasks) {
        if (!task.workspace || !["running", "cancelling"].includes(task.status)) continue;
        try { await this.inSession(lead, async () => { await this.engine.stop(task.sessionId); await waitForProviderDrain(this.store, task.workspace!.checkoutCwd); await this.workspace.captureWorker(saved.run, task); }); }
        catch (error) {
          task.status = "blocked"; task.accepted = false; task.delivered = false;
          task.error = `Retained worker requires review: ${message(error)}`;
          task.activeDispatchId = undefined;
        }
      }
      this.store.transaction(() => this.store.saveOrchestration(saved.id, saved.run));
      await this.inSession(lead, () => this.scheduler.hydrate(lead));
    }
    const pending = this.store.db.prepare("SELECT session_id FROM orchestration_commands WHERE state='accepted'").all();
    this.store.db.prepare("UPDATE orchestration_commands SET state='interrupted' WHERE state='accepted'").run();
    for (const row of pending) {
      try { this.engine.mutate(String(row.session_id), (value) => ({ ...value, session: { ...value.session, blocks: value.session.blocks.map((block) => block.orchestration?.status === "starting" ? { ...block, orchestration: { ...block.orchestration, status: "invalid", error: "Host restarted before confirmation completed. Inspect the retained work and prepare a new proposal." } } : block) } }), { type: "orchestration.commandInterrupted" }); } catch { /* Retired/deleted session. */ }
    }
  }
  view(run: OrchestrationRun): HostOrchestrationView {
    const blocker = this.scheduler.resumeBlocker(run.leadId);
    return { id: this.identities.get(run.leadId)!, leadId: run.leadId, proposalId: run.proposalId, cwd: run.cwd, workspace: run.workspace,
      status: run.status, allowedHarnesses: run.allowedHarnesses, maxWorkers: run.maxWorkers, error: run.error,
      resumeLeadBusy: this.scheduler.resumeLeadBusy(run.leadId),
      ...(blocker ? { resumeBlocker: { sessionId: blocker.id, title: blocker.title } } : {}),
      tasks: run.tasks.map((task) => ({ id: task.id, sessionId: task.sessionId, title: task.title, harness: task.harness, model: task.model, status: task.status, error: task.error, needsInput: !!this.scheduler.pendingInput(task) })) };
  }
  private publish(run: OrchestrationRun) {
    this.publishing = true;
    try {
      const view = this.view(run);
      const value = this.store.session(run.leadId);
      if (JSON.stringify(value.orchestration) === JSON.stringify(view)) return;
      this.engine.mutate(run.leadId, (value) => ({ ...value, orchestration: view }), { type: "orchestration.updated", id: view.id });
    } catch (error) { if (!this.store.isRetired(run.leadId)) throw error; }
    finally { this.publishing = false; }
  }
  assertSessionWrite(id: string, kind: string) {
    const value = this.store.session(id);
    const run = this.scheduler.forSession(id);
    if (value.session.orchestrationLeadId) throw new Error("This worker is managed by its lead. Use desktop orchestration controls.");
    if (run && ["active", "paused"].includes(run.status) && !["send", "draft", "removeDraft"].includes(kind) && !(run.status === "active" && ["approve", "answer", "cancel"].includes(kind))) throw new Error("Use desktop orchestration controls before changing this run.");
    if (["send", "compact", "queue"].includes(kind)) {
      const error = this.scheduler.submissionError(id);
      if (error) throw new Error(error);
    }
    this.assertCheckout(value.session.cwd, id);
  }
  assertCheckout(cwd: string, leadId?: string) {
    const controlled = this.scheduler.snapshot().find((run) => projectMachineKey(this.store.project(this.store.session(run.leadId).projectId).machine) === currentMachineIO().key && ["active", "paused"].includes(run.status) && run.leadId !== leadId && checkoutPathsOverlap(checkoutPath(run.workspace?.checkoutCwd ?? run.cwd), checkoutPath(cwd)));
    if (controlled) throw new Error("This checkout is controlled by an orchestrator. Stop its run before independent work.");
  }
  hasActiveWork() { return this.scheduler.snapshot().some((run) => run.status === "active" || run.tasks.some((task) => ["running", "cancelling"].includes(task.status))); }
  prompt(id: string, text: string) { return this.scheduler.prompt(id, text); }
  environment(id: string): Record<string, string> {
    const task = this.scheduler.forSession(id)?.tasks.find((task) => task.sessionId === id);
    return task ? (task.scratchDir ? { TMPDIR: task.scratchDir, TMP: task.scratchDir, TEMP: task.scratchDir } : {}) : this.control.environment(id);
  }
  observe(id: string, event: HarnessEvent) { this.inSession(id, () => { this.scheduler.observe(id, event); this.scheduler.sync(); }); }
  sync() { this.scheduler.sync(); for (const run of this.scheduler.snapshot()) this.publish(run); }
  async preparePlanning(value: HostSession, request: string, retryBlockId?: string): Promise<string> {
    await this.ready;
    const choices = await this.choices(value.projectId);
    const old = retryBlockId ? this.store.session(value.session.id).session.blocks.find((block) => block.id === retryBlockId)?.orchestration : undefined;
    if (retryBlockId && (!old || old.status !== "invalid")) throw new Error("This proposal is not ready to retry");
    const draft: OrchestrationProposal = { version: 1, leadId: value.session.id, cwd: this.store.project(value.projectId).cwd, checkoutCwd: value.session.cwd, request: old?.request ?? request,
      author: { harness: value.session.harness, model: value.session.model, name: resolveModelName(value.session) },
      settings: validateOrchestrationSettings({ choices, maxWorkers: old?.settings.maxWorkers ?? 2 }), status: "planning", title: "Preparing assignments", summary: "", tasks: [] };
    const blockId = retryBlockId ?? randomUUID();
    this.engine.mutate(value.session.id, (current) => ({ ...current, session: retryBlockId ? withOrchestrationProposal(current.session, blockId, draft) : { ...current.session, blocks: [...current.session.blocks, proposalBlock(blockId, draft)] } }), { type: "orchestration.planning", blockId });
    const prompt = old?.response ? orchestrationRepairPrompt({ ...draft, error: old.error, response: old.response }) : orchestrationPlanningPrompt(draft.request, draft.settings, value.session.cwd);
    this.planning.set(value.session.id, { blockId, draft, prompt, response: "" });
    return prompt;
  }
  planningEvent(id: string, event: HarnessEvent): boolean {
    const planning = this.planning.get(id);
    if (!planning) return false;
    if (event.type === "message.delta") { planning.response += event.text; return true; }
    return event.type === "message.completed";
  }
  repairPlanning(id: string): string | undefined {
    const planning = this.planning.get(id);
    if (!planning) return;
    const proposal = completeOrchestrationProposal(planning.draft, planning.response);
    if (proposal.status !== "invalid") return;
    planning.response = "";
    return orchestrationRepairPrompt(proposal);
  }
  finishPlanning(id: string, error?: string) {
    const planning = this.planning.get(id);
    if (!planning) return;
    this.planning.delete(id);
    const proposal = completeOrchestrationProposal(planning.draft, planning.response, error);
    this.engine.mutate(id, (value) => ({ ...value, session: withOrchestrationProposal(value.session, planning.blockId, proposal) }), { type: "orchestration.proposal", blockId: planning.blockId });
  }
  accept(command: HostOrchestrationCommand): CommandReceipt {
    const signature = createHash("sha256").update(JSON.stringify(command)).digest("hex");
    const previous = this.store.receipt(command.commandId, signature);
    if (previous) return previous;
    const value = this.store.session(command.sessionId);
    if (value.projectId !== command.projectId || value.session.nativeSession || value.session.orchestrationLeadId) throw new Error("This session cannot control that orchestration");
    const run = this.scheduler.run(command.sessionId);
    let proposal: OrchestrationProposal | undefined;
    if ("proposalBlockId" in command) {
      if (value.revision !== command.expectedRevision) throw new Error("The proposal changed in another client. Refresh before editing or confirming.");
      if (value.status === "running" || run && ["active", "paused"].includes(run.status)) throw new Error("Wait for or stop the current run before confirming another proposal");
      proposal = value.session.blocks.find((block) => block.id === command.proposalBlockId)?.orchestration;
      if (!proposal || proposal.status !== "ready" || proposal.leadId !== command.sessionId) throw new Error("Review a ready proposal before confirming");
      const settings = validateOrchestrationSettings({ ...proposal.settings, maxWorkers: command.edit?.maxWorkers ?? proposal.settings.maxWorkers });
      proposal = { ...proposal, settings, tasks: validateProposedTasks(command.edit?.tasks ?? proposal.tasks, settings, proposal.checkoutCwd ?? proposal.cwd) };
    } else {
      if (!run || this.identities.get(command.sessionId) !== command.orchestrationId) throw new Error("This action belongs to a replaced orchestration run");
      if (command.action === "resume" && run.status !== "paused") throw new Error("Only a paused orchestration can resume");
      if (command.action === "cancelTask" && !run.tasks.some((task) => task.id === command.taskId)) throw new Error("Task does not belong to this run");
    }
    const savedProposal = proposal;
    const generation = command.action === "confirmProposal" ? randomUUID() : undefined;
    const receipt = this.store.transaction(() => {
      const current = this.store.session(command.sessionId);
      const next = savedProposal && (command.action === "editProposal" || command.action === "confirmProposal")
        ? { ...current, session: withOrchestrationProposal(current.session, command.proposalBlockId, { ...savedProposal, status: command.action === "confirmProposal" ? "starting" : "ready" }) } : current;
      const saved = this.store.save({ ...next, revision: current.revision + 1, updatedAt: Date.now() }, { type: "orchestration.command", action: command.action });
      const receipt = { commandId: command.commandId, sessionId: command.sessionId, revision: saved.revision };
      this.store.recordReceipt(signature, receipt);
      if (generation) this.store.db.prepare("INSERT INTO metadata VALUES (?, ?)").run(`orchestration-generation:${command.commandId}`, generation);
      this.store.db.prepare("INSERT INTO orchestration_commands VALUES (?, ?, ?, ?, ?)").run(command.commandId, signature, command.sessionId, JSON.stringify(command), command.action === "editProposal" ? "completed" : "accepted");
      return receipt;
    });
    if (command.action !== "editProposal") {
      const operation = this.actions.catch(() => undefined).then(() => this.inSession(command.sessionId, async () => {
        if (this.closing || this.store.isRetired(command.sessionId)) throw new Error("Host is stopping");
        if (command.action === "confirmProposal") {
          await this.choices(value.projectId);
          this.identities.set(command.sessionId, generation!);
          await this.scheduler.startApproved(command.sessionId, command.proposalBlockId, savedProposal!);
          this.engine.mutate(command.sessionId, (value) => ({ ...value, session: withOrchestrationProposal(value.session, command.proposalBlockId, { ...savedProposal!, status: "approved" }) }), { type: "orchestration.approved" });
        } else if (command.action === "resume") {
          await this.choices(value.projectId);
          await this.scheduler.start(command.sessionId, run!.allowedHarnesses, run!.maxWorkers);
        } else if (command.action === "stop") await this.scheduler.stopRun(command.sessionId);
        else if ("taskId" in command) await this.scheduler.cancelTask(command.sessionId, command.taskId!);
        this.store.db.prepare("UPDATE orchestration_commands SET state='completed' WHERE id=?").run(command.commandId);
      }));
      this.actions = operation.catch((error) => {
        this.store.db.prepare("UPDATE orchestration_commands SET state='failed' WHERE id=?").run(command.commandId);
        if (!this.store.isRetired(command.sessionId)) this.engine.mutate(command.sessionId, (value) => ({ ...value, session: { ...value.session, blocks: value.session.blocks.map((block) => block.orchestration?.status === "starting" ? { ...block, streaming: false, orchestration: { ...block.orchestration, status: "ready" as const, error: message(error) } } : block).concat({ id: randomUUID(), role: "system", text: message(error) }) } }), { type: "orchestration.failed" });
      });
    }
    return receipt;
  }
  async workerSettled(id: string) {
    const run = this.scheduler.forSession(id), task = run?.tasks.find((task) => task.sessionId === id);
    if (!run || !task?.workspace) return;
    try { await this.inSession(id, () => this.workspace.captureWorker(run, task)); }
    catch (error) { await this.scheduler.blockWorker(run.leadId, task.id, message(error)); }
  }
  async retire(ids: string[]) {
    this.preserveCheckouts = true;
    try { for (const run of this.scheduler.snapshot()) if (ids.includes(run.leadId) || run.tasks.some((task) => ids.includes(task.sessionId))) { await this.scheduler.stopRun(run.leadId); await this.scheduler.deleteSession(run.leadId, async () => undefined); this.identities.delete(run.leadId); } }
    finally { this.preserveCheckouts = false; }
    for (const id of ids) this.control.disable(id);
  }
  async close() { this.closing = true; await this.ready; await this.actions; await this.scheduler.close(); await this.control.close(); }
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function resolveModelName(session: Session) { return modelsFor(session.harness).find((model) => model.id === session.model)?.name ?? session.model; }
async function resolveWritePath(path: string): Promise<string> {
  if (!machinePath.isAbsolute(path)) throw new Error("Reported writes must be absolute");
  let current = path;
  const missing: string[] = [];
  while (true) {
    try {
      const stat = await machineFs.lstat(current);
      if (stat.isSymbolicLink()) { await machineFs.realpath(current); }
      return machinePath.resolve(await machineFs.realpath(current), ...missing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try { if ((await machineFs.lstat(current)).isSymbolicLink()) throw new Error("Reported write contains a dangling symlink"); } catch (linkError) { if ((linkError as NodeJS.ErrnoException).code !== "ENOENT") throw linkError; }
      const parent = machinePath.dirname(current);
      if (parent === current) throw error;
      missing.unshift(machinePath.basename(current)); current = parent;
    }
  }
}
