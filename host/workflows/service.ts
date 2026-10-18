// Host workflow run service: submits, approves, runs, amends, resumes and
// cancels dynamic workflow runs, projects run events into the launching
// conversation (Session.workflowRuns + a run-card block), and serves the
// workflow control CLI and RPC surface. The run lifecycle follows ZCode's
// bootstrap dynamic-workflow run service (Apache-2.0).

import { randomUUID } from "node:crypto";
import { currentMachineIO, machineFs, machinePath, withMachineIO, type MachineIO } from "../machine-io";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import {
  FACADE_DTS,
  refToString,
  WorkflowError,
  type ActorSessionSeed,
  type ImportedRunCache,
  type PersonaSpec,
  type RunEvent,
  type RunRecord,
  type RunSettlement,
  type RunStatus,
  type WorkflowEngine,
} from "../../src/integrations/workflow/dynamic-workflow/index.js";
import type { HostSession } from "../../src/features/connections/model/protocol";
import type { AgentModel } from "../../src/features/sessions/model/models";
import type { Block, HarnessId } from "../../src/features/sessions/model/session";
import type { WorkflowAgentRuntime } from "../../src/integrations/workflow/createWorkflow.js";
import { WorkflowAgentRuntimeSchema } from "../../src/integrations/workflow/createWorkflow.js";
import {
  describeWorkflowRuntime,
  normalizeWorkflowHarness,
  resolveWorkflowRuntime,
  WORKFLOW_HARNESSES,
  type WorkflowResolvedRuntime,
} from "../../src/integrations/workflow/modelConfig.js";
import { reduceWorkflowRunsState } from "../../src/integrations/workflow/protocol/workflow-runs-reducer.js";
import type { WorkflowRunsState, WorkflowRunState } from "../../src/integrations/workflow/protocol/workflow-runs.js";
import {
  isValidSavedWorkflowName,
  SavedWorkflowArgsDeclarationSchema,
  SavedWorkflowMetaSchema,
  type SavedWorkflowEntry,
  type SavedWorkflowScope,
} from "../../src/integrations/workflow/savedWorkflow.js";
import type { WorkflowRunBlock, WorkflowRunSettings, WorkflowRunSource } from "../../src/integrations/workflow/sessionTypes.js";
import { HostControl, WORKFLOW_ACTIONS } from "../control";
import { analyze, clampRunConcurrency, compileOnce, evalSnippet, formatDiagnostics, scriptHash, validateFn, workflowConcurrencyCeiling } from "./compile.js";
import { OmniCodeWorkflowDriver, effectiveActorName, mintActorSessionId, personaRuntime, type WorkflowWorkerPort } from "./driver.js";
import { buildImportedCache, preflightAmendImport, TERMINAL_RUN_STATUSES } from "./import.js";
import { artifactItems, artifactsOf, readArtifactBytes } from "./artifact-queries.js";
import { SqliteJournalStore } from "./journal.js";
import { FileArtifactStore } from "./node-ports.js";
import { runWorkflowScript } from "./runtime/harness.js";
import { resolveWorkflowDraftName, writeWorkflowDraft } from "./saved/drafts.js";
import { parseSavedWorkflow } from "./saved/frontmatter.js";
import { listSavedWorkflows, moveSavedWorkflow, resolveSavedWorkflow, saveSavedWorkflow, savedWorkflowPath, savedWorkflowRoot } from "./saved/store.js";
import { validateWorkflowArgs } from "./saved/args.js";
import SKILL_MD from "./skill/SKILL.md?raw";
import PATTERNS_MD from "./skill/patterns.md?raw";
import EXAMPLES_MD from "./skill/examples.md?raw";

export interface HostWorkflowsDeps {
  db: DatabaseSync;
  dataDir: string;
  /** Restores the project machine for control requests and resumed runs. */
  machineIO?(sessionId: string): MachineIO;
  session(id: string): HostSession | undefined;
  mutate(id: string, change: (value: HostSession) => HostSession, event: unknown): HostSession;
  workers: WorkflowWorkerPort;
  /** Create an ordinary conversation in a project folder to launch a workflow from. */
  createSession?(cwd: string, title: string, runtime?: { harness?: HarnessId; model?: string }): Promise<string>;
  /** Installed providers. */
  providers(): readonly HarnessId[];
  /** A provider's model catalog for a project directory, when it can be discovered. */
  models?(cwd: string, harness: HarnessId): Promise<AgentModel[]>;
  entry?: string;
  node?: string;
}

export type WorkflowSubmitInput = {
  name?: string;
  script?: string;
  saved?: { name: string; scope?: SavedWorkflowScope; args?: Record<string, unknown> };
  path?: string;
  args?: Record<string, unknown>;
  maxConcurrency?: number;
  defaults?: WorkflowAgentRuntime;
  agents?: Record<string, WorkflowAgentRuntime>;
};

export type WorkflowSubmitResult =
  | { ok: false; reason: string; message: string; diagnostics?: string[]; scriptPath?: string }
  | { ok: true; runId: string; status: "running" | "awaiting_approval"; scriptPath?: string; phases?: string[]; commands?: string[]; warnings?: string[] };

type PreparedRun = {
  runId: string;
  parentSessionId: string;
  cwd: string;
  name: string;
  script: string;
  scriptPath?: string;
  args?: Record<string, unknown>;
  settings: WorkflowRunSettings;
  phaseNames?: string[];
  phaseAlongside?: number[][];
  resumedFrom?: string;
  amend?: AmendLaunch;
};

type AmendLaunch = {
  predecessorId: string;
  runId: string;
  importedCache?: ImportedRunCache;
  inheritedTokens?: number;
  /** The predecessor still runs: stop it and rebuild the cache when the user approves. */
  deferred?: boolean;
};

type LiveRun = {
  runId: string;
  parentSessionId: string;
  abort: AbortController;
  engine?: Pick<WorkflowEngine, "setMaxConcurrency">;
  driver?: OmniCodeWorkflowDriver;
  settings: WorkflowRunSettings;
  done: Promise<RunSettlement>;
};

const WAIT_MAX_SECONDS = 25;
const PROGRESS_FLUSH_MS = 250;
const RESULT_PREVIEW_CHARS = 4_000;

/** Slash commands that bring the workflow authoring guide into a turn. */
const WORKFLOW_COMMAND = /(^|\s)\/(workflow|workflows|dynamic-workflows)(?=\s|$)/;

function text(value: unknown, max: number): string {
  const rendered = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
  return rendered.length > max ? `${rendered.slice(0, max - 1)}…` : rendered;
}

function runtimeInput(value: unknown, field: string): WorkflowAgentRuntime | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = WorkflowAgentRuntimeSchema.safeParse(value);
  if (!parsed.success) throw new Error(`${field} must be {provider?, model?, thinking?, speed?}`);
  if (parsed.data.provider !== undefined && normalizeWorkflowHarness(parsed.data.provider) === undefined)
    throw new Error(`${field}.provider "${parsed.data.provider}" is not one of ${WORKFLOW_HARNESSES.join(", ")}`);
  return parsed.data;
}

function agentsInput(value: unknown): Record<string, WorkflowAgentRuntime> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("agents must map agent names to runtimes");
  return Object.fromEntries(Object.entries(value).map(([name, runtime]) => [name, runtimeInput(runtime, `agents.${name}`)!]));
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value;
}

