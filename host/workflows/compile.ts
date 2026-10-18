// Compile-once and snippet evaluation for workflow scripts. Adapted from ZCode's
// bootstrap dynamic-workflow-run-submit.ts and dynamic-workflow-snippet-service.ts
// (Apache-2.0).

import { createHash, randomUUID } from "node:crypto";
import { availableParallelism, tmpdir } from "node:os";
import { currentMachineIO } from "../machine-io";
import {
  analyzeWorkflowScript,
  buildAskSpecs,
  collectDiagnostics,
  collectSites,
  collectWorldRunCommands,
  createWorkflowProgram,
  InMemoryJournalStore,
  lowerWorkflow,
  SNIPPET_FACADE_DTS,
  synthesizeAskSchemas,
  validate,
  WorkflowError,
  type AnalyzeResult,
  type AskSpec,
  type CompileDiagnostic,
  type RunEvent,
  type WorkflowDriver,
} from "../../src/integrations/workflow/dynamic-workflow/index.js";
import { boundCausalityGraph } from "../../src/integrations/workflow/graphBounds.js";
import {
  createWorkflowPhaseAlongside,
  createWorkflowPhaseNames,
  type CreateWorkflowCausalityGraph,
} from "../../src/integrations/workflow/createWorkflow.js";
import { runWorkflowScript } from "./runtime/harness.js";
import { executeWorldRead } from "./world-read.js";
import { nodeExecutionPort, nodeFileSystemPort } from "./node-ports.js";

export const validateFn = (schema: unknown, value: unknown) => validate(schema as never, value);

/** Process-wide subagent ceiling: max(1, min(16, cores - 2)), as in ZCode. */
export function workflowConcurrencyCeiling(cores = availableParallelism()): number {
  return Math.max(1, Math.min(16, cores - 2));
}

export function clampRunConcurrency(requested: number | undefined, ceiling = workflowConcurrencyCeiling()): number {
  if (requested === undefined || !Number.isFinite(requested)) return ceiling;
  return Math.max(1, Math.min(ceiling, Math.floor(requested)));
}

export interface CompiledWorkflow {
  askSpecs: ReadonlyMap<string, AskSpec>;
  declaredRunCommands: ReadonlySet<string>;
  lowered: string;
  scriptHash: string;
}

export interface AnalyzedWorkflow {
  analysis: AnalyzeResult;
  graph?: CreateWorkflowCausalityGraph;
  phaseNames?: string[];
  phaseAlongside?: number[][];
}

export function analyze(script: string): AnalyzedWorkflow {
  const analysis = analyzeWorkflowScript(script);
  const graph = analysis.causality === undefined ? undefined : boundCausalityGraph(analysis.causality, analysis.flow, analysis.handoff);
  const phaseNames = graph ? createWorkflowPhaseNames(graph) : undefined;
  const phaseAlongside = graph ? createWorkflowPhaseAlongside(graph) : undefined;
  return {
    analysis,
    ...(graph ? { graph } : {}),
    ...(phaseNames ? { phaseNames } : {}),
    ...(phaseAlongside ? { phaseAlongside } : {}),
  };
}

export function scriptHash(script: string): string {
  return createHash("sha256").update(script, "utf8").digest("hex");
}

/** One ts.Program feeds the site table, schema synthesis and lowering. */
export function compileOnce(script: string): CompiledWorkflow {
  const workflow = createWorkflowProgram(script);
  const diagnostics = collectDiagnostics(workflow.program);
  if (diagnostics.length > 0) throw new Error(`The workflow script does not typecheck (${diagnostics.length} diagnostics); no run was created`);
  const table = collectSites(workflow);
  const { diagnostics: schemaDiagnostics, schemas } = synthesizeAskSchemas(workflow, table);
  if (schemaDiagnostics.length > 0)
    throw new Error(`Unsupported ask result types: ${schemaDiagnostics.map((d) => `L${d.line}:C${d.column} ${d.message}`).join("; ")}`);
  const worldRun = collectWorldRunCommands(workflow, table);
  if (worldRun.diagnostics.length > 0) throw new Error("world.run commands must be string literals; no run was created");
  return {
    askSpecs: buildAskSpecs(table, schemas),
    declaredRunCommands: new Set(worldRun.commands),
    lowered: lowerWorkflow(workflow, table).code,
    scriptHash: scriptHash(script),
  };
}

