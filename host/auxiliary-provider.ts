import { dirname, join } from "node:path";
import type { ProviderAuxiliaryRequest, ProviderAuxiliaryResult, ProviderAuxiliaryView } from "../src/contracts/providerAuxiliary";
import { buildBranchNamePrompt, buildCommitMessagePrompt, buildPrContentPrompt, formatCommitMessage, parseBranchName, parseCommitMessage, parsePrContent } from "../src/domain/gitText";
import { currentMachineIO } from "./machine-io";
import { resolveHostWorktreeAsync } from "./git-worktrees";
import { resolveDefaultAccount } from "./provider-accounts";
import { runHostTextPrompt, supportsHostTextPrompt } from "./provider-text";
import type { HostStore } from "./store";
import type { WorkspaceCommands } from "./workspace-commands";

const RETAIN_MS = 5 * 60_000;
const DEADLINE_MS = 120_000;
const PREFERRED = ["claude", "cursor", "codex", "grok", "opencode"];
type RecordState = {
  fingerprint?: string;
  view: ProviderAuxiliaryView;
  controller: AbortController;
  finished?: number;
  settled: Promise<void>;
};

function requestId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error("Invalid auxiliary request ID");
  return value;
}

function decode(input: Record<string, unknown>): ProviderAuxiliaryRequest {
  const id = requestId(input.requestId);
  if (typeof input.projectId !== "string" || !input.projectId || input.projectId.length > 200 ||
      !["commit", "pullRequest", "branch"].includes(String(input.operation))) throw new Error("Invalid auxiliary request");
  for (const key of ["cwd", "harness", "providerAccountId", "message"] as const)
    if (input[key] !== undefined && (typeof input[key] !== "string" || (input[key] as string).length > (key === "message" ? 100_000 : 4096)))
      throw new Error("Invalid auxiliary request");
  if (input.providerAccountId !== undefined && !/^[A-Za-z0-9_-]{1,80}$/.test(String(input.providerAccountId))) throw new Error("Invalid provider account");
  if (input.operation === "branch" && (typeof input.message !== "string" || !input.message.trim())) throw new Error("A message is required for a branch name");
  return { requestId: id, projectId: input.projectId, operation: input.operation as ProviderAuxiliaryRequest["operation"],
    ...(input.cwd !== undefined ? { cwd: input.cwd as string } : {}),
    ...(input.harness !== undefined ? { harness: input.harness as string } : {}),
    ...(input.providerAccountId !== undefined ? { providerAccountId: input.providerAccountId as string } : {}),
    ...(input.message !== undefined ? { message: input.message as string } : {}) };
}

/** Short-lived generated text is device-owned; session transcripts never pass
 * through this cache. Host BTW writes its own projection through the engine. */
export class HostAuxiliaryProvider {
  private readonly requests = new Map<string, RecordState>();
  private closed = false;

  constructor(
    private readonly store: HostStore,
    private readonly workspace: Pick<WorkspaceCommands, "run">,
    private readonly available: () => Promise<readonly string[]>,
    private readonly runText = runHostTextPrompt,
    private readonly resolveAccount = resolveDefaultAccount,
  ) {}

  start(owner: string, raw: Record<string, unknown>): ProviderAuxiliaryView {
    if (this.closed) throw new Error("Host is shutting down");
    this.prune();
    const input = decode(raw);
    const key = `${owner}:${input.requestId}`;
    const fingerprint = JSON.stringify([currentMachineIO().key, input]);
    const existing = this.requests.get(key);
    if (existing) {
      if (existing.fingerprint && existing.fingerprint !== fingerprint) throw new Error("Auxiliary request ID was already used with different content");
      return existing.view;
    }
    if (this.requests.size >= 256 || [...this.requests].filter(([id, value]) => id.startsWith(`${owner}:`) && value.view.status === "running").length >= 8)
      throw new Error("Too many auxiliary provider requests");
    const record: RecordState = { fingerprint, view: { status: "running" }, controller: new AbortController(), settled: Promise.resolve() };
    this.requests.set(key, record);
    const timer = setTimeout(() => { record.controller.abort(); }, DEADLINE_MS);
    timer.unref();
    record.settled = Promise.resolve().then(() => this.generate(input, record.controller.signal)).then(
      result => { if (!record.controller.signal.aborted) record.view = { status: "completed", result }; },
      error => { if (!record.controller.signal.aborted) record.view = { status: "failed", error: error instanceof Error ? error.message : String(error) }; },
    ).finally(() => {
      clearTimeout(timer);
      if (record.controller.signal.aborted) record.view = { status: "cancelled" };
      record.finished = Date.now();
    });
    return record.view;
  }

