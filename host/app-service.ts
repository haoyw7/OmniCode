import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ACTIONS, type AppSessionLaunch, type AppSessionPlacement } from "../src/contracts/app";
import type { CommandReceipt, HostSession } from "../src/contracts/protocol";
import type { RemoteProvider } from "../src/contracts/provider";
import type { Note } from "../src/contracts/session";
import { handleAgentApp, type AgentAppHost } from "../src/domain/agentApp";
import { operatorEnabledInThread } from "../src/domain/operatorCommand";
import { modelsFor, resolveModel, defaultModelId } from "../src/integrations/harness/core/modelCatalog";
import { DesktopAppCommands } from "./app-desktop";
import { claimCheckoutResource } from "./checkout-guards";
import { HostControl } from "./control";
export { APP_HELP } from "./control";
import { createHostWorktree } from "./git-worktrees";
import type { HostNotes } from "./notes";
import type { HostStore } from "./store";
import { detailedHostWorktrees } from "./worktree-lifecycle";

export const OPERATOR_DEFAULT_PROMPT = "Explain what you can do in OmniCode with the app CLI.";

export type HostAppServiceDeps = {
  store: HostStore;
  notes: HostNotes;
  providers: () => RemoteProvider[];
  session(id: string): HostSession | undefined;
  command(raw: unknown): CommandReceipt;
  /** Runs Git work on the project's execution machine. */
  inProject<T>(projectId: string, operation: () => Promise<T>): Promise<T>;
  assertProjectWrite(projectId: string): void;
  assertWorkspaceWrite(path: string): void;
  dataDir: string;
  entry?: string;
  node?: string;
};

/** Stable Host command IDs stay inside the protocol's 128-character limit. */
function appCommandId(key: string): string {
  return `app-${createHash("sha256").update(key).digest("hex").slice(0, 40)}`;
}

/** /operator access: Host executes app actions and only window presentation goes to desktop. */
export class HostAppService {
  readonly control: HostControl;
  readonly desktop = new DesktopAppCommands();
  private launcherPath?: Promise<string>;

  constructor(private readonly deps: HostAppServiceDeps) {
    this.control = new HostControl(
      (sessionId, requestId, action, input, authorize) => this.handle(sessionId, requestId, action, input, authorize),
      { namespace: "app", actions: APP_ACTIONS },
    );
  }

  /** Workers, managed children and assistant brains never receive app credentials. */
  accepts(value: HostSession | undefined): value is HostSession {
    return !!value && !value.session.orchestrationLeadId && !value.session.workflowParentId &&
      !value.session.assistantOwnerId && !value.session.inboxAsk && !value.session.nativeSession;
  }

  /** The token is installed with the provider process but only works during /operator turns. */
  environment(sessionId: string): Record<string, string> {
    if (!this.accepts(this.deps.session(sessionId))) return {};
    if (!Object.keys(this.control.environment(sessionId)).length) this.control.enable(sessionId);
    return this.control.environment(sessionId);
  }

  private launcher(): Promise<string> {
    this.launcherPath ??= this.control.launcher(join(this.deps.dataDir, "app-control"),
      this.deps.entry ?? join(dirname(fileURLToPath(import.meta.url)), "cli.ts"), this.deps.node);
    return this.launcherPath;
  }

  /** Appended to the provider text of the turn that enabled /operator. */
  async prompt(text: string): Promise<string> {
    const cli = `"${(await this.launcher()).replaceAll('"', "")}" app`;
    return `${text}\n\n<omnicode_app>\nThe user's Operator command enables app access in this thread, including later turns without the command. You can start session tabs or split session panes right or down, list and create project worktrees, choose a new session's checkout, read and continue other project sessions, save unsent drafts, and read or write saved notes through its local CLI. Run \`${cli} --help\` for exact commands and JSON fields, then use it as needed for the user's request. When reading another session, start with its latest two or three user/assistant exchanges. Request older exchanges with nextBefore or a larger excerpt only if needed. The CLI uses a session credential already in your environment; never print it. New sessions inherit this session's permission mode unless runtimeMode is set explicitly. For a new session with a draft, call sessions.start with its prompt and draft:true; do not submit a seed prompt. The returned ID can be used as besideSessionId to split its pane again. A normal sessions.start submits its prompt but returns after acceptance, so do not wait for that agent to finish before organizing it.\n</omnicode_app>`;
  }

  disable(sessionId: string) { this.control.disable(sessionId); }

  async handle(sessionId: string, requestId: string, action: string, input: Record<string, unknown>, authorize: () => boolean): Promise<unknown> {
    const value = this.deps.session(sessionId);
    // Matches the old desktop rule: a token works only during an opted-in turn.
    if (!this.accepts(value) || value.status !== "running" || !operatorEnabledInThread(value.session.blocks))
      throw new Error("App access is inactive. Ask the user to enable /operator in this conversation.");
    const project = this.deps.store.project(value.projectId);
    const source = { ...value.session, cwd: project.cwd };
    return handleAgentApp(source, requestId, action, input, this.host(value, authorize));
  }