function recordInput(input: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${key} must be an object`);
  return value as Record<string, unknown>;
}

export function parseSubmitInput(input: Record<string, unknown>): WorkflowSubmitInput {
  const saved = recordInput(input, "saved");
  const sources = ["script", "saved", "path"].filter((key) => input[key] !== undefined && input[key] !== null);
  if (sources.length !== 1) throw new Error("Pass exactly one of script, saved or path");
  const maxConcurrency = input.maxConcurrency ?? input.max_concurrency;
  if (maxConcurrency !== undefined && maxConcurrency !== null && (typeof maxConcurrency !== "number" || !Number.isInteger(maxConcurrency) || maxConcurrency < 1))
    throw new Error("maxConcurrency must be a positive integer");
  if (input.args !== undefined && input.path === undefined) throw new Error("args belongs to path; pass saved.args for a saved workflow");
  const defaults = runtimeInput(input.defaults, "defaults");
  const agents = agentsInput(input.agents);
  const args = recordInput(input, "args");
  return {
    ...(optionalString(input, "name") ? { name: optionalString(input, "name") } : {}),
    ...(optionalString(input, "script") !== undefined ? { script: optionalString(input, "script") } : {}),
    ...(saved ? { saved: { name: String(saved.name ?? ""), ...(saved.scope === "project" || saved.scope === "global" ? { scope: saved.scope } : {}), ...(saved.args && typeof saved.args === "object" ? { args: saved.args as Record<string, unknown> } : {}) } } : {}),
    ...(optionalString(input, "path") ? { path: optionalString(input, "path") } : {}),
    ...(args ? { args } : {}),
    ...(typeof maxConcurrency === "number" ? { maxConcurrency } : {}),
    ...(defaults ? { defaults } : {}),
    ...(agents ? { agents } : {}),
  };
}

export class HostWorkflows {
  readonly journal: SqliteJournalStore;
  readonly control: HostControl;
  readonly artifacts: FileArtifactStore;
  readonly ready: Promise<void>;
  private launcherPath?: string;
  private skillDir: string;
  private readonly live = new Map<string, LiveRun>();
  private readonly pending = new Map<string, PreparedRun>();
  private readonly states = new Map<string, WorkflowRunsState>();
  private readonly flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly waiters = new Map<string, Set<() => void>>();
  private readonly catalogs = new Map<string, AgentModel[]>();
  private closing = false;

  constructor(private readonly deps: HostWorkflowsDeps) {
    this.journal = new SqliteJournalStore(deps.db);
    this.artifacts = new FileArtifactStore(join(deps.dataDir, "workflow-artifacts"));
    this.skillDir = join(deps.dataDir, "workflow-skill");
    this.control = new HostControl(
      async (sessionId, _requestId, action, input) => this.handleControl(sessionId, action, input),
      { namespace: "workflow", actions: WORKFLOW_ACTIONS },
    );
    this.ready = this.prepare();
    this.recoverInterrupted();
  }

  private inSession<T>(sessionId: string, operation: () => T): T {
    return withMachineIO(this.deps.machineIO?.(sessionId) ?? currentMachineIO(), operation);
  }

  private async prepare(): Promise<void> {
    await mkdir(this.skillDir, { recursive: true, mode: 0o700 });
    const skill = SKILL_MD.replace(/<!-- facade-dts:start -->[\s\S]*?<!-- facade-dts:end -->/, `<!-- facade-dts:start -->\n\`\`\`ts\n${FACADE_DTS.trim()}\n\`\`\`\n<!-- facade-dts:end -->`);
    await Promise.all([
      writeFile(join(this.skillDir, "SKILL.md"), skill),
      writeFile(join(this.skillDir, "patterns.md"), PATTERNS_MD),
      writeFile(join(this.skillDir, "examples.md"), EXAMPLES_MD),
    ]);
    if (this.deps.entry) this.launcherPath = await this.control.launcher(join(this.deps.dataDir, "workflow-control"), this.deps.entry, this.deps.node);
  }

  /** Recover interrupted runs and terminal journal events missed by parent snapshots. */
  private recoverInterrupted(): void {
    for (const record of this.journal.listRunsForRecovery()) {
      const interrupted = record.status === "pending" || record.status === "running";
      const parentId = record.parentSessionId;
      const previous = this.runState(record);
      // Do not resurrect old runs evicted from the parent's bounded history.
      if (!interrupted && (!previous || (previous.status !== "running" && previous.status !== "pending"
        && previous.nodes.every(node => node.phase === "settled")))) continue;
      if (interrupted) {
        this.journal.updateRunStatus(record.runId, "stopped", { stopReason: "interrupted" });
        this.journal.appendEvent(record.runId, { type: "run-settled", status: "stopped", stopReason: "interrupted" });
      }
      if (!parentId || !this.deps.session(parentId)) continue;
      // Replay missing node outcomes before the terminal event so finished work
      // remains successful, even if the final parent snapshot was never saved.
      for (const { event, sequence } of this.journal.listEvents(record.runId, { afterSequence: previous?.lastEventSequence ?? -1 })) {
        const actor = event.type === "actor-created" || event.type === "node-dispatched" ? event.actor : undefined;
        this.project(parentId, record.runId, event, sequence,
          event.type === "run-settled" && event.status === "stopped" && event.stopReason !== "superseded" ? { resumable: true } : {},
          actor ? mintActorSessionId(record.runId, actor) : undefined);
      }
      const current = this.runState(record);
      if (current && (current.status === "pending" || current.status === "running" || current.nodes.some(node => node.phase !== "settled"))) {
        // Covers a crash between updating the journal row and appending its
        // terminal event, and older terminal projections with live nodes.
        const event: RunEvent = { type: "run-settled", status: interrupted ? "stopped" : record.status,
          ...(interrupted ? { stopReason: "interrupted" } : record.stopReason ? { stopReason: record.stopReason } : {}),
          ...(record.failure ? { error: record.failure } : {}),
          ...(record.supersededBy ? { supersededBy: record.supersededBy } : {}) };
        const { sequence } = this.journal.appendEvent(record.runId, event);
        this.project(parentId, record.runId, event, sequence,
          event.status === "stopped" && event.stopReason !== "superseded" ? { resumable: true } : {});
      }
      this.flush(parentId);
    }
  }

  // ———————————————————————————— Provider environment ————————————————————————————

  /** Every ordinary conversation may launch workflows through the CLI. */
  environment(sessionId: string): Record<string, string> {
    const value = this.deps.session(sessionId);
    if (!value || value.session.workflowParentId || value.session.orchestrationLeadId || value.session.assistantOwnerId) return {};
    this.control.enable(sessionId);
    return {
      ...this.control.environment(sessionId),
      ...(this.launcherPath ? { OMNICODE_WORKFLOW_CLI: this.launcherPath } : {}),
      OMNICODE_WORKFLOW_SKILL_DIR: this.skillDir,
    };
  }

  /** `/workflow` in a turn brings in the authoring guide and the CLI usage. */
  prompt(sessionId: string, text: string): string {
    if (!WORKFLOW_COMMAND.test(text)) return text;
    const value = this.deps.session(sessionId);
    if (!value || value.session.workflowParentId) return text;
    const request = text.replace(WORKFLOW_COMMAND, "$1").trim();
    return [
      "<omnicode-workflows>",
      "The user wants this done as a OmniCode dynamic workflow: a TypeScript script that orchestrates subagents, each running on a OmniCode provider (Pi, Codex, Claude Code, omp, OpenCode…) with its own model, thinking level and speed.",
      "Before writing the script, read the authoring guide at $OMNICODE_WORKFLOW_SKILL_DIR/SKILL.md (patterns.md and examples.md beside it go deeper).",
      `Submit and manage runs with the workflow CLI: "$OMNICODE_WORKFLOW_CLI" workflow --help. Run \`"$OMNICODE_WORKFLOW_CLI" workflow providers --json '{}'\` to see installed providers and their models.`,
      "The run appears as a card in this conversation and in OmniCode's Workflows sidebar.",
      "Once a workflow works and the user wants to keep it, save it with `workflow save` (scope \"project\" or \"global\"); it then appears in OmniCode's saved workflows.",
      "</omnicode-workflows>",
      "",
      request || "Help me design and run a dynamic workflow for this project.",
    ].join("\n");
  }

  // ———————————————————————————— Control CLI ————————————————————————————

  private async handleControl(sessionId: string, action: string, input: Record<string, unknown>): Promise<unknown> {
    return this.inSession(sessionId, () => this.handleMachineControl(sessionId, action, input));
  }

  private async handleMachineControl(sessionId: string, action: string, input: Record<string, unknown>): Promise<unknown> {
    await this.ready;
    const value = this.deps.session(sessionId);
    if (!value) throw new Error("This conversation is no longer available");
    const runId = () => {
      const id = optionalString(input, "runId") ?? optionalString(input, "run_id");
      if (!id) throw new Error("runId is required");
      this.assertOwned(sessionId, id);
      return id;
    };
    switch (action) {
      case "create": return this.submit(sessionId, parseSubmitInput(input), "agent");
      case "amend": return this.amend(sessionId, runId(), input, "agent");
      case "resume": return this.resume(runId());
      case "cancel": return this.cancel(runId(), "model");
      case "get": return this.get(runId());
      case "list": return { runs: this.list(sessionId) };
      case "wait": {
        const seconds = typeof input.timeoutSeconds === "number" ? input.timeoutSeconds : 20;
        return this.wait(runId(), Math.max(0, Math.min(WAIT_MAX_SECONDS, seconds)));
      }
      case "save": return this.saveFromInput(value.session.cwd, input);
      case "saved": return this.savedList(value.session.cwd);
      case "snippet": return this.snippet(value.session.cwd, input);
      case "providers": return { providers: await this.providerCatalog(value.session.cwd) };
      default: throw new Error(`Unknown workflow action ${action}`);
    }
  }

  private assertOwned(sessionId: string, runId: string): void {
    const record = this.journal.getRun(runId);
    const pending = this.pending.get(runId);
    const parent = record?.parentSessionId ?? pending?.parentSessionId;
    if (!parent) throw new Error(`Run ${runId} was not found`);
    if (parent !== sessionId) throw new Error(`Run ${runId} belongs to another conversation`);
  }

  async providerCatalog(cwd: string) {
    const installed = this.deps.providers();
    return Promise.all(installed.map(async (harness) => {
      const models = await this.models(cwd, harness);
      return {
        provider: harness,
        models: models.slice(0, 80).map((model) => ({
          id: model.id.startsWith(`${harness}:`) ? model.id.slice(harness.length + 1) : model.id,
          name: model.name,
          thinking: model.settings?.find((setting) => ["effort", "reasoningEffort", "thinking", "variant", "reasoning"].includes(setting.id) && setting.kind === "select")?.options.map((option) => option.value),
          speed: model.settings?.some((setting) => setting.id === "fast" || setting.id === "serviceTier") ? ["default", "fast"] : undefined,
        })),
      };
    }));
  }

  private modelSource?: (cwd: string, harness: HarnessId) => Promise<AgentModel[]>;

  /** The Host server owns provider catalogs; it lends them to workflow runtime resolution. */
  setModelSource(source: (cwd: string, harness: HarnessId) => Promise<AgentModel[]>): void {
    this.modelSource = source;
  }

  private async models(cwd: string, harness: HarnessId): Promise<AgentModel[]> {
    const key = `${currentMachineIO().key}\0${cwd}\0${harness}`;
    const cached = this.catalogs.get(key);
    if (cached) return cached;
    const source = this.modelSource ?? this.deps.models;
    const models = await source?.(cwd, harness).catch(() => []) ?? [];
    if (models.length) this.catalogs.set(key, models);
    return models;
  }

  // ———————————————————————————— Desktop / mobile RPC ————————————————————————————

  /** `workflows.request`: one Host method, dispatched by `action`. */
  async rpc(params: Record<string, unknown>, projectCwd: (projectId: string) => string, workspaceAllowed: (path: string) => boolean = () => true): Promise<unknown> {
    await this.ready;
    const action = String(params.action ?? "");
    const cwd = () => {
      if (typeof params.projectId === "string") return projectCwd(params.projectId);
      if (typeof params.workspacePath === "string" && params.workspacePath) {
        if (!workspaceAllowed(params.workspacePath)) throw new Error("This folder is not an open project on this machine");
        return params.workspacePath;
      }
      if (params.scope === "global") return currentMachineIO().key === "local" ? homedir() : "/";
      if (typeof params.sessionId === "string") {
        const value = this.deps.session(params.sessionId);
        if (value) return value.session.executionCwd || value.session.cwd;
      }
      throw new Error("projectId or sessionId is required");
    };
    const runId = () => {
      const id = optionalString(params, "runId");
      if (!id) throw new Error("runId is required");
      return id;
    };
    const sessionId = () => {
      const id = optionalString(params, "sessionId");
      if (!id || !this.deps.session(id)) throw new Error("A valid sessionId is required");
      return id;
    };
    const scope = (): SavedWorkflowScope => params.scope === "global" ? "global" : "project";
    switch (action) {
      case "saved.list": {
        const listed = await listSavedWorkflows({ cwd: cwd(), ...(params.scope === "global" || params.scope === "project" ? { scope: params.scope } : {}) });
        return { workflows: listed.entries, invalid: listed.invalid, dir: (await savedWorkflowRoot(cwd(), scope())).dir };
      }
      case "saved.get": {
        const resolved = await resolveSavedWorkflow({ cwd: cwd(), name: String(params.name ?? ""), ...(params.scope === "global" || params.scope === "project" ? { scope: params.scope } : {}) });
        if (!resolved.ok) return resolved;
        return { ok: true, name: resolved.name, path: resolved.path, scope: resolved.scope, meta: resolved.meta, script: resolved.script };
      }
      case "saved.analyze": return this.savedGet(cwd(), String(params.name ?? ""), params.scope === "global" || params.scope === "project" ? params.scope : undefined);
      case "saved.updateMeta": {
        const name = String(params.name ?? "");
        const resolved = await resolveSavedWorkflow({ cwd: cwd(), name, scope: scope() });
        if (!resolved.ok) return resolved;
        const meta = SavedWorkflowMetaSchema.parse(params.meta);
        const saved = await saveSavedWorkflow({ cwd: cwd(), name, scope: scope(), meta, script: resolved.script });
        return { ok: true, path: saved.path };
      }
      case "saved.save": return this.saveFromInput(cwd(), params);
      case "saved.delete": {
        const name = String(params.name ?? "");
        const resolved = await resolveSavedWorkflow({ cwd: cwd(), name, scope: scope() });
        if (!resolved.ok) return resolved;
        await machineFs.rm(resolved.path, { force: true });
        return { ok: true, path: resolved.path };
      }
      case "saved.move": return moveSavedWorkflow({ cwd: cwd(), name: String(params.name ?? "") });
      case "saved.runs": return this.savedRuns(scope() === "global" && !params.workspacePath ? undefined : cwd(), optionalString(params, "name"), typeof params.limit === "number" ? params.limit : 50);
      case "start": {
        const input = recordInput(params, "input") ?? {};
        return this.submit(sessionId(), parseSubmitInput(input), "user");
      }
      case "startInNewSession": {
        if (!this.deps.createSession) throw new Error("This Host cannot create conversations for workflows");
        const input = parseSubmitInput(recordInput(params, "input") ?? {});
        const folder = cwd();
        const harness = normalizeWorkflowHarness(optionalString(params, "harness"));
        const model = optionalString(params, "model");
        const created = await this.deps.createSession(folder, input.name ?? input.saved?.name ?? "Workflow", { ...(harness ? { harness } : {}), ...(model ? { model } : {}) });
        const result = await this.submit(created, input, "user");
        return { ...result, sessionId: created };
      }
      case "approve": return this.approve(runId());
      case "discard": return this.discard(runId());
      case "get": return this.get(runId());
      case "script": return this.script(runId());
      case "nodeResult": return this.nodeResult(runId(), String(params.siteId ?? ""), Number(params.ordinal ?? 0));
      case "artifact": return (await this.readArtifact(String(params.uri ?? ""))) ?? null;
      case "artifacts": return { artifacts: artifactsOf(runId(), this.journal) };
      case "artifactData": return artifactItems(this.deps.db, runId(), String(params.artifactId ?? ""), { ...(typeof params.afterSequence === "number" ? { afterSequence: params.afterSequence } : {}), limit: typeof params.limit === "number" ? params.limit : 100 });
      case "artifactRead": return readArtifactBytes(this.artifacts, this.journal, runId(), String(params.artifactId ?? ""), typeof params.version === "number" ? params.version : undefined, Number(params.offset ?? 0), Number(params.limit ?? 512 * 1024));
      case "events": return this.journal.listEvents(runId(), { ...(typeof params.after === "number" ? { afterSequence: params.after } : {}), limit: 500 });
      case "cancel": return this.cancel(runId(), "user");
      case "resume": return this.resume(runId());
      case "retune": {
        const change: Parameters<HostWorkflows["retune"]>[1] = {};
        if ("maxConcurrency" in params) change.maxConcurrency = params.maxConcurrency === null ? null : Number(params.maxConcurrency);
        if ("defaults" in params) change.defaults = (params.defaults ?? null) as WorkflowAgentRuntime | null;
        if ("agents" in params) change.agents = (params.agents ?? null) as Record<string, WorkflowAgentRuntime> | null;
        return this.retune(runId(), change);
      }
      case "amend": return this.amend(sessionId(), runId(), recordInput(params, "input") ?? {}, "user");
      case "list": return { runs: this.list(sessionId()) };
      case "providers": return { providers: await this.providerCatalog(cwd()) };
      case "ceiling": return { ceiling: workflowConcurrencyCeiling() };
      default: throw new Error(`Unknown workflow request ${action}`);
    }
  }

  // ———————————————————————————— Submit and approval ————————————————————————————

  /** Resolve the script source, analyze it and either start it or hold it for approval. */
  async submit(parentSessionId: string, input: WorkflowSubmitInput, launchedBy: "agent" | "user", amend?: AmendLaunch): Promise<WorkflowSubmitResult> {
    return this.inSession(parentSessionId, () => this.submitOnMachine(parentSessionId, input, launchedBy, amend));
  }

  private async submitOnMachine(parentSessionId: string, input: WorkflowSubmitInput, launchedBy: "agent" | "user", amend?: AmendLaunch): Promise<WorkflowSubmitResult> {
    const amends = amend?.predecessorId;
    await this.ready;
    const parent = this.deps.session(parentSessionId);
    if (!parent) throw new Error("The launching conversation was not found");
    const cwd = parent.session.executionCwd || parent.session.cwd;
    const source = await this.resolveSource(cwd, input);
    if (!source.ok) return source;
    const { script, args, name, scriptPath: givenPath, lineOffset, kind } = source;
    let scriptPath = givenPath;
    const analyzed = analyze(script);
    if (kind.kind === "inline") {
      const draft = await writeWorkflowDraft({ cwd, name: resolveWorkflowDraftName(name, analyzed.graph), source: script }).catch(() => undefined);
      if (draft) scriptPath = draft.path;
    }
    if (!analyzed.analysis.ok) {
      return {
        ok: false,
        reason: "diagnostics",
        message: `The workflow script has ${analyzed.analysis.diagnostics.length} diagnostic(s); nothing ran. Edit the file and resubmit it with path.`,
        diagnostics: formatDiagnostics(analyzed.analysis.diagnostics, scriptPath, lineOffset),
        ...(scriptPath ? { scriptPath } : {}),
      };
    }
    let compiled;
    try { compiled = compileOnce(script); } catch (error) {
      return { ok: false, reason: "compile_failed", message: error instanceof Error ? error.message : String(error), ...(scriptPath ? { scriptPath } : {}) };
    }
    const runId = amend?.runId ?? `dwfrun-${randomUUID()}`;
    const settings: WorkflowRunSettings = {
      maxConcurrency: clampRunConcurrency(input.maxConcurrency),
      ...(input.defaults ? { defaults: input.defaults } : {}),
      ...(input.agents ? { agents: input.agents } : {}),
    };
    const prepared: PreparedRun = {
      runId, parentSessionId, cwd, name, script, settings,
      ...(scriptPath ? { scriptPath } : {}),
      ...(args ? { args } : {}),
      ...(analyzed.phaseNames ? { phaseNames: analyzed.phaseNames } : {}),
      ...(analyzed.phaseAlongside ? { phaseAlongside: analyzed.phaseAlongside } : {}),
      ...(amends ? { resumedFrom: amends } : {}),
    };
    // Every run an agent launches waits for the user, who can adjust its
    // configuration on the card before starting it.
    const needsApproval = launchedBy === "agent";
    const commands = [...compiled.declaredRunCommands].sort();
    const block: WorkflowRunBlock = {
      runId, name, launchedBy, source: kind, settings, createdAt: Date.now(),
      ...(scriptPath ? { scriptPath } : {}),
      ...(analyzed.graph ? { graph: analyzed.graph } : {}),
      ...(commands.length ? { commands } : {}),
      ...(needsApproval ? { approval: "pending" as const } : {}),
      ...(amends ? { amends } : {}),
    };
    this.deps.mutate(parentSessionId, (current) => ({
      ...current,
      session: { ...current.session, blocks: [...current.session.blocks, { id: `workflow-${runId}`, role: "system", text: `Workflow: ${name}`, workflowRun: block }] },
    }), { type: "workflow.submitted", runId });
    if (needsApproval) this.pending.set(runId, { ...prepared, ...(amend ? { amend } : {}) });
    else this.start(prepared, compiled, amend);
    return {
      ok: true, runId, status: needsApproval ? "awaiting_approval" : "running",
      ...(scriptPath ? { scriptPath } : {}),
      ...(analyzed.phaseNames ? { phases: analyzed.phaseNames } : {}),
      ...(commands.length ? { commands } : {}),
    };
  }

  private async resolveSource(cwd: string, input: WorkflowSubmitInput): Promise<
    | { ok: true; script: string; args?: Record<string, unknown>; name: string; scriptPath?: string; lineOffset: number; kind: WorkflowRunSource }
    | { ok: false; reason: string; message: string }> {
    if (input.script !== undefined) return { ok: true, script: input.script, name: input.name?.trim() || "Workflow", lineOffset: 0, kind: { kind: "inline" } };
    if (input.saved) {
      const resolved = await resolveSavedWorkflow({ cwd, name: input.saved.name, ...(input.saved.scope ? { scope: input.saved.scope } : {}) });
      if (!resolved.ok) return { ok: false, reason: `saved_${resolved.reason}`, message: `Saved workflow "${input.saved.name}" could not be used: ${resolved.reason}${"detail" in resolved && resolved.detail ? ` (${resolved.detail})` : ""}` };
      const workflow = resolved;
      const checked = validateWorkflowArgs(workflow.meta.args, input.saved.args);
      if (!checked.ok) return { ok: false, reason: "invalid_args", message: checked.errors.join("; ") };
      return { ok: true, script: workflow.script, args: checked.args, name: input.name?.trim() || workflow.name, scriptPath: workflow.path, lineOffset: workflow.bodyLineOffset, kind: { kind: "saved", name: workflow.name, scope: workflow.scope } };
    }
    const path = machinePath.isAbsolute(input.path!) ? input.path! : machinePath.resolve(cwd, input.path!);
    if (!await machineFs.stat(path).then(() => true, () => false)) return { ok: false, reason: "path_not_found", message: `${path} does not exist` };
    const source = await machineFs.readFile(path, "utf8");
    const parsed = parseSavedWorkflow(source);
    if (parsed.ok) {
      const checked = validateWorkflowArgs(parsed.meta.args, input.args);
      if (!checked.ok) return { ok: false, reason: "invalid_args", message: checked.errors.join("; ") };
      return { ok: true, script: parsed.script, args: checked.args, name: input.name?.trim() || "Workflow", scriptPath: path, lineOffset: parsed.bodyLineOffset, kind: { kind: "path" } };
    }
    if (input.args && Object.keys(input.args).length) return { ok: false, reason: "invalid_args", message: "This file declares no arguments" };
    return { ok: true, script: source, name: input.name?.trim() || "Workflow", scriptPath: path, lineOffset: 0, kind: { kind: "path" } };
  }

  /** The user approved a held run from its card. */
  async approve(runId: string): Promise<{ runId: string }> {
    const prepared = this.pending.get(runId);
    if (!prepared) throw new Error("This run is no longer waiting for approval");
    this.pending.delete(runId);
    let amend = prepared.amend;
    if (amend?.deferred) {
      // Only now does the amended run stop, so its finished work can be reused.
      await this.supersede(amend.predecessorId, runId);
      const built = buildImportedCache(this.journal, amend.predecessorId);
      const spent = this.journal.getRun(amend.predecessorId)?.spentTokens;
      amend = {
        predecessorId: amend.predecessorId,
        runId: amend.runId,
        ...(built.ok ? { importedCache: built.cache } : {}),
        ...(spent ? { inheritedTokens: spent } : {}),
      };
    }
    this.setApproval(prepared.parentSessionId, runId, "approved");
    this.start(prepared, compileOnce(prepared.script), amend);
    return { runId };
  }

  discard(runId: string): { runId: string } {
    const prepared = this.pending.get(runId);
    if (!prepared) throw new Error("This run is no longer waiting for approval");
    this.pending.delete(runId);
    this.setApproval(prepared.parentSessionId, runId, "discarded");
    this.notifyWaiters(runId);
    return { runId };
  }

  private setApproval(parentSessionId: string, runId: string, approval: "approved" | "discarded"): void {
    this.deps.mutate(parentSessionId, (current) => ({
      ...current,
      session: { ...current.session, blocks: current.session.blocks.map((block) => block.workflowRun?.runId === runId ? { ...block, workflowRun: { ...block.workflowRun, approval } } : block) },
    }), { type: `workflow.${approval}`, runId });
  }

  // ———————————————————————————— Running ————————————————————————————

  private runtimeResolver(prepared: Pick<PreparedRun, "parentSessionId" | "cwd">, settings: () => WorkflowRunSettings) {
    return (persona: PersonaSpec, name: string | undefined): WorkflowResolvedRuntime => {
      const parent = this.deps.session(prepared.parentSessionId)?.session;
      const current = settings();
      const override = name ? current.agents?.[name] : undefined;
      const session: WorkflowResolvedRuntime = parent
        ? { harness: parent.harness, model: parent.model, modelSettings: parent.modelSettings ?? {} }
        : { harness: "claude", model: "claude:sonnet-5", modelSettings: {} };
      return resolveWorkflowRuntime({
        layers: [override, personaRuntime(persona), current.defaults],
        session,
        catalog: (harness) => this.catalogs.get(`${currentMachineIO().key}\0${prepared.cwd}\0${harness}`),
      });
    };
  }

  private start(prepared: PreparedRun, compiled: ReturnType<typeof compileOnce>, resume?: { importedCache?: ImportedRunCache; inheritedTokens?: number }): void {
    return this.inSession(prepared.parentSessionId, () => this.startOnMachine(prepared, compiled, resume));
  }

  private startOnMachine(prepared: PreparedRun, compiled: ReturnType<typeof compileOnce>, resume?: { importedCache?: ImportedRunCache; inheritedTokens?: number }): void {
    const abort = new AbortController();
    const settingsRef = { current: prepared.settings };
    const resolveRuntime = this.runtimeResolver(prepared, () => settingsRef.current);
    // Warm provider catalogs so model settings resolve against real options.
    for (const harness of this.deps.providers()) void this.models(prepared.cwd, harness);
    const live: LiveRun = { runId: prepared.runId, parentSessionId: prepared.parentSessionId, abort, settings: prepared.settings, done: Promise.resolve({ status: "stopped", reason: "interrupted" }) };
    Object.defineProperty(live, "settings", { get: () => settingsRef.current, set: (value: WorkflowRunSettings) => { settingsRef.current = value; } });
    this.live.set(prepared.runId, live);
    let lastSequence = -1;
    const journal = this.journal;
    const capturing = new Proxy(journal, {
      get: (target, key, receiver) => key === "appendEvent"
        ? (runId: string, event: RunEvent) => { const stored = target.appendEvent(runId, event); lastSequence = stored.sequence; return stored; }
        : Reflect.get(target, key, receiver),
    });
    const defaultsLabel = prepared.settings.defaults ? describeWorkflowRuntime(resolveRuntime({}, undefined)) : undefined;
    live.done = runWorkflowScript({
      runId: prepared.runId,
      scriptText: prepared.script,
      lowered: compiled.lowered,
      scriptHash: compiled.scriptHash,
      askSpecs: compiled.askSpecs,
      validate: validateFn,
      caps: { maxConcurrency: prepared.settings.maxConcurrency ?? workflowConcurrencyCeiling() },
      cwd: prepared.cwd,
      ...(currentMachineIO().key !== "local" ? { sandboxCwd: this.deps.dataDir } : {}),
      name: prepared.name,
      parentSessionId: prepared.parentSessionId,
      toolCallId: `workflow-${prepared.runId}`,
      ...(prepared.args ? { args: prepared.args } : {}),
      ...(prepared.resumedFrom ? { resumedFrom: prepared.resumedFrom } : {}),
      ...(resume?.importedCache ? { importedCache: resume.importedCache } : {}),
      ...(resume?.inheritedTokens ? { inheritedTokens: resume.inheritedTokens } : {}),
      launch: {
        inputId: `workflow-${prepared.runId}`,
        ...(prepared.phaseNames ? { phaseNames: prepared.phaseNames } : {}),
        ...(prepared.phaseAlongside ? { phaseAlongside: prepared.phaseAlongside } : {}),
        ...(defaultsLabel ? { subagentModel: defaultsLabel } : {}),
        ...(prepared.scriptPath ? { scriptPath: prepared.scriptPath } : {}),
      },
      signal: abort.signal,
      control: { bind: (engine) => { live.engine = engine; } },
      makeDriver: (sink) => {
        const driver = new OmniCodeWorkflowDriver({
          runId: prepared.runId,
          parentSessionId: prepared.parentSessionId,
          cwd: prepared.cwd,
          sink,
          journal: capturing,
          workers: this.deps.workers,
          resolveRuntime,
          declaredRunCommands: compiled.declaredRunCommands,
          artifactStore: this.artifacts,
          recap: (seed) => this.recap(seed),
          emit: (event) => this.onEvent(prepared, event, lastSequence, resolveRuntime),
        });
        live.driver = driver;
        return driver;
      },
    }).catch((error): RunSettlement => {
      console.error("Workflow run failed to start:", error instanceof Error ? error.message : error);
      return { status: "errored", error: error instanceof WorkflowError ? error : new WorkflowError("DriverError", error instanceof Error ? error.message : String(error)) };
    });
    void live.done.then(() => {
      this.live.delete(prepared.runId);
      live.driver?.dispose();
      this.flush(prepared.parentSessionId);
      this.notifyWaiters(prepared.runId);
    });
  }

  private onEvent(prepared: PreparedRun, event: RunEvent, sequence: number, resolveRuntime: (persona: PersonaSpec, name: string | undefined) => WorkflowResolvedRuntime): void {
    const extra: Record<string, unknown> = {};
    if (event.type === "run-started") {
      extra.concurrencyCeiling = workflowConcurrencyCeiling();
      if (prepared.resumedFrom) extra.resumedFrom = prepared.resumedFrom;
    }
    if (event.type === "run-caps-changed") extra.concurrencyCeiling = workflowConcurrencyCeiling();
    if (event.type === "run-settled" && event.status === "stopped" && event.stopReason !== "superseded") extra.resumable = true;
    let actorRuntime: { harness: string; model: string; label: string } | undefined;
    let actorSessionId: string | undefined;
    const actorRef = event.type === "actor-created" ? event.actor : event.type === "node-dispatched" ? event.actor : undefined;
    if (actorRef) {
      actorSessionId = mintActorSessionId(prepared.runId, actorRef);
      const persona: PersonaSpec = event.type === "actor-created" ? { ...(event.persona ?? {}), ...(event.name ? { name: event.name } : {}) } : this.journal.getActor(prepared.runId, actorRef.siteId, actorRef.ordinal)?.persona ?? {};
      try {
        const runtime = resolveRuntime(persona, effectiveActorName(persona));
        actorRuntime = { harness: runtime.harness, model: runtime.model, label: describeWorkflowRuntime(runtime) };
      } catch { /* An invalid provider fails the actor's session; the card shows that failure. */ }
    }
    this.project(prepared.parentSessionId, prepared.runId, event, sequence, extra, actorSessionId, actorRuntime, `workflow-${prepared.runId}`);
    this.notifyWaiters(prepared.runId);
  }

  private project(parentSessionId: string, runId: string, event: RunEvent, sequence: number, extra: Record<string, unknown> = {}, actorSessionId?: string, actorRuntime?: { harness: string; model: string; label: string }, toolCallId = `workflow-${runId}`): void {
    const { type, ...payload } = event;
    const previous = this.states.get(parentSessionId) ?? this.deps.session(parentSessionId)?.session.workflowRuns;
    const next = reduceWorkflowRunsState(previous, {
      runId, toolCallId, sequence, eventType: type,
      payload: { ...(JSON.parse(JSON.stringify(payload)) as Record<string, unknown>), ...extra },
      ...(actorSessionId ? { actorSessionId } : {}),
      ...(actorRuntime ? { actorRuntime } : {}),
    });
    if (!next) return;
    this.states.set(parentSessionId, next);
    if (type === "run-settled" || type === "run-started" || type === "actor-created") { this.flush(parentSessionId); return; }
    if (!this.flushTimers.has(parentSessionId))
      this.flushTimers.set(parentSessionId, setTimeout(() => this.flush(parentSessionId), PROGRESS_FLUSH_MS));
  }

  private flush(parentSessionId: string, final = false): void {
    clearTimeout(this.flushTimers.get(parentSessionId));
    this.flushTimers.delete(parentSessionId);
    const state = this.states.get(parentSessionId);
    if (!state || (this.closing && !final)) return;
    try {
      this.deps.mutate(parentSessionId, (current) => current.session.workflowRuns === state ? current : { ...current, session: { ...current.session, workflowRuns: state } }, { type: "workflow.progress" });
    } catch (error) {
      console.error("Could not save workflow progress:", error instanceof Error ? error.message : error);
    }
  }

  /** What a fresh session continuing an amended actor is told about its earlier asks. */
  private recap(seed: ActorSessionSeed): string | undefined {
    const row = this.deps.db.prepare("SELECT run_id, site_id, ordinal FROM workflow_actors WHERE json_extract(record, '$.sessionId')=? LIMIT 1").get(seed.sourceSessionId);
    if (!row) return undefined;
    const runId = String(row.run_id);
    const nodes = this.journal.listNodes(runId)
      .filter((node) => node.kind === "ask" && node.status === "completed" && node.actorSiteId === String(row.site_id) && node.actorOrdinal === Number(row.ordinal))
      .sort((a, b) => (a.actorSeq ?? 0) - (b.actorSeq ?? 0))
      .slice(0, seed.messageCount);
    if (!nodes.length) return undefined;
    const heads = new Map<string, string>();
    for (const stored of this.journal.listEvents(runId)) {
      const event = stored.event;
      if (event.type === "node-queued" && event.instructionsHead) heads.set(refToString(event.instance), event.instructionsHead);
    }
    return [
      "You are continuing work you started earlier in this workflow, in a fresh session. Your earlier tasks and results were:",
      ...nodes.map((node, index) => `${index + 1}. Task: ${heads.get(`${node.siteId}@${node.ordinal}`) ?? "(earlier task)"}\n   Result: ${text(node.result, 2_000)}`),
    ].join("\n");
  }

  // ———————————————————————————— Amend, resume, cancel, retune ————————————————————————————

  async amend(parentSessionId: string, predecessorId: string, input: Record<string, unknown>, launchedBy: "agent" | "user"): Promise<WorkflowSubmitResult | { ok: true; runId: string; retuned: true }> {
    return this.inSession(parentSessionId, () => this.amendOnMachine(parentSessionId, predecessorId, input, launchedBy));
  }

  private async amendOnMachine(parentSessionId: string, predecessorId: string, input: Record<string, unknown>, launchedBy: "agent" | "user"): Promise<WorkflowSubmitResult | { ok: true; runId: string; retuned: true }> {
    await this.ready;
    const record = this.journal.getRun(predecessorId);
    if (!record) return { ok: false, reason: "run_not_found", message: `Run ${predecessorId} was not found` };
    const block = this.block(parentSessionId, predecessorId);
    const settings: WorkflowRunSettings = { ...(block?.settings ?? {}) };
    if ("maxConcurrency" in input || "max_concurrency" in input) {
      const value = input.maxConcurrency ?? input.max_concurrency;
      if (value === null) delete settings.maxConcurrency;
      else settings.maxConcurrency = clampRunConcurrency(Number(value));
    }
    if ("defaults" in input) { const value = runtimeInput(input.defaults, "defaults"); if (value) settings.defaults = value; else delete settings.defaults; }
    if ("agents" in input) { const value = agentsInput(input.agents); if (value) settings.agents = value; else delete settings.agents; }
    const scriptChanged = input.script !== undefined || input.path !== undefined;
    const settingsOnly = !scriptChanged && Object.keys(input).every((key) => ["runId", "run_id", "maxConcurrency", "max_concurrency"].includes(key));
    if (settingsOnly && this.live.has(predecessorId)) {
      this.retune(predecessorId, { maxConcurrency: settings.maxConcurrency ?? null });
      return { ok: true, runId: predecessorId, retuned: true };
    }
    let script = record.scriptText ?? "";
    let path = block?.scriptPath;
    if (input.script !== undefined) script = String(input.script);
    else if (input.path !== undefined) {
      path = machinePath.isAbsolute(String(input.path)) ? String(input.path) : machinePath.resolve(record.cwd ?? ".", String(input.path));
      if (!await machineFs.stat(path).then(() => true, () => false)) return { ok: false, reason: "path_not_found", message: `${path} does not exist` };
      const source = await machineFs.readFile(path, "utf8");
      const parsed = parseSavedWorkflow(source);
      script = parsed.ok ? parsed.script : source;
    }
    const settingsChanged = JSON.stringify(settings) !== JSON.stringify(block?.settings ?? {});
    if (scriptChanged && scriptHash(script) === record.scriptHash && !settingsChanged)
      return { ok: false, reason: "script_unchanged", message: "The script is byte-identical to the run's and no setting changed; your edit did not land. Nothing was stopped or created." };
    const preflight = preflightAmendImport(this.journal, predecessorId);
    if (!preflight.ok) return { ok: false, reason: preflight.reason, message: `Run ${predecessorId} cannot be amended (${preflight.reason})` };
    // Analyze before stopping anything, so a script that does not compile stops nothing.
    if (scriptChanged) {
      const analyzed = analyze(script);
      if (!analyzed.analysis.ok)
        return { ok: false, reason: "diagnostics", message: "The revised script has diagnostics; nothing was stopped or started.", diagnostics: formatDiagnostics(analyzed.analysis.diagnostics, path), ...(path ? { scriptPath: path } : {}) };
    }
    const successorId = `dwfrun-${randomUUID()}`;
    // An agent's amend waits for the user; its predecessor keeps running until then.
    const deferred = launchedBy === "agent";
    if (!deferred) await this.supersede(predecessorId, successorId);
    const built = deferred ? undefined : buildImportedCache(this.journal, predecessorId);
    return this.submit(parentSessionId, {
      name: optionalString(input, "name") ?? record.name ?? "Workflow",
      ...(path && input.script === undefined ? { path } : { script }),
      ...(record.args && path && input.script === undefined && parseSavedWorkflow(await machineFs.readFile(path, "utf8")).ok ? { args: record.args } : {}),
      ...(settings.maxConcurrency ? { maxConcurrency: settings.maxConcurrency } : {}),
      ...(settings.defaults ? { defaults: settings.defaults } : {}),
      ...(settings.agents ? { agents: settings.agents } : {}),
    }, launchedBy, {
      predecessorId,
      runId: successorId,
      ...(built?.ok ? { importedCache: built.cache } : {}),
      ...(!deferred && record.spentTokens ? { inheritedTokens: record.spentTokens } : {}),
      ...(deferred ? { deferred } : {}),
    });
  }

  private async supersede(predecessorId: string, successorId: string): Promise<void> {
    const live = this.live.get(predecessorId);
    if (!live) return;
    live.abort.abort({ superseded: successorId });
    await live.done;
  }

  async resume(runId: string): Promise<{ ok: true; runId: string } | { ok: false; reason: string; message: string }> {
    await this.ready;
    const record = this.journal.getRun(runId);
    if (!record) return { ok: false, reason: "run_not_found", message: `Run ${runId} was not found` };
    if (this.live.has(runId)) return { ok: false, reason: "running", message: "The run is still running" };
    if (record.status !== "stopped" || record.stopReason === "superseded")
      return { ok: false, reason: "not_resumable", message: `Run ${runId} is ${record.status}${record.stopReason ? ` (${record.stopReason})` : ""} and cannot be resumed; amend it instead.` };
    if (!record.parentSessionId || !record.scriptText) return { ok: false, reason: "not_resumable", message: "The run has no stored script" };
    const block = this.block(record.parentSessionId, runId);
    let compiled;
    try { compiled = compileOnce(record.scriptText); } catch (error) {
      return { ok: false, reason: "compile_failed", message: error instanceof Error ? error.message : String(error) };
    }
    const analyzed = analyze(record.scriptText);
    const importedCache = record.resumedFrom ? (() => { const built = buildImportedCache(this.journal, record.resumedFrom!); return built.ok ? built.cache : undefined; })() : undefined;
    this.start({
      runId,
      parentSessionId: record.parentSessionId,
      cwd: record.cwd ?? this.deps.session(record.parentSessionId)?.session.cwd ?? process.cwd(),
      name: record.name ?? "Workflow",
      script: record.scriptText,
      settings: { ...(block?.settings ?? {}), maxConcurrency: record.caps.maxConcurrency },
      ...(block?.scriptPath ? { scriptPath: block.scriptPath } : {}),
      ...(record.args ? { args: record.args } : {}),
      ...(analyzed.phaseNames ? { phaseNames: analyzed.phaseNames } : {}),
      ...(analyzed.phaseAlongside ? { phaseAlongside: analyzed.phaseAlongside } : {}),
      ...(record.resumedFrom ? { resumedFrom: record.resumedFrom } : {}),
    }, compiled, importedCache ? { importedCache } : undefined);
    return { ok: true, runId };
  }

  async cancel(runId: string, reason: "user" | "model" = "user"): Promise<{ ok: true; runId: string; status: RunStatus | "discarded" }> {
    if (this.pending.has(runId)) { this.discard(runId); return { ok: true, runId, status: "discarded" }; }
    const live = this.live.get(runId);
    if (!live) return { ok: true, runId, status: this.journal.getRun(runId)?.status ?? "stopped" };
    live.abort.abort(reason);
    await live.done;
    return { ok: true, runId, status: this.journal.getRun(runId)?.status ?? "stopped" };
  }

  /** Live settings change: concurrency applies in place; runtimes apply to subagents created from now on. */
  retune(runId: string, change: { maxConcurrency?: number | null; defaults?: WorkflowAgentRuntime | null; agents?: Record<string, WorkflowAgentRuntime> | null }): WorkflowRunSettings {
    const live = this.live.get(runId);
    const record = this.journal.getRun(runId);
    const parentSessionId = live?.parentSessionId ?? record?.parentSessionId ?? this.pending.get(runId)?.parentSessionId;
    if (!parentSessionId) throw new Error(`Run ${runId} was not found`);
    const block = this.block(parentSessionId, runId);
    const settings: WorkflowRunSettings = { ...(live?.settings ?? block?.settings ?? {}) };
    if (change.maxConcurrency !== undefined) {
      settings.maxConcurrency = change.maxConcurrency === null ? workflowConcurrencyCeiling() : clampRunConcurrency(change.maxConcurrency);
      live?.engine?.setMaxConcurrency(settings.maxConcurrency);
    }
    if (change.defaults !== undefined) { if (change.defaults) settings.defaults = runtimeInput(change.defaults, "defaults"); else delete settings.defaults; }
    if (change.agents !== undefined) { if (change.agents) settings.agents = agentsInput(change.agents); else delete settings.agents; }
    if (live) live.settings = settings;
    const pending = this.pending.get(runId);
    if (pending) pending.settings = settings;
    this.deps.mutate(parentSessionId, (current) => ({
      ...current,
      session: { ...current.session, blocks: current.session.blocks.map((item) => item.workflowRun?.runId === runId ? { ...item, workflowRun: { ...item.workflowRun, settings } } : item) },
    }), { type: "workflow.retuned", runId });
    return settings;
  }

  // ———————————————————————————— Queries ————————————————————————————

  private block(parentSessionId: string, runId: string): WorkflowRunBlock | undefined {
    return this.deps.session(parentSessionId)?.session.blocks.find((block: Block) => block.workflowRun?.runId === runId)?.workflowRun;
  }

  private runState(record: RunRecord): WorkflowRunState | undefined {
    if (!record.parentSessionId) return undefined;
    return (this.states.get(record.parentSessionId) ?? this.deps.session(record.parentSessionId)?.session.workflowRuns)?.runs.find((run) => run.runId === record.runId);
  }

  get(runId: string) {
    const pending = this.pending.get(runId);
    if (pending) return { runId, name: pending.name, status: "awaiting_approval", scriptPath: pending.scriptPath, settings: pending.settings };
    const record = this.journal.getRun(runId);
    if (!record) throw new Error(`Run ${runId} was not found`);
    const state = this.runState(record);
    const block = record.parentSessionId ? this.block(record.parentSessionId, runId) : undefined;
    const actors = this.journal.listActors(runId);
    return {
      runId,
      name: record.name,
      status: this.live.has(runId) ? "running" : record.status,
      ...(record.stopReason ? { stopReason: record.stopReason } : {}),
      resumable: record.status === "stopped" && record.stopReason !== "superseded" && !this.live.has(runId),
      ...(record.resumedFrom ? { resumedFrom: record.resumedFrom } : {}),
      ...(record.supersededBy ? { supersededBy: record.supersededBy } : {}),
      scriptPath: block?.scriptPath,
      settings: block?.settings,
      spentTokens: record.spentTokens,
      phases: state?.phases,
      currentPhase: state?.currentPhase,
      subagents: actors.map((actor) => {
        let runtime: WorkflowResolvedRuntime | undefined;
        try { runtime = actor.resolvedModel ? JSON.parse(actor.resolvedModel) as WorkflowResolvedRuntime : undefined; } catch { runtime = undefined; }
        return { name: actor.name, sessionId: actor.sessionId, ...(runtime ? { runtime: describeWorkflowRuntime(runtime) } : {}) };
      }),
      nodes: this.journal.listNodes(runId).map((node) => ({
        id: `${node.siteId}@${node.ordinal}`, kind: node.kind, status: node.status,
        ...(node.error ? { error: node.error.message } : {}),
        ...(node.stats ? { tokens: node.stats.tokens } : {}),
      })),
      reports: state?.reports,
      ...(record.result !== undefined ? { result: record.result } : {}),
      ...(record.failure ? { error: record.failure } : {}),
    };
  }

  list(parentSessionId: string) {
    const pending = [...this.pending.values()].filter((run) => run.parentSessionId === parentSessionId).map((run) => ({ runId: run.runId, name: run.name, status: "awaiting_approval" }));
    return [...pending, ...this.journal.listRunsForParent(parentSessionId).map((record) => ({
      runId: record.runId, name: record.name, status: this.live.has(record.runId) ? "running" : record.status,
      ...(record.stopReason ? { stopReason: record.stopReason } : {}), spentTokens: record.spentTokens,
    }))];
  }

  async wait(runId: string, seconds: number) {
    const settled = () => {
      if (this.pending.has(runId)) return false;
      const record = this.journal.getRun(runId);
      return !record || (TERMINAL_RUN_STATUSES.has(record.status) && !this.live.has(runId));
    };
    if (!settled() && seconds > 0) {
      await new Promise<void>((resolveWait) => {
        const timer = setTimeout(done, seconds * 1000);
        const waiters = this.waiters.get(runId) ?? new Set();
        this.waiters.set(runId, waiters);
        let fired = false;
        function done() { if (fired) return; fired = true; clearTimeout(timer); waiters.delete(check); resolveWait(); }
        const check = () => { if (settled()) done(); };
        waiters.add(check);
      });
    }
    return { ...this.get(runId), settled: settled() };
  }

  private notifyWaiters(runId: string): void {
    for (const check of this.waiters.get(runId) ?? []) check();
  }

  /** Runs and their live state for the desktop's Workflows views. */
  runsFor(parentSessionIds: readonly string[]) {
    return parentSessionIds.flatMap((id) => this.list(id).map((run) => ({ ...run, parentSessionId: id })));
  }

  nodeResult(runId: string, siteId: string, ordinal: number) {
    const node = this.journal.getNode(runId, siteId, ordinal);
    if (!node) throw new Error("This step has no recorded result");
    return { status: node.status, kind: node.kind, result: node.result, error: node.error, stats: node.stats };
  }

  script(runId: string): { script: string; scriptPath?: string } {
    const record = this.journal.getRun(runId);
    const pending = this.pending.get(runId);
    if (pending) return { script: pending.script, ...(pending.scriptPath ? { scriptPath: pending.scriptPath } : {}) };
    if (!record?.scriptText) throw new Error("This run has no stored script");
    const block = record.parentSessionId ? this.block(record.parentSessionId, runId) : undefined;
    return { script: record.scriptText, ...(block?.scriptPath ? { scriptPath: block.scriptPath } : {}) };
  }

  async readArtifact(uri: string): Promise<{ contentType: string; base64: string } | undefined> {
    const stored = await this.artifacts.read(uri);
    return stored ? { contentType: stored.contentType, base64: stored.bytes.toString("base64") } : undefined;
  }

  // ———————————————————————————— Saved workflows ————————————————————————————

  /** Run history for the saved-workflows hub: runs in a project (or all), optionally by name. */
  savedRuns(cwd: string | undefined, name: string | undefined, limit: number) {
    const maximum = Math.max(1, Math.min(50, limit));
    const rows: Array<{ record: string; created_at: number }> = [];
    const candidates = this.deps.db.prepare(`SELECT record, created_at FROM workflow_runs
      WHERE (? IS NULL OR json_extract(record, '$.cwd') = ?) AND (? IS NULL OR json_extract(record, '$.name') = ?)
      ORDER BY created_at DESC`).iterate(cwd ?? null, cwd ?? null, name ?? null, name ?? null);
    for (const row of candidates) {
      const record = JSON.parse(String(row.record)) as RunRecord;
      if (cwd !== undefined && this.deps.machineIO) {
        try {
          if (!record.parentSessionId || this.deps.machineIO(record.parentSessionId).key !== currentMachineIO().key) continue;
        } catch { continue; }
      }
      rows.push({ record: String(row.record), created_at: Number(row.created_at) });
      if (rows.length > maximum) break;
    }
    const runs = rows.slice(0, maximum).map((row) => {
      const record = JSON.parse(String(row.record)) as RunRecord;
      const createdAt = Number(row.created_at);
      const last = this.journal.listEvents(record.runId).at(-1);
      const state = this.runState(record);
      return {
        runId: record.runId,
        ...(record.name ? { name: record.name } : {}),
        status: this.live.has(record.runId) ? "running" : record.status,
        ...(record.stopReason ? { stopReason: record.stopReason } : {}),
        createdAt,
        updatedAt: last?.timeCreated ?? createdAt,
        spentTokens: record.spentTokens,
        ...(record.parentSessionId ? { parentSessionId: record.parentSessionId } : {}),
        ...(record.args ? { args: record.args } : {}),
        ...(record.cwd ? { cwd: record.cwd } : {}),
        ...(state?.artifacts?.length ? { artifacts: state.artifacts.slice(0, 8).map((artifact) => ({ id: artifact.id, kind: artifact.kind, ...(artifact.title ? { title: artifact.title } : {}), version: artifact.version, ...(artifact.contentType ? { contentType: artifact.contentType } : {}) })) } : {}),
      };
    });
    return { runs, ...(rows.length > runs.length ? { truncated: true } : {}) };
  }

  async savedList(cwd: string): Promise<{ workflows: (SavedWorkflowEntry & { script?: string })[]; invalid: { path: string; reason: string }[] }> {
    const listed = await listSavedWorkflows({ cwd });
    return { workflows: listed.entries, invalid: listed.invalid };
  }

  async savedGet(cwd: string, name: string, scope?: SavedWorkflowScope) {
    const resolved = await resolveSavedWorkflow({ cwd, name, ...(scope ? { scope } : {}) });
    if (!resolved.ok) throw new Error(`Saved workflow "${name}" could not be read: ${resolved.reason}`);
    const analyzed = analyze(resolved.script);
    return { ...resolved, ...(analyzed.graph ? { graph: analyzed.graph } : {}), ...(analyzed.phaseNames ? { phases: analyzed.phaseNames } : {}) };
  }

  async saveFromInput(cwd: string, input: Record<string, unknown>) {
    const name = optionalString(input, "name") ?? "";
    if (!isValidSavedWorkflowName(name)) throw new Error("name must use letters, digits, '.', '-' or '_' (at most 64 characters)");
    const description = optionalString(input, "description");
    if (!description?.trim()) throw new Error("description is required");
    const scope = input.scope;
    if (scope !== "project" && scope !== "global") throw new Error("scope must be project or global");
    const scriptPath = optionalString(input, "scriptPath") ?? optionalString(input, "script_path");
    let script = optionalString(input, "script");
    if ((script === undefined) === (scriptPath === undefined)) throw new Error("Pass exactly one of script or scriptPath");
    if (scriptPath) {
      const path = machinePath.isAbsolute(scriptPath) ? scriptPath : machinePath.resolve(cwd, scriptPath);
      const source = await machineFs.readFile(path, "utf8");
      const parsed = parseSavedWorkflow(source);
      script = parsed.ok ? parsed.script : source;
    }
    const args = input.args === undefined ? undefined : SavedWorkflowArgsDeclarationSchema.parse(input.args);
    const analyzed = analyze(script!);
    if (!analyzed.analysis.ok) return { ok: false, reason: "diagnostics", diagnostics: formatDiagnostics(analyzed.analysis.diagnostics) };
    const whenToUse = optionalString(input, "whenToUse");
    const root = await savedWorkflowRoot(cwd, scope);
    const existed = await machineFs.stat(savedWorkflowPath(root, name)).then(() => true, () => false);
    const saved = await saveSavedWorkflow({ cwd, name, scope, meta: { description: description.trim(), ...(whenToUse ? { whenToUse } : {}), ...(args ? { args } : {}) }, script: script! });
    return { ok: true, name, scope, path: saved.path, overwritten: existed };
  }

  async savedDelete(cwd: string, name: string, scope: SavedWorkflowScope): Promise<{ deleted: true }> {
    if (!isValidSavedWorkflowName(name)) throw new Error("Invalid workflow name");
    await machineFs.rm(savedWorkflowPath(await savedWorkflowRoot(cwd, scope), name), { force: true });
    return { deleted: true };
  }

  async snippet(cwd: string, input: Record<string, unknown>) {
    const code = optionalString(input, "code");
    const path = optionalString(input, "path");
    if ((code === undefined) === (path === undefined)) throw new Error("Pass exactly one of code or path");
    const source = code ?? await machineFs.readFile(machinePath.isAbsolute(path!) ? path! : machinePath.resolve(cwd, path!), "utf8");
    const timeoutMs = Math.max(1_000, Math.min(600_000, typeof input.timeoutMs === "number" ? input.timeoutMs : 60_000));
    const result = await evalSnippet({ cwd, code: source, timeoutMs, ...(recordInput(input, "args") ? { args: recordInput(input, "args") } : {}) });
    return result.kind === "diagnostics" ? { kind: "diagnostics", diagnostics: formatDiagnostics(result.diagnostics, path) } : result;
  }

  /** The Host's home for workflows saved globally. */
  static globalDirectory(): string {
    return join(homedir(), ".omnicode", "workflows");
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const timer of this.flushTimers.values()) clearTimeout(timer);
    const live = [...this.live.values()];
    for (const run of live) run.abort.abort("interrupted");
    await Promise.all(live.map((run) => run.done.catch(() => undefined)));
    // The store remains open until close() returns. Publish the final projection
    // even though ordinary progress writes are suppressed during shutdown.
    for (const parentId of this.states.keys()) this.flush(parentId, true);
    await this.control.close();
  }

  /** Parent directory used for generated control launchers and skill files. */
  get directory(): string { return dirname(this.skillDir); }

  /** The bounded result preview a parent conversation sees in run lists. */
  static preview(value: unknown): string { return text(value, RESULT_PREVIEW_CHARS); }
}