  async read(owner: string, id: unknown): Promise<ProviderAuxiliaryView> {
    this.prune();
    const value = this.requests.get(`${owner}:${requestId(id)}`);
    if (!value) throw new Error("Auxiliary provider request is unavailable");
    if (value.view.status === "running") {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([value.settled, new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); })]); }
      finally { clearTimeout(timer); }
    }
    return value.view;
  }

  cancel(owner: string, id: unknown): ProviderAuxiliaryView {
    this.prune();
    const key = `${owner}:${requestId(id)}`;
    const existing = this.requests.get(key);
    if (existing) {
      if (existing.view.status === "running") {
        existing.controller.abort();
        existing.view = { status: "cancelled" };
        existing.finished = Date.now();
      }
      return existing.view;
    }
    // A cancelled HTTP start may arrive after cancel. Retain a bounded tombstone
    // so that race cannot launch an orphaned provider request.
    if (this.requests.size >= 256) throw new Error("Too many auxiliary provider requests");
    const controller = new AbortController();
    controller.abort();
    const view = { status: "cancelled" } as const;
    this.requests.set(key, { view, controller, finished: Date.now(), settled: Promise.resolve() });
    return view;
  }

  close(): void {
    this.closed = true;
    for (const value of this.requests.values()) value.controller.abort();
    this.requests.clear();
  }

  private prune() {
    for (const [key, value] of this.requests)
      if (value.finished && Date.now() - value.finished > RETAIN_MS) this.requests.delete(key);
  }

  private async generate(input: ProviderAuxiliaryRequest, signal: AbortSignal): Promise<ProviderAuxiliaryResult> {
    signal.throwIfAborted();
    const project = this.store.project(input.projectId);
    const cwd = await resolveHostWorktreeAsync(project.cwd, input.cwd);
    const available = await this.available();
    const harness = [input.harness, ...PREFERRED].find((provider): provider is string =>
      !!provider && available.includes(provider) && supportsHostTextPrompt(provider));
    if (!harness) throw new Error("The selected agent does not support text generation on this Host");
    const providerAccountId = this.resolveAccount(join(dirname(this.store.attachmentDir), "desktop-owner.json"), harness,
      harness === input.harness ? input.providerAccountId : undefined);
    const run = async (prompt: string) => {
      signal.throwIfAborted();
      return this.runText({ harness, cwd, providerAccountId, prompt, signal, timeoutMs: 90_000, intent: "plan" });
    };
    if (input.operation === "branch") return { operation: "branch", branch: parseBranchName(await run(buildBranchNamePrompt(input.message!))) };
    if (input.operation === "commit") {
      const context = await this.workspace.run("git_staged_context", { cwd }) as { branch: string | null; summary: string; patch: string };
      const output = await run(buildCommitMessagePrompt({ branch: context.branch, stagedSummary: context.summary, stagedPatch: context.patch }));
      const parsed = parseCommitMessage(output);
      if (!parsed) throw new Error("Could not generate a commit message");
      return { operation: "commit", message: formatCommitMessage(parsed) };
    }
    const range = await this.workspace.run("git_range_context", { cwd }) as { base: string; head: string; commitSummary: string; diffSummary: string; diffPatch: string };
    const output = await run(buildPrContentPrompt({ baseBranch: range.base, headBranch: range.head, ...range }));
    const parsed = parsePrContent(output);
    return { operation: "pullRequest", base: range.base, head: range.head,
      title: parsed?.title || range.commitSummary.split(/\r?\n/)[0]?.trim() || `Update ${range.head}`,
      body: parsed?.body || range.commitSummary.trim() };
  }
}