  private host(source: HostSession, authorize: () => boolean): AgentAppHost {
    const { store } = this.deps;
    const projectId = source.projectId;
    const projectSession = (id: string) => {
      const value = store.sessionIfExists(id);
      return value && value.projectId === projectId && this.listed(value) ? value : undefined;
    };
    const submit = (id: string, prompt: string, key: string, type: "send" | "draft") => {
      const target = projectSession(id);
      if (!target) throw new Error("Session was not found in this project");
      const commandId = appCommandId(key);
      if (target.session.blocks.some(block => block.id === commandId) || target.session.queuedMessages?.some(row => row.id === commandId))
        return true;
      if (target.status === "running" || target.session.queuedMessages?.length)
        throw new Error("This session is busy. Wait for it to finish first.");
      if (target.session.blocks.some(block => block.draft))
        throw new Error("This session has an unsent draft. Send or remove it in OmniCode first.");
      this.deps.command({ type, commandId, sessionId: id, text: prompt, ...(type === "send" ? { appRequestId: key } : {}) });
      return false;
    };
    return {
      available: harness => this.deps.providers().includes(harness as RemoteProvider),
      modelsFor: harness => modelsFor(harness),
      resolveModel: (harness, id) => resolveModel(harness, id),
      preferredModelId: harness => defaultModelId(harness),
      sessions: async () => store.summaries(projectId)
        .filter(summary => !summary.inboxAsk && !summary.orchestrationLeadId && !summary.workflowParentId && !summary.assistantOwnerId)
        .map(summary => ({
          id: summary.id, title: summary.title, harness: summary.harness, model: summary.model ?? "",
          busy: summary.status === "running", hasDraft: !!summary.draft,
        })),
      session: async id => projectSession(id)?.session ?? null,
      send: async (id, prompt, key) => ({ alreadySubmitted: submit(id, prompt, key, "send") }),
      draft: async (id, prompt, key) => ({ alreadySaved: submit(id, prompt, key, "draft"), draft: true }),
      start: (launch, key, placement) => this.start(source, launch, key, placement, authorize),
      worktrees: () => this.deps.inProject(projectId, () => detailedHostWorktrees(store, store.project(projectId).cwd)),
      createWorktree: (_cwd, branch, base, existing) => this.deps.inProject(projectId, async () => {
        const cwd = store.project(projectId).cwd;
        this.deps.assertProjectWrite(projectId);
        const release = claimCheckoutResource(store, `worktree-create:${randomBytes(8).toString("hex")}`, cwd);
        try {
          const created = await createHostWorktree(cwd, branch, base, existing);
          return { ...(await detailedHostWorktrees(store, cwd)).worktrees.find(tree => tree.path === created.path), ...created } as never;
        } finally { release(); }
      }),
      notes: async () => this.deps.notes.list(),
      note: async id => { try { return this.deps.notes.get(id); } catch { return null; } },
      saveNote: async note => this.deps.notes.upsert(note) as Note,
    };
  }

  private listed(value: HostSession): boolean {
    return !value.session.inboxAsk && !value.session.orchestrationLeadId && !value.session.workflowParentId && !value.session.assistantOwnerId;
  }

  private async start(source: HostSession, launch: AppSessionLaunch, key: string, placement: AppSessionPlacement | undefined, authorize: () => boolean): Promise<string> {
    const { store } = this.deps;
    const createId = appCommandId(`${key}:create`);
    const row = store.db.prepare("SELECT receipt FROM receipts WHERE id=?").get(createId);
    const existing = row ? (JSON.parse(String(row.receipt)) as CommandReceipt).sessionId : undefined;
    // A split must have a visible anchor; check before creating anything.
    if (placement) await this.desktop.available(source.session.id, authorize);
    let executionCwd = launch.executionCwd;
    let autoWorktreeBranch: string | undefined;
    if (!existing && launch.workspaceMode === "worktree") {
      autoWorktreeBranch = `oc/${createHash("sha256").update(key).digest("hex").slice(0, 8)}`;
      const created = await this.deps.inProject(source.projectId, async () => {
        const cwd = store.project(source.projectId).cwd;
        this.deps.assertProjectWrite(source.projectId);
        const release = claimCheckoutResource(store, `worktree-create:${randomBytes(8).toString("hex")}`, cwd);
        try { return await createHostWorktree(cwd, autoWorktreeBranch, launch.worktreeBase ?? "HEAD", false); }
        finally { release(); }
      });
      executionCwd = created.path;
    }
    const id = existing ?? this.deps.command({
      type: "create", commandId: createId, projectId: source.projectId, harness: launch.harness, model: launch.model,
      runtimeMode: launch.runtimeMode ?? source.session.runtimeMode,
      ...(launch.modelSettings ? { modelSettings: launch.modelSettings } : {}),
      ...(executionCwd ? { executionCwd } : {}),
      ...(autoWorktreeBranch ? { autoWorktreeBranch } : {}),
    }).sessionId;
    const created = store.session(id);
    const textId = appCommandId(`${key}:prompt`);
    if (!created.session.blocks.some(block => block.id === textId))
      this.deps.command({ type: launch.draft ? "draft" : "send", commandId: textId, sessionId: id, text: launch.prompt,
        ...(launch.draft ? {} : { appRequestId: key }) });
    const command = {
      id: appCommandId(`${key}:reveal`), sourceSessionId: source.session.id, sessionId: id, projectId: source.projectId,
      action: "sessions.reveal" as const, reveal: launch.reveal, ...(placement ? { placement } : {}),
    };
    if (placement) await this.desktop.deliver(command, authorize);
    // The session already exists in Host history; an absent window only skips the tab.
    else await this.desktop.deliver(command, authorize).catch(() => undefined);
    return id;
  }

  async close() {
    this.desktop.close();
    await this.control.close();
  }
}
