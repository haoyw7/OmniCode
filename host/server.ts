import { dirname } from "node:path";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { hostname, homedir } from "node:os";
import { realpath, stat } from "node:fs/promises";
import { currentMachineIO, machineExec as exec } from "./machine-io";
import { projectMachineKey } from "../src/integrations/harness/core/machine";
import { createHash, randomUUID } from "node:crypto";
import { claimCheckoutResource, claimCheckoutWrite, withCheckoutIntegration } from "./checkout-guards";
import { HOST_PROTOCOL_VERSION, HOST_UNAVAILABLE_CODE, type HostModelCatalog } from "../src/contracts/protocol";
import { HOST_DESKTOP_APP_CAPABILITY } from "../src/contracts/app";
import { parseRelocate } from "./session-relocate";
import { isHostUnavailable } from "./host-unavailable";
import { type RemoteProvider } from "../src/contracts/provider";
import { HostEngine } from "./engine";
import { HostClientState } from "./client-state";
import { HostPreferenceAssets } from "./preference-assets";
import { HostAccountManagement } from "./account-management";
import { HostProviderLogin } from "./provider-login";
import { HostMedia } from "./media";
import { HOST_INBOX_MEDIA_CAPABILITY, HOST_LINK_PREVIEW_CAPABILITY, HOST_ATTACHMENT_READ_CAPABILITY } from "../src/contracts/hostMedia";
import { HostProviderManagement } from "./provider-management";
import { HOST_PROVIDER_RUNTIME_CAPABILITY } from "../src/contracts/providerRuntime";
import { fetchHostOpenCodeUsage } from "./opencode-usage";
import { fetchHostPiUsage } from "./pi-usage";
import { HOST_OPENCODE_USAGE_CAPABILITY, HOST_PI_USAGE_CAPABILITY, HOST_USAGE_RESET_CAPABILITY } from "../src/contracts/providerUsage";
import { HOST_PROVIDER_LOGIN_CAPABILITY } from "../src/contracts/providerLogin";
import { HOST_CLIENT_STATE_CAPABILITY } from "../src/contracts/hostState";
import { PairingCodeError } from "./store";
import { botErrorCode } from "./bots/thread/errors";
import { writeAttachmentChunk, readAttachmentChunk } from "./attachments";
import type { LinkedWorkItem, AgentModel } from "../src/contracts/session";
import { parseGithubWorkItemUrl } from "../src/domain/workItemIdentity";
import { SyncTransfers } from "./sync-transfer";
import { browseHostDirectories } from "./browse";
import { pairingHostCandidates } from "./pairing-hosts";
import {
  createHostBranch,
  hostBranches,
  switchHostBranch,
} from "./git-branches";
import {
  createHostWorktree,
  HostWorktreeStatus,
  resolveHostWorktreeAsync,
} from "./git-worktrees";
import {
  createHostPath,
  hostFileDiff,
  hostGitAction,
  hostGitIndex,
  indexHostFiles,
  listHostFiles,
  readHostFile,
  searchHostContent,
  searchHostFiles,
  writeHostFile,
} from "./workspace";
import { WorkspaceCommands } from "./workspace-commands";
import { HostAuxiliaryProvider } from "./auxiliary-provider";
import { HostMcp } from "./mcp";
import { HOST_MCP_CAPABILITY } from "../src/contracts/mcp";
import { PROVIDER_AUXILIARY_CAPABILITY } from "../src/contracts/providerAuxiliary";
import { ProjectMoves } from "./project-moves";
import { HostWorktreeLifecycle, detailedHostWorktrees } from "./worktree-lifecycle";
import { WorktreeCreationProgress } from "./worktree-progress";
import { HOST_WORKTREE_PROGRESS_CAPABILITY } from "../src/contracts/worktree";
import { InboxCredentials } from "./inbox-credentials";
import { HostLinear } from "./linear";
import { HostJira } from "./jira";
import { HostGitlab } from "./gitlab";
import { HostAzureDevOps } from "./azure-devops";
import { HostGithub } from "./github";
import { discoverCodexModels } from "../src/integrations/harness/providers/codex/codexCatalog";
import { discoverClaudeModels } from "../src/integrations/harness/providers/claude/claudeCatalog";
import { discoverCursorModels } from "../src/integrations/harness/providers/cursor/cursorCatalog";
import { discoverGrokModels } from "../src/integrations/harness/providers/grok/grokCatalog";
import { discoverOpenCodeModels } from "../src/integrations/harness/providers/opencode/opencodeCatalog";
import { discoverPiModels, discoverOmpModels } from "../src/integrations/harness/providers/pi/piCatalog";
import { discoverFxModels } from "../src/integrations/harness/providers/fx/fxCatalog";
import { discoverHermesModels } from "../src/integrations/harness/providers/hermes/hermesCatalog";
import { discoverDeepseekAccount, discoverDeepseekModels } from "../src/integrations/harness/providers/deepseek/deepseekCatalog";
import type { DeepseekAccountClient } from "../src/integrations/harness/providers/deepseek/deepseekAccount";
import { resolveDeepseekBinary, resolveAntigravityBinary, resolveClaudeBinary, resolveCodexBinary, resolveCursorBinary, resolveFxBinary, resolveGrokBinary, resolveHermesBinary, resolveOmpBinary, resolveOpenCodeBinary, resolvePiBinary, resolveWorkBuddyBinary } from "../src/integrations/harness/core/child";
import { discoverAntigravityModels } from "../src/integrations/harness/providers/antigravity/antigravityCatalog";
import { discoverWorkBuddyModels } from "../src/integrations/harness/providers/workbuddy/workbuddyAdapter";
import { setHarnessModels } from "../src/integrations/harness/core/modelCatalog";



// Providers also add models server-side, without a CLI update.
const CATALOG_MAX_AGE_MS = 5 * 60_000;
const resolveBinary: Record<RemoteProvider, () => Promise<{ path: string }>> = {
  deepseek: () => resolveDeepseekBinary(),
  workbuddy: () => resolveWorkBuddyBinary(),
  codex: () => resolveCodexBinary(),
  claude: () => resolveClaudeBinary(),
  cursor: () => resolveCursorBinary(),
  grok: () => resolveGrokBinary(),
  opencode: () => resolveOpenCodeBinary(),
  pi: () => resolvePiBinary(),
  omp: () => resolveOmpBinary(),
  fx: () => resolveFxBinary(),
  hermes: () => resolveHermesBinary(),
  antigravity: () => resolveAntigravityBinary(),
};
// A 1 MiB text file can expand to 6 MiB when JSON escapes control characters.
// Existing files.write sends both the original and replacement contents.
// A 20 MiB note image needs about 27 MiB after base64 encoding.
const MAX_BODY = 32 * 1024 * 1024;
const discoverModels: Record<RemoteProvider, (cwd: string) => Promise<AgentModel[]>> = {
  deepseek: discoverDeepseekModels,
  workbuddy: discoverWorkBuddyModels,
  codex: discoverCodexModels,
  claude: discoverClaudeModels,
  cursor: discoverCursorModels,
  grok: discoverGrokModels,
  opencode: discoverOpenCodeModels,
  pi: discoverPiModels,
  omp: discoverOmpModels,
  fx: discoverFxModels,
  hermes: discoverHermesModels,
  antigravity: discoverAntigravityModels,
};