const MAX_SNIPPET_LOGS = 200;
const MAX_SNIPPET_LOG_CHARS = 4_000;
const MAX_SNIPPET_RESULT_BYTES = 256 * 1024;

export type SnippetResult =
  | { kind: "diagnostics"; diagnostics: CompileDiagnostic[] }
  | { kind: "completed"; result?: unknown; logs: string[]; logsTruncated: boolean }
  | { kind: "failed"; error: { code: string; message: string }; logs: string[]; logsTruncated: boolean };

/** Runs a world-read snippet synchronously; nothing is journaled or persisted. */
export async function evalSnippet(input: { cwd: string; code: string; args?: Record<string, unknown>; timeoutMs: number; signal?: AbortSignal }): Promise<SnippetResult> {
  const workflow = createWorkflowProgram(input.code, { facadeDts: SNIPPET_FACADE_DTS });
  const diagnostics = collectDiagnostics(workflow.program);
  if (diagnostics.length > 0) return { kind: "diagnostics", diagnostics };
  const table = collectSites(workflow);
  const worldRun = collectWorldRunCommands(workflow, table);
  if (worldRun.diagnostics.length > 0) return { kind: "diagnostics", diagnostics: worldRun.diagnostics };
  const logs: string[] = [];
  let logsTruncated = false;
  const capture = (event: RunEvent) => {
    if (event.type !== "log") return;
    if (logs.length >= MAX_SNIPPET_LOGS) { logsTruncated = true; return; }
    if (event.message.length > MAX_SNIPPET_LOG_CHARS) logsTruncated = true;
    logs.push(event.message.slice(0, MAX_SNIPPET_LOG_CHARS));
  };
  const unreachable = (member: string) => new WorkflowError("DriverError", `Snippet driver received ${member}; snippets have no agent().`);
  const deps = { fileSystemPort: nodeFileSystemPort, executionPort: nodeExecutionPort, cwd: input.cwd, declaredRunCommands: new Set(worldRun.commands) };
  const driver: WorkflowDriver = {
    createActorSession: () => Promise.reject(unreachable("createActorSession")),
    startAsk: () => { throw unreachable("startAsk"); },
    respondToSubmit: () => { throw unreachable("respondToSubmit"); },
    cancelAsk: () => {},
    executeWorldRead: (op, args) => executeWorldRead(deps, op, args),
    journal: new InMemoryJournalStore(),
    emit: capture,
  };
  const settlement = await runWorkflowScript({
    askSpecs: buildAskSpecs(table, {}),
    caps: { maxConcurrency: workflowConcurrencyCeiling() },
    cwd: input.cwd,
    ...(currentMachineIO().key !== "local" ? { sandboxCwd: tmpdir() } : {}),
    lowered: lowerWorkflow(workflow, table).code,
    makeDriver: () => driver,
    runId: `dwfeval-${randomUUID()}`,
    ...(input.args ? { args: input.args } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    timeoutMs: input.timeoutMs,
    validate: validateFn,
  });
  if (settlement.status === "completed") {
    const bytes = settlement.artifact === undefined ? 0 : Buffer.byteLength(JSON.stringify(settlement.artifact), "utf8");
    if (bytes > MAX_SNIPPET_RESULT_BYTES)
      return { kind: "failed", error: { code: "ArtifactTooLarge", message: `The snippet's return value serializes to ${bytes} bytes, over the cap of ${MAX_SNIPPET_RESULT_BYTES} bytes. Return a summary instead.` }, logs, logsTruncated };
    return { kind: "completed", ...(settlement.artifact === undefined ? {} : { result: settlement.artifact }), logs, logsTruncated };
  }
  const error = settlement.status === "errored" ? settlement.error : settlement.error;
  return { kind: "failed", error: error ? { code: error.code, message: error.message } : { code: "Cancelled", message: "Snippet evaluation was cancelled" }, logs, logsTruncated };
}

export function formatDiagnostics(diagnostics: readonly CompileDiagnostic[], path?: string, lineOffset = 0): string[] {
  return diagnostics.map((d) => `${path ? `${path}:` : ""}L${d.line + lineOffset}:C${d.column} ${d.message}`);
}