async function body(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("Request is too large");
    chunks.push(chunk);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid request");
  return value as Record<string, unknown>;
}

/** Identifies one installed provider CLI. An update changes its real path or
 * modification time, which invalidates the models the old version reported. */
async function providerBinary(provider: RemoteProvider): Promise<string> {
  try {
    const file = await realpath((await resolveBinary[provider]()).path);
    return `${file}:${(await stat(file)).mtimeMs}`;
  } catch {
    return "missing";
  }
}

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function createHostServer(
  engine: HostEngine,
  providers: RemoteProvider[],
  lifecycle?: (request: IncomingMessage, response: ServerResponse) => void,
  discoverProviders?: () => Promise<RemoteProvider[]>,
) {
  const clientState = new HostClientState(engine.store);
  const preferenceAssets = new HostPreferenceAssets(engine.store);
  const accounts = new HostAccountManagement(dirname(engine.store.attachmentDir), (provider, accountId) => engine.stopProviderAccount(provider, accountId));
  const providerLogin = new HostProviderLogin(dirname(engine.store.attachmentDir));
  const providerManagement = new HostProviderManagement(dirname(engine.store.attachmentDir), async provider => (await resolveBinary[provider]()).path);
  const inboxCredentials = new InboxCredentials(dirname(engine.store.attachmentDir));
  const linear = new HostLinear(inboxCredentials);
  const jira = new HostJira(inboxCredentials);
  const gitlab = new HostGitlab(inboxCredentials);
  const azureDevOps = new HostAzureDevOps(inboxCredentials);
  const github = new HostGithub();
  const providerUsage = engine.providerUsage;
  let discovering: Promise<RemoteProvider[]> | undefined;
  const availableProviders = () => {
    if (!discoverProviders) return Promise.resolve(providers);
    if (!discovering)
      discovering = discoverProviders().finally(() => {
        discovering = undefined;
      });
    return discovering;
  };
  const describeEnvironment = async (params: Record<string, unknown>) => ({
    protocolVersion: HOST_PROTOCOL_VERSION,
    environmentId: engine.store.environmentId,
    name: hostname(),
    platform: process.platform,
    // Older clients validate this list against Codex and Claude only.
    providers: (await availableProviders()).filter((provider) =>
      Array.isArray(params.supportedProviders)
        ? params.supportedProviders.includes(provider)
        : provider === "codex" || provider === "claude"
    ),
    capabilities: [
      HOST_CLIENT_STATE_CAPABILITY,
      HOST_INBOX_MEDIA_CAPABILITY,
      HOST_LINK_PREVIEW_CAPABILITY,
      HOST_ATTACHMENT_READ_CAPABILITY,
      "preferences.read",
      "preferences.patch",
      "preferences.assets.upload",
      "preferences.assets.read",
      "workspaces.read",
      "workspaces.save",
      "connections.list",
      "connections.patch",
      "environments.v1",
      "sessions",
      "sessions.inbox.v1",
      "sessions.sync.wait.v1",
      "projects.browse",
      "projects.createChat",
      "projects.move.v1",
      "inbox.linear.v1",
      "inbox.github.v1",
      "inbox.azuredevops.v1",
      "inbox.jira.v1",
      "inbox.gitlab.v1",
      "sessions.btw.v1",
      "sessions.submit.v1",
      "sessions.outcome.v1",
      "sessions.planEdit.v1",
      "sessions.usageLimit.v1",
      "models.list",
      "models.refresh.v1",
      PROVIDER_AUXILIARY_CAPABILITY,
      "providerAccounts.defaults",
      "providerAccounts.manage.v1",
      HOST_PROVIDER_LOGIN_CAPABILITY,
      HOST_PROVIDER_RUNTIME_CAPABILITY,
      HOST_MCP_CAPABILITY,
      "providerAccounts.usage.v1",
      HOST_OPENCODE_USAGE_CAPABILITY,
      HOST_PI_USAGE_CAPABILITY,
      HOST_USAGE_RESET_CAPABILITY,
      "providerAccounts.deepseek.v1",
      "skills.list",
      "notes.v1",
      "automations.v1",
      "reminders.v1",
      "approvals",
      "questions",
      "diff",
      "git.branches",
      "git.switch",
      "git.createBranch",
      "git.worktrees",
      "git.worktreeCreate",
      HOST_WORKTREE_PROGRESS_CAPABILITY,
      "git.worktreeLifecycle.v1",
      "files.read",
      "files.list",
      "files.index",
      "workspace.run",
      "files.search",
      "files.searchContent",
      "files.create",
      "files.write",
      "git.index",
      "git.fileDiff",
      "git.action",
      "attachments.upload",
      "attachments.read",
      "sessions.draft",
      "sessions.plan",
      "sessions.handoff",
      "sessions.queue",
      "sessions.activity",
      "sessions.nativeAccess",
      "sessions.refreshNative",
      "sessions.switchAccount",
      "sessions.stopBackgroundTask",
      "sessions.checkpoint",
      "sessions.relocate",
      HOST_DESKTOP_APP_CAPABILITY,
      "nativeSources.list",
      "nativeSources.import",
      "nativeSources.syncAll",
      "sessions.orchestration",
      "assistant.v1",
      "assistant.history",
      "assistant.timeline",
      "assistant.persona",
      "bots.shell.v1",
      "bots.v1",
      "botThreads.v1",
      "botMemory.v1",
      "bots.runtime.v1",
      "bots.management.v1",
      "bots.delegation.v1",
      "bots.teams.v1",
      "bots.rooms.v1",
      "im.feishu.v1",
      "im.feishu.binding.v1",
      "resources",
      "workflows.v1",
    ],
  });
  // Cached per project and provider so one failing or slow CLI never forces
  // every other provider to be probed again on the next visit.
  const catalogs = new Map<
    string,
    {
      binary: string;
      /** When the last successful probe finished; 0 while the first is pending. */
      probed: number;
      models: Promise<AgentModel[]>;
      refreshing?: Promise<void>;
      failedAt?: number;
    }
  >();
  const transfers = new SyncTransfers();
  const media = new HostMedia();
  const worktreeProgress = new WorktreeCreationProgress();
  const worktreeStatus = new HostWorktreeStatus();
  const linkedWorktree = (projectId: string, cwd: string) => {
    const project = engine.store.project(projectId);
    if (engine.machines?.workspaceReady(project.machine) === false) return Promise.resolve(false);
    return engine.machines
      ? engine.machines.run(project.machine, () => worktreeStatus.isLinked(cwd))
      : worktreeStatus.isLinked(cwd);
  };
  const workspace = new WorkspaceCommands(
    engine.store,
    (projectId, action) => engine.withIdleProject(projectId, action),
    (path) => engine.assertWorkspaceWrite(path),
  );
  const projectMoves = new ProjectMoves(engine.store, engine.checkpoints);
  const auxiliaryProviders = new HostAuxiliaryProvider(engine.store, workspace, availableProviders);
  const mcp = new HostMcp(engine.store);
  const worktreeLifecycle = new HostWorktreeLifecycle(engine.store);
  const moveProject = (id: string, to: string, rename: boolean) => {
    const projects = projectMoves.affectedProjects(id).sort((a, b) => a.id.localeCompare(b.id));
    const move = async () => {
      for (const project of projects) engine.assertWorkspaceWrite(project.cwd);
      for (const project of projects) await engine.releaseProjectBindings(project.id);
      const moved = await projectMoves.move(id, to, rename);
      workspace.invalidateRoots();
      return moved;
    };
    const idle = (index: number): ReturnType<typeof move> => index === projects.length ? move()
      : engine.withIdleProject(projects[index].id, () => idle(index + 1));
    return idle(0);
  };
  // A cold catalog can start an entire CLI (and its extensions) per provider.
  // Share the budget across projects, clients and stale-cache refreshes.
  let activeProbes = 0;
  const waitingProbes: Array<() => void> = [];
  const discover = async (cwd: string, provider: RemoteProvider) => {
    if (activeProbes >= 2)
      await new Promise<void>(resolve => waitingProbes.push(resolve));
    else activeProbes++;
    try {
      const discovered = await discoverModels[provider](cwd);
      if (discovered.length) setHarnessModels(provider, discovered);
      return discovered;
    } finally {
      const next = waitingProbes.shift();
      if (next) next();
      else activeProbes--;
    }
  };
  // Cached per project and provider so one failing or slow CLI never forces
  // every other provider to be probed again. An expired list keeps answering
  // while its replacement is discovered in the background.
  const providerModels = async (cwd: string, provider: RemoteProvider, retainFailure = false, force = false) => {
    const key = `${cwd}\n${provider}`;
    const binary = await providerBinary(provider);
    const cached = catalogs.get(key);
    if (cached?.binary === binary && (!force || (!cached.probed && !cached.failedAt)) &&
        (!cached.failedAt || (retainFailure && Date.now() - cached.failedAt < 15_000))) {
      if (cached.probed && Date.now() - cached.probed >= CATALOG_MAX_AGE_MS && !cached.refreshing) {
        const next = discover(cwd, provider);
        cached.refreshing = next.then(
          () => { if (catalogs.get(key) === cached) catalogs.set(key, { binary, probed: Date.now(), models: next }); },
          () => { if (catalogs.get(key) === cached) cached.refreshing = undefined; },
        );
      }
      return cached.models;
    }
    const entry = { binary, probed: 0, models: discover(cwd, provider), failedAt: 0 };
    catalogs.set(key, entry);
    entry.models.then(
      () => { entry.probed = Date.now(); },
      // A failure between progressive polls must be returned by the next poll,
      // rather than silently starting the same slow, failing probe again.
      () => { entry.failedAt = Date.now(); },
    );
    return entry.models;
  };
  const models = async (projectId?: unknown, progressive = false, requested?: unknown, force = false) => {
    const cwd = engine.modelCatalogDirectory(typeof projectId === "string" ? projectId : undefined);
    const available = (await availableProviders()).filter(provider =>
      !Array.isArray(requested) || requested.includes(provider));
    const result: HostModelCatalog = { models: {}, errors: {} };
    const pending = new Set(available);
    const complete = Promise.all(
      available.map(async (provider) => {
        try {
          result.models[provider] = await providerModels(cwd, provider, progressive && Array.isArray(requested), force);
        } catch (error) {
          result.errors[provider] =
            error instanceof Error ? error.message : String(error);
        } finally {
          pending.delete(provider);
        }
      }),
    );
    if (!progressive) {
      await complete;
      return result;
    }
    // A cold/slow CLI must not hold already available models behind its timeout.
    // Keep discovery in the provider cache; subsequent reads join the same work.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([complete, new Promise<void>(resolve => {
        timer = setTimeout(resolve, 150);
      })]);
    } finally {
      clearTimeout(timer);
    }
    return { models: { ...result.models }, errors: { ...result.errors }, pending: [...pending] };
  };
  engine.orchestration.setCatalog(async (projectId) => {
    const catalog = await models(projectId);
    return Object.entries(catalog.models).flatMap(([harness, entries]) =>
      (entries ?? []).map((model) => ({ harness: harness as RemoteProvider, model: model.id, name: model.name })));
  });
  engine.bots.setCatalog(availableProviders, models);
  engine.workflows.setModelSource((cwd, harness) => providerModels(cwd, harness as RemoteProvider));
  const resourceId = (token: string, value: unknown) => {
    if (typeof value !== "string" || !/^[A-Za-z0-9_:-]{1,200}$/.test(value)) throw new Error("Invalid editor resource identity");
    return `device:${createHash("sha256").update(token).digest("hex")}:${value}`;
  };
  const mutateFiles = async <T>(_projectId: string, cwd: string, action: () => Promise<T>): Promise<T> => {
    engine.assertWorkspaceWrite(cwd);
    const release = claimCheckoutWrite(engine.store, `workspace:${randomUUID()}`, cwd);
    try { return await action(); } finally { release(); }
  };
  const mutateWorkspace = <T>(projectId: string, cwd: string, action: () => Promise<T>): Promise<T> =>
    engine.withIdleProject(projectId, () => {
      engine.assertWorkspaceWrite(cwd);
      return withCheckoutIntegration(engine.store, [cwd], action);
    });
  const server = createServer(
    { requestTimeout: 20_000, headersTimeout: 10_000, maxHeaderSize: 8192 },
    async (request, response) => {
      if (request.url === "/lifecycle" && lifecycle) {
        // Administration stays on loopback even when adapters are exposed.
        if (!isLoopback(request.socket.localAddress)) {
          response.writeHead(403).end();
          return;
        }
        lifecycle(request, response);
        return;
      }
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      let assistantRequest = false;
      try {
        // Desktop native HTTP supplies credentials. This endpoint intentionally
        // accepts no browser origin and provides no permissive CORS escape hatch.
        if (
          request.headers.origin ||
          request.method !== "POST" ||
          request.url !== "/rpc"
        ) {
          response
            .writeHead(403)
            .end(
              JSON.stringify({ error: "Unsupported request origin or route" }),
            );
          return;
        }
        const token = request.headers.authorization?.match(
          /^Bearer ([A-Za-z0-9_-]+)$/,
        )?.[1];
        if (!token || (!engine.store.authenticated(token) && !engine.store.hasPairingCode(token))) {
          response.writeHead(401).end(
            JSON.stringify({
              error: "Device credential is invalid or revoked",
            }),
          );
          return;
        }
        const input = await body(request);
        if (input.method === "devices.pair") {
          if (input.version !== HOST_PROTOCOL_VERSION)
            throw new Error("Incompatible protocol version");
          const params = input.params && typeof input.params === "object" && !Array.isArray(input.params)
            ? input.params as Record<string, unknown> : {};
          const expected = params.expectedEnvironmentId;
          if (expected !== undefined && expected !== engine.store.environmentId)
            throw new Error("Host identity changed; reconnect this machine explicitly");
          await engine.ready;
          // Finish fallible Host discovery before spending the scanned code.
          const host = await describeEnvironment(params);
          const device = engine.store.transaction(() => {
            const paired = engine.store.redeemPairingCode(token);
            engine.store.updateDeviceInfo(paired.token, params.deviceInfo);
            engine.store.touchDevice(paired.token);
            return paired;
          });
          response.end(JSON.stringify({ result: { ...device, host } }));
          return;
        }
        assistantRequest = typeof input.method === "string" && /^(assistant|bots|botThreads|botMemory|botTeams|botRooms|botDelegations)\./.test(input.method);
        // Reading a request body yields: a device may have been revoked since
        // the headers arrived. Reject it before dispatching any operation.
        if (!engine.store.authenticated(token)) {
          response.writeHead(401).end(JSON.stringify({
            error: "Device credential is invalid or revoked",
          }));
          return;
        }
        engine.store.touchDevice(token);
        if (input.version !== HOST_PROTOCOL_VERSION)
          throw new Error("Incompatible protocol version");
        await engine.ready;
        if (
          input.method !== "environment.describe" &&
          input.environmentId !== engine.store.environmentId
        )
          throw new Error(
            "Host identity changed; reconnect this machine explicitly",
          );
        const params =
          input.params &&
          typeof input.params === "object" &&
          !Array.isArray(input.params)
            ? (input.params as Record<string, unknown>)
            : {};
        if (typeof params.sessionId === "string" && engine.store.isAssistantSession(params.sessionId)) throw new Error("Assistant brain is private");
        const execute = async () => {
        let result: unknown;
        switch (input.method) {
          case "environment.describe":
            engine.store.updateDeviceInfo(token, params.deviceInfo);
            result = await describeEnvironment(params);
            break;
          case "preferences.read":
            result = clientState.preferencesRead(params);
            break;
          case "preferences.patch":
            result = clientState.preferencesPatch(params);
            break;
          case "preferences.assets.upload":
            result = preferenceAssets.upload(params);
            break;
          case "preferences.assets.read":
            result = preferenceAssets.read(params);
            break;
          case "workspaces.read":
            result = clientState.workspacesRead(params);
            break;
          case "workspaces.save":
            result = clientState.workspacesSave(params);
            break;
          case "connections.list":
            result = clientState.connectionsList(params);
            break;
          case "connections.patch":
            result = clientState.connectionsPatch(params);
            break;
          case "environments.list":
          case "environments.patch":
            // Variables can hold secrets; paired devices never read them.
            if (!engine.store.adminToken(token)) throw new Error("Only this computer's desktop can manage environments");
            result = input.method === "environments.list"
              ? clientState.environmentsList(params)
              : clientState.environmentsPatch(params);
            break;
          case "projects.list":
            result = engine.store.projects();
            break;
          case "inbox.run": {
            if (typeof params.command !== "string" || !/^(linear|jira|gitlab|azure_devops|git_github)_/.test(params.command)) throw new Error("Unsupported inbox operation");
            if (["linear_set_token", "jira_set_config", "gitlab_set_config", "azure_devops_set_config"].includes(params.command) && !engine.store.adminToken(token)) throw new Error("Only this computer's desktop can manage inbox connections");
            const args = params.args && typeof params.args === "object" && !Array.isArray(params.args) ? { ...params.args as Record<string, unknown> } : {};
            if (params.command.startsWith("git_github_") && params.command !== "git_github_status" || ["gitlab_repo", "gitlab_list_work_items", "azure_devops_repo", "azure_devops_list_work_items"].includes(params.command)) {
              args.cwd = engine.store.project(String(params.projectId ?? "")).cwd;
            }
            if (params.command.startsWith("git_github_")) {
              const release = typeof args.cwd === "string" ? claimCheckoutResource(engine.store, `github:${randomUUID()}`, args.cwd) : undefined;
              try { result = await github.run(params.command, args); } finally { release?.(); }
            } else result = await (params.command.startsWith("azure_devops_") ? azureDevOps : params.command.startsWith("gitlab_") ? gitlab : params.command.startsWith("jira_") ? jira : linear).run(params.command, args);
            break;
          }
          case "projects.browse":
            result = await browseHostDirectories(params.path);
            break;
          case "projects.open":
            result = await engine.openProject(String(params.cwd ?? ""));
            break;
          case "projects.createChat":
            result = await engine.createChat();
            break;
          case "projects.rename":
          case "projects.rebase":
            result = await moveProject(String(params.projectId ?? ""), String(params.cwd ?? ""), input.method === "projects.rename");
            break;
          case "models.list":
            result = await models(params.projectId, params.progressive === true, params.providers, params.force === true);
            break;
          case "providers.auxiliary.start":
          case "providers.auxiliary.read":
          case "providers.auxiliary.cancel": {
            const owner = createHash("sha256").update(token).digest("hex");
            result = input.method === "providers.auxiliary.start" ? auxiliaryProviders.start(owner, params)
              : input.method === "providers.auxiliary.read" ? await auxiliaryProviders.read(owner, params.requestId)
              : auxiliaryProviders.cancel(owner, params.requestId);
            break;
          }
          case "mcp.discover":
            result = await mcp.discover(params);
            break;
          case "mcp.start":
          case "mcp.status":
          case "mcp.cancel": {
            if (input.method === "mcp.start" && ["add", "remove", "login"].includes(String(params.operation)) && !engine.store.adminToken(token))
              throw new Error("Only this computer's desktop can change MCP servers");
            const owner = createHash("sha256").update(token).digest("hex");
            result = input.method === "mcp.start" ? mcp.start(owner, params)
              : input.method === "mcp.status" ? await mcp.status(owner, params)
              : mcp.cancel(owner, params);
            break;
          }
          case "providerAccounts.list":
            result = accounts.read().accounts;
            break;
          case "providers.loginStart":
          case "providers.loginStatus":
            if (!engine.store.adminToken(token)) throw new Error("Only this computer's desktop can manage provider sign-in");
            result = input.method === "providers.loginStart" ? await providerLogin.start(params) : providerLogin.status(params);
            break;
          case "providers.runtimeInspect":
          case "providers.runtimeInfo":
          case "providers.runtimePlan":
          case "providers.runtimeLatest":
          case "providers.runtimeClaimUpdateCheck":
          case "providers.runtimeStart":
          case "providers.runtimeStatus":
            if (!engine.store.adminToken(token)) throw new Error("Only this computer's desktop can manage provider installations");
            if (input.method === "providers.runtimeInspect") result = await providerManagement.inspect(params);
            else if (input.method === "providers.runtimeInfo") result = await providerManagement.info(params);
            else if (input.method === "providers.runtimePlan") result = await providerManagement.plan(params);
            else if (input.method === "providers.runtimeLatest") result = await providerManagement.latest(params);
            else if (input.method === "providers.runtimeClaimUpdateCheck") result = providerManagement.claim();
            else if (input.method === "providers.runtimeStart") result = providerManagement.start(params);
            else result = providerManagement.status(params);
            break;
          case "providerAccounts.read":
            result = accounts.read();
            break;
          case "providerAccounts.save":
          case "providerAccounts.remove":
          case "providerAccounts.setDefault":
          case "providerAccounts.importCodex":
          case "providerAccounts.loginStart":
          case "providerAccounts.loginStatus":
            if (!engine.store.adminToken(token)) throw new Error("Only this computer's desktop can manage provider accounts");
            if (input.method === "providerAccounts.save") result = accounts.save(params);
            else if (input.method === "providerAccounts.remove") result = await accounts.remove(params);
            else if (input.method === "providerAccounts.setDefault") result = accounts.setDefault(params);
            else if (input.method === "providerAccounts.importCodex") result = accounts.importCodex(params);
            else if (input.method === "providerAccounts.loginStart") result = await accounts.loginStart(params);
            else result = accounts.loginStatus(params);
            break;
          case "providerAccounts.usage":
            result = await providerUsage.read(params);
            break;
          case "providerAccounts.opencodeUsage":
            result = await fetchHostOpenCodeUsage();
            break;
          case "providerAccounts.piUsage":
            result = await fetchHostPiUsage(params.provider);
            break;
          case "providerAccounts.consumeReset":
            if (!engine.store.adminToken(token)) throw new Error("Only this computer's desktop can reset provider usage");
            if (!providerUsage.consumeReset) throw new Error("This Host does not support Codex usage resets.");
            result = await providerUsage.consumeReset(params);
            break;
          case "providerAccounts.deepseek": {
            const client = params.client as DeepseekAccountClient | undefined;
            if (!client || typeof client.version !== "string" || client.version.length > 80 ||
                typeof client.locale !== "string" || client.locale.length > 40 ||
                !Number.isInteger(client.timezoneOffsetSeconds) || Math.abs(client.timezoneOffsetSeconds) > 86_400)
              throw new Error("Invalid DeepSeek account client");
            // Host utilities cannot use the desktop Tauri home-directory API.
            result = await discoverDeepseekAccount(client, homedir());
            break;
          }
          case "titleModel.status":
            result = engine.titleModel.status();
            break;
          case "titleModel.save":
            result = engine.titleModel.save(params);
            break;
          case "titleModel.test":
            result = await engine.titleModel.generate("Explain how session titles work");
            break;
          case "titleModel.generate":
          case "titleModel.generateBranch":
            if (typeof params.message !== "string" || params.message.length > 100_000)
              throw new Error("Invalid title message");
            result = input.method === "titleModel.generateBranch"
              ? await engine.titleModel.generateBranch(params.message)
              : await engine.titleModel.generate(params.message);
            break;
          case "notes.list":
            result = engine.notes.list();
            break;
          case "automations.list":
            result = engine.automations.store.list();
            break;
          case "automations.upsert":
            result = engine.automations.store.upsert(params.automation);
            break;
          case "automations.delete":
            result = engine.automations.store.delete(String(params.id ?? ""));
            break;
          case "automations.runs":
            result = engine.automations.store.runs(String(params.automationId ?? ""));
            break;
          case "automations.run": {
            const run = engine.automations.store.manual(String(params.automationId ?? ""));
            await engine.automations.tick();
            result = engine.automations.store.runs(run.automationId).find(item => item.id === run.id);
            break;
          }
          case "automations.claimEvent":
            result = engine.automations.store.claimEvent(String(params.automationId ?? ""), params.claim as import("./automations").AutomationEventClaim);
            void engine.automations.tick().catch(() => undefined);
            break;
          case "reminders.list":
            result = { reminders: engine.reminders.list(), nextDueAt: engine.reminders.nextDueAt() };
            break;
          case "reminders.set":
            result = engine.reminders.set(params as import("../src/contracts/reminders").ReminderSet);
            break;
          case "reminders.clear":
            result = engine.reminders.clear(params as import("../src/contracts/reminders").ReminderClear);
            break;
          case "reminders.claimDue":
            result = engine.reminders.claimDue(params as import("../src/contracts/reminders").ReminderClaim);
            break;
          case "notes.get":
            result = engine.notes.get(params.id);
            break;
          case "notes.upsert":
            result = engine.notes.upsert(params.note);
            break;
          case "notes.delete":
            result = engine.notes.delete(params.id);
            break;
          case "notes.image":
            result = engine.notes.image(params.asset);
            break;
          case "notes.saveImage":
            result = engine.notes.saveImage(params.noteId, params.name, params.data);
            break;
          case "skills.list":
            result = await engine.listSkills(params.projectId, params.harness, params.sessionId, params.refresh === true);
            break;
          case "sessions.activity":
            result = {
              environmentId: engine.store.environmentId,
              assistant: engine.assistant.store.notificationActivity(),
              sessions: engine.store.summaries().filter((session) => !session.inboxAsk && !session.orchestrationLeadId && !session.workflowParentId && !session.assistantOwnerId),
            };
            break;
          case "sessions.list": {
            const projectId = String(params.projectId ?? "");
            const project = engine.store.project(projectId);
            const summaries = engine.store.summaries(projectId).filter((session) => !session.inboxAsk && !session.orchestrationLeadId && !session.workflowParentId && !session.assistantOwnerId);
            const paths = [...new Set(summaries.map((session) => session.executionCwd || session.cwd || project.cwd))];
            const branches = new Map(await Promise.all((engine.machines?.workspaceReady(project.machine) === false ? [] : paths).map(async (cwd) => {
              const branch = await exec("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
                cwd, timeout: 2_000,
                windowsHide: true,
              }).then(({ stdout }) => stdout.trim()).catch(() => "");
              return [cwd, branch] as const;
            })));
            const linkedWorktrees = new Map(await Promise.all((engine.machines?.workspaceReady(project.machine) === false ? [] : paths).map(async (cwd) =>
              [cwd, await linkedWorktree(projectId, cwd)] as const,
            )));
            result = summaries.map((session) => ({
              ...session,
              repo: project.name,
              branch: branches.get(session.executionCwd || session.cwd || project.cwd) || session.branch || undefined,
              executionCwd: session.executionCwd || session.cwd || project.cwd,
              linkedWorktree: linkedWorktrees.get(session.executionCwd || session.cwd || project.cwd) ?? false,
            }));
            break;
          }
          case "sessions.update": {
            const sessionId = String(params.sessionId ?? "");
            const current = engine.store.session(sessionId);
            if (current.projectId !== params.projectId)
              throw new Error("Session does not belong to this project");
            const patch: { title?: string; archived?: boolean; pinned?: boolean; linkedWorkItem?: LinkedWorkItem | null } = {};
            if (params.title !== undefined) {
              if (typeof params.title !== "string") throw new Error("Invalid session title");
              patch.title = params.title;
            }
            if (params.archived !== undefined) {
              if (typeof params.archived !== "boolean") throw new Error("Invalid archive value");
              patch.archived = params.archived;
            }
            if (params.pinned !== undefined) {
              if (typeof params.pinned !== "boolean") throw new Error("Invalid pin value");
              patch.pinned = params.pinned;
            }
            if (params.linkedWorkItem !== undefined) {
              const item = params.linkedWorkItem;
              const parsed = item && typeof item === "object" && !Array.isArray(item)
                ? parseGithubWorkItemUrl(String((item as LinkedWorkItem).url ?? ""))
                : null;
              if (item !== null && (
                typeof item !== "object" || Array.isArray(item) ||
                !parsed ||
                parsed.kind !== (item as LinkedWorkItem).kind ||
                parsed.repo !== (item as LinkedWorkItem).repo ||
                parsed.number !== (item as LinkedWorkItem).number ||
                parsed.url !== (item as LinkedWorkItem).url
              )) throw new Error("Invalid linked work item");
              patch.linkedWorkItem = item as LinkedWorkItem | null;
            }
            if (Object.keys(patch).length === 0) throw new Error("No session changes supplied");
            result = engine.updateSession(sessionId, patch);
            break;
          }
          case "sessions.stopBackgroundTask": {
            const sessionId = String(params.sessionId ?? "");
            const current = engine.store.session(sessionId);
            if (current.projectId !== params.projectId)
              throw new Error("Session does not belong to this project");
            await engine.stopBackgroundTask(sessionId, String(params.taskId ?? ""));
            result = { stopped: true };
            break;
          }
          case "sessions.switchAccount": {
            const sessionId = String(params.sessionId ?? "");
            const current = engine.store.session(sessionId);
            if (current.projectId !== params.projectId)
              throw new Error("Session does not belong to this project");
            const saved = await engine.switchProviderAccount(sessionId, String(params.providerAccountId ?? ""));
            result = { providerAccountId: saved.session.providerAccountId ?? "default", revision: saved.revision };
            break;
          }
          case "sessions.checkpoint": {
            const sessionId = String(params.sessionId ?? "");
            const current = engine.store.session(sessionId);
            if (current.projectId !== params.projectId)
              throw new Error("Session does not belong to this project");
            result = await engine.sessionCheckpoint(sessionId, params.action, params.path ?? undefined, params.turnId);
            break;
          }
          case "sessions.relocate": {
            const request = parseRelocate(params);
            result = await engine.relocateSession(request.sessionId, params.projectId, request.path);
            break;
          }
          case "app.commands.poll": {
            const abort = new AbortController();
            response.once("close", () => abort.abort());
            result = await engine.app.desktop.poll(createHash("sha256").update(token).digest("hex"), params,
              () => !abort.signal.aborted && engine.store.authenticated(token));
            break;
          }
          case "app.commands.complete":
            result = engine.app.desktop.complete(createHash("sha256").update(token).digest("hex"), params);
            break;
          case "sessions.nativeAccess": {
            result = await engine.nativeAccess(String(params.sessionId ?? ""));
            break;
          }
          case "sessions.refreshNative": {
            const sessionId = String(params.sessionId ?? "");
            const current = engine.store.session(sessionId);
            if (!current.session.nativeSession) throw new Error("This conversation has no native source");
            engine.touchSession(sessionId);
            result = (await engine.nativeSessions.refresh(sessionId, { force: true })) ?? null;
            break;
          }
          case "nativeSources.list": {
            if (params.autoSync !== undefined) {
              if (typeof params.autoSync !== "boolean") throw new Error("Invalid native auto-sync setting");
              engine.nativeSessions.setAutoSync(params.autoSync);
            }
            result = await engine.nativeSessions.list(params.refresh === true);
            break;
          }
          case "nativeSources.syncAll": {
            result = { synced: await engine.nativeSessions.syncAll() };
            break;
          }
          case "nativeSources.import": {
            const value = await engine.nativeSessions.importSource(String(params.sourceId ?? ""));
            engine.nativeSessions.touch(value.session.id);
            const { blockRevisions: _revisions, ...snapshot } = value;
            result = snapshot;
            break;
          }
          case "sessions.delete": {
            const sessionId = String(params.sessionId ?? "");
            const current = engine.store.session(sessionId);
            if (current.projectId !== params.projectId)
              throw new Error("Session does not belong to this project");
            await engine.deleteSession(sessionId);
            result = { deleted: true };
            break;
          }
          case "sessions.sync": {
            const sessionId = String(params.sessionId ?? "");
            engine.nativeSessions.touch(sessionId);
            const revision = Number.isSafeInteger(params.revision) ? Number(params.revision) : undefined;
            let serverWaitMs = 0;
            if (revision !== undefined && typeof params.waitMs === "number" && Number.isFinite(params.waitMs) && params.waitMs > 0) {
              const abort = new AbortController();
              const disconnect = () => abort.abort();
              response.once("close", disconnect);
              const startedWaiting = performance.now();
              try {
                if (response.destroyed) abort.abort();
                await engine.store.waitForRevision(sessionId, revision, params.waitMs, abort.signal);
              } finally {
                response.off("close", disconnect);
                serverWaitMs = performance.now() - startedWaiting;
              }
              if (response.destroyed) return;
              if (!engine.store.authenticated(token)) throw new Error("Device credential is invalid or revoked");
              if (engine.store.isAssistantSession(sessionId)) throw new Error("Assistant brain is private");
            }
            const sync = engine.store.sync(sessionId, revision);
            if (sync.kind !== "unchanged") {
              sync.value = { ...sync.value, session: { ...sync.value.session,
                linkedWorktree: await linkedWorktree(sync.value.projectId, sync.value.session.executionCwd || sync.value.session.cwd),
              } };
            }
            result = {
              ...transfers.respond(
                sessionId,
                sync,
              ),
              serverTime: Date.now(),
              ...(serverWaitMs ? { serverWaitMs } : {}),
            };
            break;
          }
          case "sessions.syncChunk":
            result = transfers.chunk(
              String(params.sessionId ?? ""),
              String(params.transfer ?? ""),
              Number(params.offset),
            );
            break;
          case "sessions.get": {
            const sessionId = String(params.sessionId ?? "");
            engine.touchSession(sessionId);
            if (Number.isSafeInteger(params.revision) && engine.store.sessionSummary(sessionId)?.revision === params.revision) {
              result = null;
              break;
            }
            const value = engine.store.session(sessionId);
            result = value.revision === params.revision ? null : {
              ...value,
              session: { ...value.session, linkedWorktree: await linkedWorktree(value.projectId, value.session.executionCwd || value.session.cwd) },
            };
            break;
          }
          case "events.read": {
            if (!Number.isSafeInteger(params.after) || Number(params.after) < 0)
              throw new Error("Invalid event cursor");
            result = engine.store.events(
              String(params.sessionId ?? ""),
              Number(params.after),
            );
            break;
          }
          case "commands.dispatch":
            result = await engine.commandAsync(params, {
              remoteControl: !engine.store.adminToken(token),
              remoteControlDevice: engine.store.remoteControlDevice(token),
            });
            break;
          case "commands.outcome":
            result = engine.commandOutcome(String(params.sessionId ?? ""), String(params.commandId ?? ""),
              typeof params.projectId === "string" ? params.projectId : undefined);
            break;
          case "workflows.request":
            result = await engine.workflows.rpc(params, (projectId) => engine.store.project(projectId).cwd, (path) => {
              const io = currentMachineIO();
              const target = io.path.resolve(path);
              const projects = engine.store.projects().filter(project => projectMachineKey(project.machine) === io.key);
              const ids = new Set(projects.map(project => project.id));
              return projects.some(project => target === io.path.resolve(project.cwd) || target.startsWith(`${io.path.resolve(project.cwd)}${io.path.sep}`))
                || engine.store.sessions().some(value => ids.has(value.projectId) && value.session.executionCwd && io.path.resolve(value.session.executionCwd) === target);
            });
            break;
          case "assistant.get":
          case "assistant.configure":
          case "assistant.messages":
          case "assistant.timeline":
          case "assistant.send":
          case "assistant.control":
          case "assistant.respond":
          case "assistant.memory":
          case "assistant.memoryTopic":
          case "bots.list":
          case "bots.get":
          case "bots.create":
          case "bots.configure":
          case "bots.control":
          case "bots.archive":
          case "bots.restore":
          case "botThreads.list":
          case "botThreads.get":
          case "botThreads.create":
          case "botThreads.configure":
          case "botThreads.messages":
          case "botThreads.runs":
          case "botThreads.send":
          case "botThreads.respond":
          case "botThreads.control":
          case "botThreads.cancel":
          case "botThreads.archive":
          case "botThreads.restore":
          case "botMemory.get":
          case "botMemory.topic":
          case "botMemory.list":
          case "botMemory.read":
          case "botMemory.save":
          case "botMemory.log":
          case "botMemory.undo":
          case "botMemory.rebuild":
          case "botTeams.list":
          case "botTeams.get":
          case "botTeams.create":
          case "botTeams.configure":
          case "botTeams.archive":
          case "botTeams.restore":
          case "botRooms.list":
          case "botRooms.get":
          case "botRooms.create":
          case "botRooms.configure":
          case "botRooms.archive":
          case "botRooms.restore":
          case "botRooms.messages":
          case "botRooms.send":
          case "botRooms.cancel":
          case "botDelegations.list":
          case "botDelegations.get":
          case "botDelegations.cancel":
            result = await engine.bots.rpc(input.method, params);
            break;
          case "im.get":
          case "im.configure":
          case "im.control":
          case "im.bind":
            result = await engine.im.rpc(input.method, params);
            break;
          case "attachments.upload":
            result = writeAttachmentChunk(engine.store, params);
            break;
          case "attachments.read":
            result = readAttachmentChunk(engine.store, params);
            break;
          case "media.inbox":
            result = await media.inbox(params.url, createHash("sha256").update(token).digest("hex"));
            break;
          case "media.chunk":
            result = media.chunk(createHash("sha256").update(token).digest("hex"), params);
            break;
          case "links.preview":
            result = await media.preview(params.url);
            break;
          case "devices.revokeSelf":
            // Only the caller's own credential. Sessions and other devices
            // are unaffected; the host keeps running.
            result = { revoked: engine.store.revokeToken(token) };
            engine.store.db.prepare("DELETE FROM checkout_resources WHERE id LIKE ? AND owner_pid=?")
              .run(`device:${createHash("sha256").update(token).digest("hex") }:%`, process.pid);
            break;
          case "devices.pairingHosts":
            if (!engine.store.adminToken(token))
              throw new Error("Only this computer's desktop can manage devices");
            result = {
              hosts: await pairingHostCandidates({
                port: request.socket.localPort ?? 3774,
                token,
                protocolVersion: HOST_PROTOCOL_VERSION,
                environmentId: engine.store.environmentId,
              }),
            };
            break;
          case "devices.list":
          case "devices.issue":
          case "devices.revoke": {
            if (!engine.store.adminToken(token))
              throw new Error("Only this computer's desktop can manage devices");
            if (input.method === "devices.issue") {
              const name = String(params.name ?? "").trim().slice(0, 80);
              if (!name) throw new Error("Device name is required");
              result = engine.store.issuePairingDevice(name);
            } else if (input.method === "devices.revoke") {
              const id = String(params.deviceId ?? "");
              const device = engine.store.devices().find(value => value.id === id);
              if (!device) throw new Error("Device not found");
              if (device.admin) throw new Error("This computer's desktop credential cannot be revoked here");
              const credentials = engine.store.deviceCredentials(id);
              result = { revoked: engine.store.revokeDevice(id) };
              for (const { hash } of credentials)
                engine.store.db.prepare("DELETE FROM checkout_resources WHERE id LIKE ? AND owner_pid=?")
                  .run(`device:${String(hash)}:%`, process.pid);
            } else {
              result = { devices: engine.store.deviceGroups() };
            }
            break;
          }
          case "resources.claim": {
            const id = resourceId(token, params.resourceId);
            const path = await workspace.resourcePath(params.path);
            if (!engine.store.authenticated(token)) throw new Error("Device credential is invalid or revoked");
            claimCheckoutResource(engine.store, id, path);
            result = { claimed: true };
            break;
          }
          case "resources.release":
            engine.store.db.prepare("DELETE FROM checkout_resources WHERE id=? AND owner_pid=?").run(resourceId(token, params.resourceId), process.pid);
            result = { released: true };
            break;
          case "git.diff": {
            const project = engine.store.project(
              String(params.projectId ?? ""),
            );
            const diff = await exec(
              "git",
              [
                "-c",
                "core.pager=cat",
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "HEAD",
                "--",
              ],
              {
                cwd: await resolveHostWorktreeAsync(project.cwd, params.cwd),
                windowsHide: true,
                timeout: 10_000,
                maxBuffer: 2 * 1024 * 1024,
              },
            );
            result = diff.stdout;
            break;
          }
          case "git.branches": {
            const project = engine.store.project(
              String(params.projectId ?? ""),
            );
            result = await hostBranches(
              await resolveHostWorktreeAsync(project.cwd, params.cwd),
            );
            break;
          }
          case "git.switch": {
            const project = engine.store.project(
              String(params.projectId ?? ""),
            );
            const cwd = await resolveHostWorktreeAsync(project.cwd, params.cwd);
            result = await mutateWorkspace(project.id, cwd, () =>
              switchHostBranch(cwd, params.branch, params.remote),
            );
            break;
          }
          case "git.createBranch": {
            const project = engine.store.project(
              String(params.projectId ?? ""),
            );
            const cwd = await resolveHostWorktreeAsync(project.cwd, params.cwd);
            result = await mutateWorkspace(project.id, cwd, () =>
              createHostBranch(cwd, params.branch),
            );
            break;
          }
          case "git.worktrees": {
            const project = engine.store.project(
              String(params.projectId ?? ""),
            );
            result = await detailedHostWorktrees(engine.store, project.cwd);
            break;
          }
          case "git.worktreeCheckRemove":
            result = await worktreeLifecycle.check(String(params.projectId ?? ""), params.path, params.force === true) ?? null;
            break;
          case "git.worktreeRemove": {
            const projectId = String(params.projectId ?? "");
            const project = engine.store.project(projectId);
            engine.assertProjectWrite(projectId);
            engine.assertWorkspaceWrite(String(params.path ?? ""));
            const ids = [...new Set([projectId, ...worktreeLifecycle.projectsUsing(String(params.path ?? ""))])].sort();
            const remove = async () => {
              for (const id of ids) await engine.releaseProjectBindings(id);
              const removed = await worktreeLifecycle.remove(project.id, params.path, params.force === true, params.keepSessions === true);
              workspace.invalidateRoots();
              return removed;
            };
            const idle = (index: number): ReturnType<typeof remove> => index === ids.length ? remove()
              : engine.withIdleProject(ids[index], () => idle(index + 1));
            result = await idle(0);
            break;
          }
          case "git.worktreeName":
            result = await engine.generateWorktreeName(params.projectId, params.cwd, params.harness, params.message);
            break;
          case "git.worktreeCreate": {
            const project = engine.store.project(
              String(params.projectId ?? ""),
            );
            const cwd = await resolveHostWorktreeAsync(project.cwd, params.cwd);
            engine.assertProjectWrite(project.id);
            engine.assertWorkspaceWrite(cwd);
            // Creating a separate checkout only reads the source commit. Keep
            // its directories alive without requiring running sessions to stop.
            const releases: Array<() => void> = [];
            const progress = worktreeProgress.begin(createHash("sha256").update(token).digest("hex"), params.progressId);
            try {
              for (const path of new Set([project.cwd, cwd]))
                releases.push(claimCheckoutResource(engine.store, `worktree-create:${randomUUID()}`, path));
              const created = await createHostWorktree(
                project.cwd,
                params.branch,
                params.base,
                params.existing,
                cwd,
                progress?.line,
              );
              result = { ...(await detailedHostWorktrees(engine.store, project.cwd)).worktrees.find(tree => tree.path === created.path), ...created };
            } finally {
              progress?.finish();
              for (const release of releases) release();
            }
            workspace.invalidateRoots();
            break;
          }
          case "git.worktreeProgress":
            result = worktreeProgress.read(createHash("sha256").update(token).digest("hex"), params.progressId, params.offset);
            break;
          case "files.read": {
            const project = engine.store.project(
              String(params.projectId ?? ""),
            );
            result = await readHostFile(
              await resolveHostWorktreeAsync(project.cwd, params.cwd),
              params.path,
            );
            break;
          }
          case "files.list": {
            const project = engine.store.project(
              String(params.projectId ?? ""),
            );
            result = await listHostFiles(
              await resolveHostWorktreeAsync(project.cwd, params.cwd),
              params.path,
            );
            break;
          }
          case "files.index": {
            const project = engine.store.project(
              String(params.projectId ?? ""),
            );
            result = await indexHostFiles(
              await resolveHostWorktreeAsync(project.cwd, params.cwd),
            );
            break;
          }
          case "workspace.run":
            if (params.command === "rename_path" && params.args && typeof params.args === "object") {
              const args = params.args as { path?: unknown; name?: unknown };
              const io = currentMachineIO();
              const project = typeof args.path === "string" ? engine.store.projects().find(value =>
                projectMachineKey(value.machine) === io.key && io.path.resolve(value.cwd) === io.path.resolve(String(args.path))) : undefined;
              if (project) {
                if (typeof args.name !== "string" || !args.name || args.name === "." || args.name === ".." || /[/\\\0]/.test(args.name))
                  throw new Error("Invalid project name");
                const moved = await moveProject(project.id, io.path.join(io.path.dirname(project.cwd), args.name), true);
                result = moved.cwd;
                break;
              }
            }
            result = (await workspace.run(params.command, params.args)) ?? null;
            break;
          case "files.search": {
            const project = engine.store.project(
              String(params.projectId ?? ""),
            );
            result = await searchHostFiles(
              await resolveHostWorktreeAsync(project.cwd, params.cwd),
              params.query,
            );
            break;
          }
          case "files.searchContent": {
            const project = engine.store.project(
              String(params.projectId ?? ""),
            );
            result = await searchHostContent(
              await resolveHostWorktreeAsync(project.cwd, params.cwd),
              params,
            );
            break;
          }
          case "files.create": {
            const project = engine.store.project(
              String(params.projectId ?? ""),
            );
            const cwd = await resolveHostWorktreeAsync(project.cwd, params.cwd);
            result = await mutateFiles(project.id, cwd, () => createHostPath(
              cwd,
              params.parent,
              params.name,
              params.isDir,
            ));
            break;
          }
          case "files.write": {
            const project = engine.store.project(
              String(params.projectId ?? ""),
            );
            const cwd = await resolveHostWorktreeAsync(project.cwd, params.cwd);
            result =
              (await mutateFiles(project.id, cwd, () => writeHostFile(
                cwd,
                params.path,
                params.expected,
                params.content,
              ))) ?? null;
            break;
          }
          case "git.index": {
            const project = engine.store.project(
              String(params.projectId ?? ""),
            );
            result = await hostGitIndex(
              await resolveHostWorktreeAsync(project.cwd, params.cwd),
            );
            break;
          }
          case "git.fileDiff": {
            const project = engine.store.project(
              String(params.projectId ?? ""),
            );
            result = await hostFileDiff(
              await resolveHostWorktreeAsync(project.cwd, params.cwd),
              params.path,
              params.staged === true,
            );
            break;
          }
          case "git.action": {
            const project = engine.store.project(
              String(params.projectId ?? ""),
            );
            const cwd = await resolveHostWorktreeAsync(project.cwd, params.cwd);
            result =
              (await mutateWorkspace(project.id, cwd, () =>
                hostGitAction(
                  cwd,
                  params.action,
                  params.path,
                  params.message,
                  params.content,
                ),
              )) ?? null;
            break;
          }
          default:
            throw new Error("Unsupported host method");
        }
        return result;
        };
        const result = engine.machines ? await engine.machines.forRequest(String(input.method), params, execute) : await execute();
        response.end(JSON.stringify({ result }));
      } catch (error) {
        const unavailable = isHostUnavailable(error);
        if (!response.destroyed)
          response.writeHead(error instanceof PairingCodeError ? error.code === "PAIRING_CODE_USED" ? 409 : 401 : unavailable ? 503 : 400,
            unavailable ? { "Retry-After": "1" } : undefined).end(
            JSON.stringify({
              error:
                error instanceof Error ? error.message : "Host request failed",
              ...(assistantRequest ? { code: botErrorCode(error) } : {}),
              ...(error instanceof PairingCodeError ? { code: error.code } : {}),
              ...(unavailable ? { code: HOST_UNAVAILABLE_CODE } : {}),
            }),
          );
      }
    },
  );
  server.on("close", () => accounts.close());
  server.on("close", () => providerLogin.close());
  server.on("close", () => auxiliaryProviders.close());
  server.on("close", () => mcp.close());
  return server;
}
