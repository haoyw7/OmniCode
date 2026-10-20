import { insertQueuedMessage, moveQueuedMessage } from "../../sessions/model/messageQueue";
import { selectComposerConfiguration } from "../../sessions/model/composerConfiguration";
import { rememberSharedProviderDefaults, saveProviderAccount, selectProviderAccount } from "../../providers/model/providerAccounts";
// @vitest-environment happy-dom
import { act, createElement, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  SessionPane,
  type SessionPaneProps,
} from "../../sessions/ui/SessionPane";
import type { Block, Session } from "../../sessions/model/session";
import type { QuestionAnswer } from "../../sessions/model/userQuestion";
import type { AgentModel } from "../../sessions/model/models";
import { resetHarnessModelOverlays, setHarnessModels } from "../../sessions/model/models";
import { rememberRemoteProject, configureSharedHost } from "../model/remoteProjects";
import { clearRemoteSessionSubmission, pendingRemoteSessionSubmission, stageRemoteSessionSubmission } from "../model/remoteSessionActions";
import { useSessionSubmission } from "../../../app/controller/useSessionSubmission";
import type { Submit } from "../../../app/controller/workspaceTypes";
import { createEditedResendCoordinator } from "../../sessions/model/editLastTurn";
import { preloadRemoteSession, RemoteSession } from "./RemoteSession";
import { rememberRemoteSession, remoteSessionFor } from "../model/connections";
import "../model/remoteCommands";
import { OrchestrationPreview } from "../../orchestration/ui/OrchestrationPreview";
import { GeneratedImage } from "../../sessions/ui/GeneratedImage";
import { loadRemoteOutbox } from "../model/remoteOutbox";
import { sessionCheckpointStatus } from "../../sessions/model/checkpoint";
import type {
  HostCommand,
  HostDescriptor,
  HostModelCatalog,
  HostSession,
  RemoteMachine,
} from "../model/protocol";

import type { WorktreeCreation } from "../../source-control/model/worktreeCreation";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => undefined),
  listen: vi.fn(async () => () => undefined),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("../../sessions/ui/AgentTranscript", () => ({
  AgentTranscript: ({
    blocks,
    busy,
    executionState,
    animateFrom,
    onSendDraft,
    onRemoveDraft,
    onOpenFile,
    onOpenDiff,
    onQuestionFollowUp,
    worktreeCreation,
    turnAccessory,
  }: {
    blocks: Block[];
    busy: boolean;
    executionState?: Session["executionState"];
    animateFrom?: string;
    onSendDraft?: (block: Block) => void;
    onRemoveDraft?: (block: Block) => void;
    onOpenFile?: (path: string) => void;
    onOpenDiff?: (path: string) => void;
    onQuestionFollowUp?: (answer: QuestionAnswer) => unknown;
    worktreeCreation?: WorktreeCreation;
    turnAccessory?: (user: Block | undefined, latest: boolean) => ReactNode;
  }) =>
    createElement(
      "ol",
      { "aria-label": "Transcript", "data-busy": busy, "data-animate-from": animateFrom,
        "data-execution-phase": executionState?.phase, "data-execution-since": executionState?.since },
      turnAccessory?.(blocks.findLast((block) => block.role === "user"), true),
      createElement("button", { "aria-label": "Open transcript file", onClick: () => onOpenFile?.("src/app.ts") }),
      createElement("button", { "aria-label": "Open transcript diff", onClick: () => onOpenDiff?.("src/app.ts") }),
      worktreeCreation
        ? createElement(
            "li",
            {
              "aria-label": "Worktree creation",
              "data-anchor": worktreeCreation.afterBlockId,
              "data-status": worktreeCreation.status,
            },
            [worktreeCreation.status, ...worktreeCreation.log.flatMap((line) => (line.kind === "output" ? [line.text] : []))].join("\n"),
          )
        : null,
      blocks.map((block) =>
        createElement(
          "li",
          { key: block.id, "data-block-id": block.id },
          block.text,
          block.role === "image" && block.image ? createElement(GeneratedImage, {
            image: block.image,
            attachment: block.attachments?.find((file) => file.kind === "image"),
          }) : null,
          block.question && onQuestionFollowUp ? createElement("button", {
            "aria-label": "Answer historical question",
            onClick: () => onQuestionFollowUp({ blockId: block.id,
              reply: { kind: "answered", answers: { source: ["local"] } } }),
          }) : null,
          block.orchestration ? createElement(OrchestrationPreview, { block, busy }) : null,
          block.draft && onSendDraft
            ? createElement(
                "button",
                {
                  "aria-label": "Send remote draft",
                  onClick: () => onSendDraft(block),
                },
                "Send draft",
              )
            : null,
          block.draft && onRemoveDraft
            ? createElement(
                "button",
                {
                  "aria-label": "Remove remote draft",
                  onClick: () => onRemoveDraft(block),
                },
                "Remove draft",
              )
            : null,
        ),
      ),
    ),
}));

const machine: RemoteMachine = {
  id: "machine",
  name: "Home server",
  endpoint: "ssh://me@home",
  environmentId: "env",
};
const effort = (id: string, value: string) => ({
  id,
  label: "Reasoning",
  kind: "select" as const,
  value,
  options: ["low", "medium", "high"].map((option) => ({
    value: option,
    label: option[0].toUpperCase() + option.slice(1),
  })),
});
const gpt: AgentModel = {
  id: "codex:gpt-test",
  harness: "codex",
  name: "GPT Test",
  nativeId: "gpt-test",
  settings: [effort("reasoningEffort", "medium")],
};
const cursor: AgentModel = {
  id: "cursor:composer-test",
  harness: "cursor",
  name: "Composer Test",
  nativeId: "composer-test",
  settings: [],
};

let root: Root;
let container: HTMLDivElement;
let host: HostSession | undefined;
let catalog: HostModelCatalog | Error;
let providers: HostDescriptor["providers"];
let orchestrationCapability: boolean;
let handoffCapability: boolean;
let checkpointCapability: boolean;
let checkpointRequests: Record<string, unknown>[];
let commands: HostCommand[];
let projectKey: string;
let syncDelay: Promise<void> | undefined;
let finishPendingSyncs: () => void;
let syncCleanup: Promise<void>;
let syncWaitCapability: boolean;
let dispatchDelay: Promise<void> | undefined;
let branchFailure: string | undefined;
let branchActionFailure: string | undefined;
let currentBranch: string;
let createdBranch: string | undefined;
let createdWorktree: string | undefined;
let nameFailure: string | undefined;
let deletedSessions: string[];

beforeEach(async () => {
  nameFailure = undefined;
  configureSharedHost(undefined, []);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  localStorage.setItem("omnicode.modelControls", "beside");
  commands = [];
  host = undefined;
  syncDelay = undefined;
  syncCleanup = new Promise<void>((resolve) => { finishPendingSyncs = resolve; });
  syncWaitCapability = false;
  dispatchDelay = undefined;
  branchFailure = undefined;
  branchActionFailure = undefined;
  currentBranch = "main";
  createdBranch = undefined;
  createdWorktree = undefined;
  deletedSessions = [];
  catalog = { models: { codex: [gpt] }, errors: {} };
  providers = ["codex"];
  orchestrationCapability = false;
  handoffCapability = true;
  checkpointCapability = false;
  checkpointRequests = [];
  projectKey = rememberRemoteProject("env", {
    id: "project",
    name: "repo",
    cwd: "/home/me/repo",
  }).key;
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    if (command === "list_project_files" || command === "notes_list") return [];
    if (command === "remote_machines") return [machine];
    if (command === "remote_outbox_list") return [];
    if (command !== "remote_request") return undefined;
    const { method, params } = input as {
      method: string;
      params: HostCommand & { sessionId?: string };
    };
    const workspace = method === "workspace.run"
      ? params as unknown as { command: string; args: Record<string, unknown> }
      : undefined;
    const operation = workspace?.command ?? method;
    const commandParams = workspace?.args ?? params;
    if (operation === "git_diff_stats") return { files: 1, additions: 3, deletions: 1 };
    if (method === "environment.describe")
      return {
        protocolVersion: 1,
        environmentId: "env",
        name: "home",
        providers,
        capabilities: ["attachments.upload", "sessions.plan", "sessions.draft", ...(syncWaitCapability ? ["sessions.sync.wait.v1"] : []), ...(orchestrationCapability ? ["sessions.orchestration"] : []), ...(handoffCapability ? ["sessions.handoff"] : []), ...(checkpointCapability ? ["sessions.checkpoint"] : [])],
      };
    if (method === "models.list") {
      if (catalog instanceof Error) throw catalog.message;
      return catalog;
    }
    if (operation === "git.branches" || operation === "git_branches") {
      if (branchFailure) throw new Error(branchFailure);
      if (workspace) return {
        current: currentBranch,
        detached: false,
        branches: ["main", "dev", ...(createdBranch ? [createdBranch] : [])]
          .map((name) => ({ name, current: name === currentBranch, remote: null })),
      };
      return {
        current: currentBranch,
        branches: ["main", "dev", ...(createdBranch ? [createdBranch] : [])],
      };
    }
    if (operation === "git.worktrees" || operation === "git_worktrees")
      return {
        defaultRoot: "/home/me/repo-worktrees",
        worktrees: [
          {
            path: "/home/me/repo",
            branch: "main",
            head: "abc",
            isMain: true,
            missing: false,
          },
          {
            path: "/home/me/repo-worktrees/dev",
            branch: "dev",
            head: "def",
            isMain: false,
            missing: false,
          },
          ...(createdWorktree
            ? [
                {
                  path: createdWorktree,
                  branch: createdBranch,
                  head: "abc",
                  isMain: false,
                  missing: false,
                },
              ]
            : []),
        ],
      };
    if (method === "git.worktreeName") {
      if (nameFailure) throw new Error(nameFailure);
      return "mc/work-in-new-tree";
    }
    if (method === "git.worktreeCreate") {
      createdBranch = params.branch;
      createdWorktree = `/home/me/repo-worktrees/wt-${params.branch.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      return {
        path: createdWorktree,
        branch: createdBranch,
        head: "abc",
        isMain: false,
        missing: false,
        log: [
          `Preparing worktree (new branch '${createdBranch}')`,
          "HEAD is now at abc1234 initial",
        ],
      };
    }
    if (operation === "git.switch" || operation === "git.createBranch" ||
        operation === "git_checkout" || operation === "git_create_branch") {
      if (branchActionFailure) throw new Error(branchActionFailure);
      currentBranch = String(operation.startsWith("git_") ? commandParams.name : params.branch);
      if (operation === "git.createBranch" || operation === "git_create_branch") createdBranch = currentBranch;
      if (workspace) return currentBranch;
      return {
        current: params.branch,
        branches: ["main", "dev", ...(createdBranch ? [createdBranch] : [])],
      };
    }
    if (method === "sessions.update") {
      if (host && typeof params.title === "string") host = { ...host, session: { ...host.session, title: params.title } };
      return { id: params.sessionId, title: params.title };
    }
    if (method === "sessions.sync") {
      if (syncDelay) await Promise.race([syncDelay, syncCleanup]);
      return { kind: "snapshot", value: host };
    }
    if (method === "attachments.upload")
      return { offset: (params as { size: number }).size };
    if (method === "commands.dispatch") {
      if (dispatchDelay) await dispatchDelay;
      return dispatch(params);
    }
    if (method === "sessions.checkpoint") {
      checkpointRequests.push(params as unknown as Record<string, unknown>);
      return { files: [{ path: "/home/me/repo/src/app.ts", relative: "src/app.ts", status: "modified",
        additions: 1, deletions: 0, exact: true, undoable: true }] };
    }
    if (method === "sessions.delete") {
      deletedSessions.push(params.sessionId!);
      host = undefined;
      return { deleted: true };
    }
    throw new Error(`Unexpected method ${method}`);
  });
  await loadRemoteOutbox();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); finishPendingSyncs(); });
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  localStorage.clear();
  configureSharedHost(undefined, []);
  clearRemoteSessionSubmission("shell");
  resetHarnessModelOverlays();
});

/** A minimal host engine: persists commands the way the real one does. */
function dispatch(command: HostCommand) {
  commands.push(command);
  if (command.type === "create") {
    host = {
      projectId: command.projectId,
      revision: 1,
      status: "idle",
      updatedAt: 0,
      session: {
        id: "host-session",
        cwd: command.executionCwd ?? "/home/me/repo",
        harness: command.harness,
        model: command.model,
        modelSettings: command.modelSettings ?? {},
        runtimeMode: command.runtimeMode,
        title: "New remote session",
        blocks: [],
      },
    };
  } else if (host && command.type === "configure") {
    host = {
      ...host,
      revision: host.revision + 1,
      session: selectComposerConfiguration(host.session, {
        harness: command.harness ?? host.session.harness,
        model: command.model,
        modelSettings: command.modelSettings,
        runtimeMode: command.runtimeMode,
      }),
    };
  } else if (host && command.type === "queue") {
    const rows = host.session.queuedMessages ?? [];
    host = { ...host, revision: host.revision + 1, session: { ...host.session,
      editingQueuedMessageId: command.action === "hold" ? command.messageId : undefined,
      queuedMessages: command.action === "remove" ? rows.filter(row => row.id !== command.messageId)
        : command.action === "move" ? moveQueuedMessage(host.session, command.messageId!, command.beforeId).queuedMessages
        : command.action === "edit" ? rows.map(row => row.id === command.messageId ? { ...row, text: command.text! } : row) : rows } };
  } else if (host && command.type === "send" && host.status === "running" && host.supportsQueue) {
    host = { ...host, revision: host.revision + 1, session: { ...host.session,
      queuedMessages: insertQueuedMessage(host.session, { id: command.commandId, text: command.text, attachments: [] }, command.queueReturnPosition), queueStatus: "active" } };
  } else if (host && command.type === "send") {
    host = { ...host, session: { ...host.session, ...host.session.pendingConfiguration, pendingConfiguration: undefined } };
    host = {
      ...host,
      revision: host.revision + 1,
      status: "idle",
      session: {
        ...host.session,
        blocks: [
          ...host.session.blocks.filter(
            (block) => block.id !== command.draftBlockId,
          ),
          { id: command.commandId, role: "user", text: command.text },
          { id: `${command.commandId}-reply`, role: "assistant", text: "Done" },
        ],
      },
    };
  } else if (host && command.type === "draft") {
    host = {
      ...host,
      revision: host.revision + 1,
      session: {
        ...host.session,
        blocks: [
          ...host.session.blocks,
          {
            id: command.commandId,
            role: "user",
            text: command.text,
            draft: true,
          },
        ],
      },
    };
  } else if (host && command.type === "removeDraft") {
    host = {
      ...host,
      revision: host.revision + 1,
      session: {
        ...host.session,
        blocks: host.session.blocks.filter(
          (block) => block.id !== command.draftBlockId,
        ),
      },
    };
  } else if (host && command.type === "orchestration") {
    if ((command.action === "confirmProposal" || command.action === "editProposal") && command.expectedRevision !== host.revision)
      throw new Error("Host rejected request: Proposal changed on another device");
    if (["resume", "stop", "cancelTask"].includes(command.action) && command.orchestrationId !== host.orchestration?.id)
      throw new Error("Host rejected request: Orchestration run changed");
    host = { ...host, revision: host.revision + 1 };
    if (command.action === "confirmProposal") host = { ...host, session: { ...host.session,
      blocks: host.session.blocks.map(block => block.id === command.proposalBlockId && block.orchestration
        ? { ...block, orchestration: { ...block.orchestration, status: "approved", ...(command.edit ? { tasks: command.edit.tasks,
          settings: { ...block.orchestration.settings, maxWorkers: command.edit.maxWorkers } } : {}) } } : block),
    } };
    if (host.orchestration && (command.action === "resume" || command.action === "stop"))
      host = { ...host, orchestration: { ...host.orchestration, status: command.action === "resume" ? "active" : "stopped" } };
  }
  return {
    commandId: command.commandId,
    sessionId: "host-session",
    revision: host?.revision ?? 1,
  };
}

const shell = (): Session => ({
  id: "shell",
  cwd: projectKey,
  harness: "claude",
  model: "claude:sonnet-5",
  modelSettings: { reasoningEffort: "high" },
  runtimeMode: "supervised",
  title: "New session",
  blocks: [],
});

async function render(
  session = shell(),
  extra: Partial<SessionPaneProps> = {},
) {
  const props = {
    session,
    visible: true,
    focused: true,
    inSplit: false,
    composerFocused: false,
    recents: [],
    onFocus: vi.fn(),
    onClose: vi.fn(),
    ...extra,
  } as unknown as SessionPaneProps;
  await act(async () => root.render(createElement(SessionPane, props)));
  await settle();
}
async function settle() {
  for (let i = 0; i < 5; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

it.each([false, true])("routes DSH background task stops only through a capable Host (supported: %s)", async (supported) => {
  providers = ["deepseek"];
  host = { projectId: "project", revision: 1, status: "running", updatedAt: 0, runId: "run",
    session: { ...shell(), id: "host-session", cwd: "/home/me/repo", harness: "deepseek", model: "deepseek:default" } };
  rememberRemoteSession("shell", "host-session");
  const original = vi.mocked(invoke).getMockImplementation()!;
  const stop = vi.fn();
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    const rpc = input as { method?: string; params?: object } | undefined;
    if (command === "remote_request" && rpc?.method === "sessions.stopBackgroundTask") {
      stop(rpc.params);
      return { stopped: true };
    }
    const result = await original(command, input);
    if (command === "remote_request" && rpc?.method === "environment.describe" && supported) {
      const descriptor = result as HostDescriptor;
      return { ...descriptor, capabilities: [...descriptor.capabilities, "sessions.stopBackgroundTask"] };
    }
    return result;
  });
  let handler: SessionPaneProps["onStopBackgroundTask"];
  await act(async () => root.render(createElement(RemoteSession, {
    shell: { ...shell(), harness: "deepseek", model: "deepseek:default" }, visible: true,
    onSnapshot: vi.fn(), onOpenFile: vi.fn(), onOpenDiff: vi.fn(), onOpenPlan: vi.fn(),
    render: (overrides) => { handler = overrides.onStopBackgroundTask; return createElement("span", null, "DSH"); },
  })));
  await settle();
  if (supported) {
    expect(handler!).toBeDefined();
    await act(async () => handler!("shell", "bash-1"));
    expect(stop).toHaveBeenCalledWith({ projectId: "project", sessionId: "host-session", taskId: "bash-1" });
    expect(commands.some((command) => command.type === "cancel")).toBe(false);
  } else expect(handler!).toBeUndefined();
});

it("shares startup Host metadata across restored panes while syncing each conversation", async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  let describe!: () => void;
  let listModels!: () => void;
  const describing = new Promise<void>(resolve => { describe = resolve; });
  const listingModels = new Promise<void>(resolve => { listModels = resolve; });
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    const request = input as { method?: string; params?: { sessionId?: string } } | undefined;
    if (request?.method === "environment.describe") await describing;
    if (request?.method === "models.list") await listingModels;
    if (request?.method === "sessions.sync") return { kind: "snapshot", value: {
      projectId: "project", revision: 1, status: "idle", updatedAt: 0,
      session: { ...shell(), id: request.params?.sessionId, cwd: "/home/me/repo" },
    } };
    return original(command, input);
  });
  const onSnapshot = vi.fn();
  const restored = Array.from({ length: 39 }, (_, index) => ({ ...shell(), id: `restored-${index}` }));
  for (const session of restored) rememberRemoteSession(session.id, `host-${session.id}`);
  await act(async () => root.render(restored.map(session => createElement(RemoteSession, {
    key: session.id, shell: session, visible: session.id === restored[0].id,
    onSnapshot, onOpenFile: vi.fn(), onOpenDiff: vi.fn(), onOpenPlan: vi.fn(),
    render: overrides => createElement("span", { "data-pane": session.id }, overrides.allowedModelHarnesses.join(",")),
  }))));
  const calls = (method: string) => vi.mocked(invoke).mock.calls.filter(([command, input]) =>
    command === "remote_request" && (input as { method?: string })?.method === method,
  );
  expect(calls("environment.describe")).toHaveLength(1);
  await act(async () => describe());
  await settle();
  expect(calls("models.list")).toHaveLength(1);
  expect(calls("sessions.sync")).toHaveLength(39);
  expect(onSnapshot).toHaveBeenCalledTimes(39);
  await act(async () => listModels());
  await settle();
  expect(container.querySelectorAll("[data-pane]")).toHaveLength(39);
  expect(calls("environment.describe")).toHaveLength(1);
  expect(calls("models.list")).toHaveLength(1);
});

it("ignores a disposed pane when its shared Host descriptor finishes", async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  let describe!: () => void;
  const describing = new Promise<void>(resolve => { describe = resolve; });
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    const request = input as { method?: string; params?: { sessionId?: string } } | undefined;
    if (request?.method === "environment.describe") await describing;
    if (request?.method === "sessions.sync") return { kind: "snapshot", value: {
      projectId: "project", revision: 1, status: "idle", updatedAt: 0,
      session: { ...shell(), id: request.params?.sessionId, cwd: "/home/me/repo" },
    } };
    return original(command, input);
  });
  const onSnapshot = vi.fn();
  const restored = ["closed", "remaining"].map(id => ({ ...shell(), id }));
  for (const session of restored) rememberRemoteSession(session.id, `host-${session.id}`);
  const panes = (sessions: Session[]) => sessions.map(session => createElement(RemoteSession, {
    key: session.id, shell: session, visible: true, onSnapshot,
    onOpenFile: vi.fn(), onOpenDiff: vi.fn(), onOpenPlan: vi.fn(),
    render: () => createElement("span", null, session.id),
  }));
  await act(async () => root.render(panes(restored)));
  await act(async () => root.render(panes(restored.slice(1))));
  await act(async () => describe());
  await settle();
  expect(vi.mocked(invoke).mock.calls.filter(([command, input]) =>
    command === "remote_request" && (input as { method?: string })?.method === "environment.describe",
  )).toHaveLength(1);
  expect(onSnapshot).toHaveBeenCalledTimes(1);
  expect(onSnapshot).toHaveBeenCalledWith("remaining", expect.objectContaining({ session: expect.objectContaining({ id: "host-remaining" }) }));
  expect(vi.mocked(invoke).mock.calls.some(([command, input]) =>
    command === "remote_request" && (input as { method?: string; params?: { sessionId?: string } })?.method === "sessions.sync" &&
    (input as { params?: { sessionId?: string } }).params?.sessionId === "host-closed",
  )).toBe(false);
});

const byLabel = (prefix: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label^="${prefix}"]`);
async function type(text: string) {
  const textarea = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function send(text: string) {
  await type(text);
  await act(async () => byLabel("Send")!.click());
  await settle();
}

it("delivers a projectless chat's first message after its Host pane mounts", async () => {
  const cwd = "/home/me/Documents/omnicode/2026-10-19/chat-120000-abcdef";
  configureSharedHost("env", [], machine.id);
  setHarnessModels("codex", [gpt]);
  let openProject!: () => void;
  let listModels!: () => void;
  const opening = new Promise<void>(resolve => { openProject = resolve; });
  const listing = new Promise<void>(resolve => { listModels = resolve; });
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    if (command === "create_path") return cwd;
    if (command === "remote_request" && (input as { method: string }).method === "projects.open") {
      await opening;
      return { id: "new-chat-project", name: "chat", cwd };
    }
    if (command === "remote_request" && (input as { method: string }).method === "models.list") await listing;
    return original(command, input);
  });
  function Harness() {
    const [sessions, setSessions] = useState([{ ...shell(), cwd: "~", harness: "codex" as const, model: gpt.id }]);
    const [, setProjectCwd] = useState("~");
    const sessionsRef = useRef(sessions);
    sessionsRef.current = sessions;
    const { onSubmit } = useSessionSubmission({
      sessionData: { isRemoving: () => false },
      sessionsRef,
      editedResends: useRef(createEditedResendCoordinator()).current,
      flushHarnessEvents: () => {},
      enqueueHarnessEvent: vi.fn(),
      navigation: { isSwitching: () => false, pinSessionToCurrentWorkspace: () => {} },
      removingWorktreePaths: useRef(new Set<string>()),
      setSessions,
      setProjectCwd,
      submitAfterProjectSyncRef: useRef<Submit>(() => false),
      dismissNoticesForContinuedSession: () => {},
      projectLocationSyncs: useRef(new Map()),
      applyProjectLocationChange: async () => {},
      turnGen: useRef(new Map()),
      titleCoordinator: useRef(null),
      activeSessionIdRef: useRef("shell"),
    });
    return createElement(SessionPane, {
      session: sessions[0], visible: true, focused: true, inSplit: false,
      composerFocused: false, recents: [], onFocus: () => {}, onClose: () => {},
      onSubmit,
    } as unknown as SessionPaneProps);
  }
  await act(async () => root.render(createElement(Harness)));
  const initialPane = container.querySelector("[data-session-drop]");
  const initialComposer = container.querySelector("textarea");
  const modelLabel = container.querySelector("[data-model-picker-trigger]")?.getAttribute("aria-label");
  expect(modelLabel).toBe("Codex GPT Test");
  expect(byLabel("Reasoning: High")).not.toBeNull();
  await send("Keep my first message");
  expect(commands).toEqual([]);
  expect(container.querySelector("[data-session-drop]")).toBe(initialPane);
  expect(container.querySelector("textarea")).toBe(initialComposer);
  expect(container.textContent).not.toContain("The machine for this project isn’t connected");
  await send("Keep this next message as a draft");
  expect(container.querySelector("textarea")?.value).toBe("Keep this next message as a draft");
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "create_path")).toHaveLength(1);
  await act(async () => openProject());
  await settle();
  expect(commands).toEqual([]);
  expect(container.querySelector("[data-model-picker-trigger]")?.getAttribute("aria-label")).toBe(modelLabel);
  expect(byLabel("Reasoning: High")).not.toBeNull();
  expect(container.querySelector('[aria-label="Transcript"]')?.getAttribute("data-execution-phase")).toBe("starting");
  await act(async () => container.querySelector<HTMLButtonElement>("[data-model-picker-trigger]")!.click());
  expect(document.body.querySelector('[role="option"][aria-label="GPT Test, Codex"]')).not.toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>("[data-model-picker-trigger]")!.click());
  await act(async () => listModels());
  await settle();
  expect(commands.filter(command => command.type === "create")).toHaveLength(1);
  expect(commands.filter(command => command.type === "send")).toEqual([
    expect.objectContaining({ text: "Keep my first message" }),
  ]);
  expect(container.textContent).toContain("Keep my first message");
  expect(container.textContent).toContain("Done");
  expect(container.querySelector("textarea")?.value).toBe("Keep this next message as a draft");
  expect(pendingRemoteSessionSubmission("shell")).toBeUndefined();
  const firstCommand = commands.find(command => command.type === "send")!;
  expect(container.querySelector('[aria-label="Transcript"]')?.getAttribute("data-animate-from")).toBe(firstCommand.commandId);
  await render({ ...shell(), cwd });
  expect(container.querySelector('[aria-label="Transcript"]')?.getAttribute("data-animate-from")).toBeNull();
});

it("keeps the staged first message visible until Host metadata is ready, then sends its files and intent once", async () => {
  projectKey = rememberRemoteProject("env", {
    id: "staged-project", name: "staged chat", cwd: "/home/me/staged-chat",
  }).key;
  const original = vi.mocked(invoke).getMockImplementation()!;
  let describe!: () => void;
  let listModels!: () => void;
  const describing = new Promise<void>(resolve => { describe = resolve; });
  const listing = new Promise<void>(resolve => { listModels = resolve; });
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    if (command === "remote_request") {
      const method = (input as { method: string }).method;
      if (method === "environment.describe") await describing;
      if (method === "models.list") await listing;
    }
    return original(command, input);
  });
  const file = { id: "file", name: "notes.txt", mimeType: "text/plain", kind: "file" as const, size: 3, data: "YWJj" };
  expect(stageRemoteSessionSubmission("shell", "Plan the first message", [file], { intent: "plan" })).toBe(true);
  const initial = pendingRemoteSessionSubmission("shell")!;
  await render();
  expect(container.textContent).toContain("Plan the first message");
  expect(container.querySelector('[aria-label="Transcript"]')?.getAttribute("data-execution-phase")).toBe("starting");
  const initialMessage = container.querySelector(`[data-block-id="${initial.id}"]`);
  expect(initialMessage).not.toBeNull();
  expect(container.querySelector('[aria-label="Transcript"]')?.getAttribute("data-animate-from")).toBe(initial.id);
  expect(commands).toEqual([]);
  await act(async () => describe());
  await settle();
  expect(commands).toEqual([]);
  expect(container.textContent).toContain("Plan the first message");
  expect(container.querySelector('[aria-label="Transcript"]')?.getAttribute("data-execution-phase")).toBe("starting");
  await act(async () => listModels());
  await settle();
  expect(commands.filter(command => command.type === "send")).toEqual([
    expect.objectContaining({ commandId: initial.id, text: "Plan the first message", intent: "plan", attachments: [expect.objectContaining({ name: "notes.txt" })] }),
  ]);
  expect(container.querySelector(`[data-block-id="${initial.id}"]`)).toBe(initialMessage);
  expect(commands.find(command => command.type === "create")).toMatchObject({ harness: "codex", model: gpt.id });
  await render();
  expect(commands.filter(command => command.type === "send")).toHaveLength(1);
});

it("sends the staged first message from a ready Agent while another catalog remains pending", async () => {
  projectKey = rememberRemoteProject("env", {
    id: "progressive-project", name: "progressive chat", cwd: "/home/me/progressive-chat",
  }).key;
  providers = ["codex", "pi"];
  catalog = { models: { codex: [gpt] }, errors: {}, pending: ["pi"] };
  const original = vi.mocked(invoke).getMockImplementation()!;
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  let pendingRequests = 0;
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    const request = input as { method?: string; params?: { providers?: string[] } };
    if (command === "remote_request" && request.method === "models.list" && request.params?.providers) {
      pendingRequests++;
      await waiting;
      return { models: {}, errors: { pi: "Unavailable" }, pending: [] };
    }
    return original(command, input);
  });
  stageRemoteSessionSubmission("shell", "Send without waiting for Pi", []);
  try {
    await render();
    expect(commands.filter(command => command.type === "send")).toEqual([
      expect.objectContaining({ text: "Send without waiting for Pi" }),
    ]);
    expect(commands.find(command => command.type === "create")).toMatchObject({ harness: "codex", model: gpt.id });
    expect(container.querySelector('[data-model-picker-trigger] [aria-label="Loading models…"]')).toBeNull();
    await vi.waitFor(() => expect(pendingRequests).toBe(1));
  } finally {
    await act(async () => finish());
    await settle();
  }
  expect(commands.filter(command => command.type === "send")).toHaveLength(1);
});

it("retains the first message when model loading fails and sends it after retry", async () => {
  projectKey = rememberRemoteProject("env", {
    id: "retry-first-project", name: "retry chat", cwd: "/home/me/retry-first-chat",
  }).key;
  catalog = new Error("Model catalog is offline");
  stageRemoteSessionSubmission("shell", "Keep this through initialization failure", []);
  await render();
  expect(commands).toEqual([]);
  expect(container.textContent).toContain("Keep this through initialization failure");
  expect(container.textContent).toContain("Model catalog is offline");
  catalog = { models: { codex: [gpt] }, errors: {} };
  await act(async () => {
    [...container.querySelectorAll("button")].find(button => button.textContent === "Retry")!.click();
  });
  await settle();
  expect(commands.filter(command => command.type === "send")).toEqual([
    expect.objectContaining({ text: "Keep this through initialization failure" }),
  ]);
  expect(container.textContent).toContain("Done");
});

function proposalSession(): HostSession {
  return {
    projectId: "project", revision: 7, status: "idle", updatedAt: 1,
    session: { ...shell(), id: "host-session", cwd: "/home/me/repo", harness: "codex", model: gpt.id,
      blocks: [{ id: "proposal", role: "assistant", text: "A proposal", orchestration: {
        version: 1, leadId: "host-session", cwd: "/home/me/repo", checkoutCwd: "/home/me/repo",
        request: "Fix the tests", author: { harness: "codex", model: gpt.id, name: "GPT Test" },
        settings: { maxWorkers: 2, choices: [{ harness: "codex", model: gpt.id, name: "GPT Test" }] },
        status: "ready", title: "Test plan", summary: "Fix tests in parallel", tasks: [],
      } }] },
  };
}

it("offers Host orchestration in the menu and preserves its send intent", async () => {
  orchestrationCapability = true;
  await render();
  await act(async () => byLabel("Add files or choose a mode")!.click());
  const option = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("Orchestrator"));
  expect(option).toBeDefined();
  await act(async () => option!.click());
  await send("Coordinate the fix");
  expect(commands.at(-1)).toMatchObject({ type: "send", text: "Coordinate the fix", intent: "orchestrate" });
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command.startsWith("control_"))).toBe(false);
});

it("supports typed orchestrator requests on the local shared Host", async () => {
  orchestrationCapability = true;
  configureSharedHost("env", [{ id: "project", name: "repo", cwd: "/home/me/repo" }], machine.id);
  await render({ ...shell(), cwd: "/home/me/repo" });
  await send("/orchestrator Coordinate the local fix");
  expect(commands.at(-1)).toMatchObject({ type: "send", text: "Coordinate the local fix", intent: "orchestrate" });
});

it("keeps orchestrator unavailable on an old Host without losing a typed request", async () => {
  await render();
  await act(async () => byLabel("Add files or choose a mode")!.click());
  expect([...document.querySelectorAll("button")].some(button => button.textContent?.includes("Orchestrator"))).toBe(false);
  await act(async () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await send("/orchestrator Keep this request");
  expect(commands).toEqual([]);
  expect(container.querySelector("textarea")!.value).toBe("/orchestrator Keep this request");
});

it("atomically confirms edited Host proposals with their original revision", async () => {
  orchestrationCapability = true;
  host = proposalSession();
  rememberRemoteSession("shell", host.session.id);
  await render();
  const four = container.querySelector<HTMLButtonElement>('[role="radiogroup"] button:last-child')!;
  await act(async () => four.click());
  const confirm = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Confirm & start")!;
  await act(async () => confirm.click());
  await settle();
  expect(commands).toContainEqual(expect.objectContaining({ type: "orchestration", action: "confirmProposal",
    sessionId: "host-session", projectId: "project", proposalBlockId: "proposal", expectedRevision: 7,
    edit: { maxWorkers: 4, tasks: [] },
  }));
  expect(host?.session.blocks[0].orchestration?.status).toBe("approved");
});

it("retains edits and rejects confirmation after another device changes the proposal", async () => {
  orchestrationCapability = true;
  host = proposalSession();
  rememberRemoteSession("shell", host.session.id);
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>('[role="radiogroup"] button:last-child')!.click());
  host = { ...host!, revision: 8 };
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Confirm & start")!.click());
  await settle();
  expect(host.session.blocks[0].orchestration?.status).toBe("ready");
  expect(container.querySelector('[role="radiogroup"] button:last-child')?.getAttribute("aria-checked")).toBe("true");
  expect(container.textContent).toContain("Proposal changed on another device");
  expect(commands.at(-1)).toMatchObject({ type: "orchestration", expectedRevision: 7 });
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Reload proposal")!.click());
  await settle();
  expect(container.querySelector('[role="radiogroup"] button:nth-child(2)')?.getAttribute("aria-checked")).toBe("true");
});

it("exposes manual Resume and Stop on the lead card using the stable orchestration ID", async () => {
  orchestrationCapability = true;
  host = proposalSession();
  host.session.blocks[0].orchestration!.status = "approved";
  host.runId = "provider-turn";
  host.orchestration = { id: "orchestration-run", leadId: host.session.id, cwd: "/home/me/repo", proposalId: "proposal",
    status: "paused", allowedHarnesses: ["codex"], maxWorkers: 2, tasks: [] };
  rememberRemoteSession("shell", host.session.id);
  await render();
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Resume")!.click());
  await settle();
  expect(commands.at(-1)).toMatchObject({ type: "orchestration", action: "resume", orchestrationId: "orchestration-run" });
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Stop")!.click());
  await settle();
  expect(commands.at(-1)).toMatchObject({ type: "orchestration", action: "stop", orchestrationId: "orchestration-run" });
  expect(host.orchestration.status).toBe("stopped");
});

it("backs a native project conversation with Host commands and keeps transcript files local", async () => {
  projectKey = "/home/me/repo";
  configureSharedHost("env", [{ id: "project", cwd: projectKey, name: "repo" }]);
  const onOpenFile = vi.fn();
  await render(shell(), { onOpenFile });
  expect(container.querySelector('.composer-environment-badge')?.textContent).toBe("Local");
  await act(async () => byLabel("Add files or choose a mode")!.click());
  const menu = document.querySelector("[data-composer-plus]")!;
  expect(menu.textContent).toMatch(/Files/);
  expect(menu.textContent).not.toContain("Operator");
  const files = [...menu.querySelectorAll<HTMLButtonElement>("button")].find(button => /^Files/.test(button.textContent ?? ""))!;
  await act(async () => files.click());
  expect(document.querySelector("[data-mention-picker]")).not.toBeNull();
  await send("Shared local project");
  expect(commands.map(command => command.type)).toEqual(["create", "send"]);
  expect(remoteSessionFor("shell")).toBe("host-session");
  await act(async () => byLabel("Open transcript file")!.click());
  expect(onOpenFile).toHaveBeenCalledWith("/home/me/repo/src/app.ts");
  configureSharedHost(undefined, []);
});
async function chooseEffort(label: string) {
  await act(async () => byLabel("Reasoning:")!.click());
  const option = [
    ...document.body.querySelectorAll<HTMLButtonElement>(
      '[role="menuitemradio"]',
    ),
  ].find((item) => item.textContent?.includes(label))!;
  await act(async () => option.click());
  await settle();
}

async function chooseModel(provider: string, model: string) {
  const trigger = container.querySelector<HTMLButtonElement>("[data-model-picker-trigger]")!;
  if (trigger.getAttribute("aria-expanded") !== "true") await act(async () => trigger.click());
  const tab = [...document.body.querySelectorAll<HTMLButtonElement>(`[role="tab"][aria-label="${provider}"]`)]
    .find(button => !button.closest("[inert]"));
  expect(tab).toBeDefined();
  await act(async () => tab!.click());
  const option = [...document.body.querySelectorAll<HTMLButtonElement>(`[role="option"][aria-label="${model}, ${provider}"]`)]
    .find(button => !button.closest("[inert]"));
  expect(option?.disabled).toBe(false);
  await act(async () => option!.click());
  await settle();
}

it("uses the normal composer with the host branch in its top row", async () => {
  await render();
  expect(container.querySelector("textarea")).not.toBeNull();
  // The machine is named in the project rail, not the composer.
  expect(container.textContent).not.toContain("Home server");
  expect(byLabel("Branch main")).not.toBeNull();
  expect(
    [...container.querySelectorAll("button")].some(
      (button) => button.textContent === "Changes",
    ),
  ).toBe(false);
  // The host's model, keeping the tab's effort where the model supports it.
  expect(byLabel("Reasoning:")?.getAttribute("aria-label")).toBe(
    "Reasoning: High",
  );
  expect(container.textContent).toContain("GPT Test");
  // Nothing from the old standalone remote view or local-only tools.
  expect(container.textContent).not.toContain("New remote session");
  expect(container.textContent).not.toContain("Apply settings");
  expect(byLabel("Add files or choose a mode")?.closest(".hidden")).toBeNull();
  await act(async () => byLabel("Add files or choose a mode")!.click());
  expect(document.body.textContent).toContain("Upload file");
  expect(document.body.textContent).toContain("Plan mode");
  expect(document.body.textContent).toContain("Draft");
  expect(document.body.textContent).not.toContain("Operator");
  expect(byLabel("Project ")).toBeNull();
});

it("opens transcript files and diffs through the shared remote tabs", async () => {
  const onOpenFile = vi.fn();
  const onOpenDiff = vi.fn();
  await render(shell(), { onOpenFile, onOpenDiff });
  await send("Inspect files");
  await act(async () => byLabel("Open transcript file")!.click());
  await act(async () => byLabel("Open transcript diff")!.click());
  expect(onOpenFile).toHaveBeenCalledWith("remote://env/home/me/repo/src/app.ts");
  expect(onOpenDiff).toHaveBeenCalledWith("remote://env/home/me/repo/src/app.ts");
});

it("reviews the tab's changes through the Host that captured its edits", async () => {
  checkpointCapability = true;
  await render();
  await send("Edit files");
  const status = await sessionCheckpointStatus("shell", projectKey);
  expect(status.files.map((file) => file.path)).toEqual(["remote://env/home/me/repo/src/app.ts"]);
  expect(checkpointRequests).toContainEqual({ projectId: "project", sessionId: host!.session.id, action: "status" });
  await sessionCheckpointStatus("shell", projectKey, undefined, "earlier-turn");
  expect(checkpointRequests).toContainEqual({ projectId: "project", sessionId: host!.session.id, action: "status", turnId: "earlier-turn" });
});

it("shows Host Git changes in the status rail and refreshes review for a completed turn missed between polls", async () => {
  checkpointCapability = true;
  // The status column only appears while the conversation keeps its minimum width.
  const measure = HTMLElement.prototype.getBoundingClientRect;
  const wide = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-session-status-row") ? new DOMRect(0, 0, 1600, 800) : measure.call(this);
  });
  const original = vi.mocked(invoke).getMockImplementation()!;
  let recorded = false;
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    if ((input as { method?: string })?.method === "sessions.checkpoint" && !recorded)
      return { files: [] };
    return original(command, input);
  });
  await render();
  await send("First turn");
  expect(container.querySelector("[data-session-review]")).toBeNull();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
  expect(container.querySelector('[data-status-card="changes"]')?.textContent).toContain("+3");
  wide.mockRestore();
  expect(vi.mocked(invoke).mock.calls.some(([command, input]) => command === "remote_request" &&
    (input as { params?: { command?: string } })?.params?.command === "git_diff_stats")).toBe(true);
  recorded = true;
  host = { ...host!, revision: host!.revision + 1, lastCompletedRunId: "finished-without-tool-events" };
  // Both snapshots are idle and have the same tool count; settlement must still
  // invalidate the previously empty review when the pane catches up.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 3_100)); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
  expect(container.querySelector("[data-session-review]")).not.toBeNull();
});

it("opens a host conversation in an already mounted empty tab", async () => {
  await render(shell(), {
    inSplit: true,
    renderHeader: (session) => createElement("header", {
      "data-resolved-session-header": "",
    }, session.title),
  });
  dispatch({
    type: "create",
    commandId: "existing-session",
    projectId: "project",
    harness: "codex",
    model: gpt.id,
    runtimeMode: "supervised",
  });
  host = {
    ...host!,
    session: {
      ...host!.session,
      title: "Codex · Existing conversation",
      blocks: [{ id: "old-message", role: "user", text: "Earlier message" }],
    },
  };
  commands = [];
  await act(async () => rememberRemoteSession("shell", "host-session"));
  await settle();
  expect(container.textContent).toContain("Earlier message");
  expect(container.querySelectorAll("[data-resolved-session-header]")).toHaveLength(1);
  expect(container.querySelector("[data-resolved-session-header]")?.textContent)
    .toBe("Codex · Existing conversation");
  expect(byLabel("Close pane")).toBeNull();
  await send("Continue here");
  expect(commands.some((command) => command.type === "create")).toBe(false);
  expect(commands.some((command) => command.type === "send")).toBe(true);
});

it("keeps an unopened remote conversation docked while its transcript loads", async () => {
  dispatch({
    type: "create",
    commandId: "existing-session",
    projectId: "project",
    harness: "codex",
    model: gpt.id,
    runtimeMode: "supervised",
  });
  host = {
    ...host!,
    session: {
      ...host!.session,
      id: "unopened-session",
      blocks: [{ id: "old-message", role: "user", text: "Earlier message" }],
    },
  };
  rememberRemoteSession("shell", "unopened-session");
  let releaseSync = () => {};
  syncDelay = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });

  await render();
  const composer = container.querySelector("[data-session-composer]");
  expect(composer?.classList.contains("max-w-4xl")).toBe(true);
  expect(container.textContent).not.toContain("Loading conversation…");
  expect(container.textContent).not.toContain("What should we work on?");

  await act(async () => {
    releaseSync();
    syncDelay = undefined;
  });
  await settle();
  expect(container.textContent).toContain("Earlier message");
  expect(container.querySelector("[data-session-composer]")).toBe(composer);
});

it("shows a preloaded conversation's transcript on its first render", async () => {
  dispatch({
    type: "create",
    commandId: "existing-session",
    projectId: "project",
    harness: "codex",
    model: gpt.id,
    runtimeMode: "supervised",
  });
  host = {
    ...host!,
    session: {
      ...host!.session,
      id: "preloaded-session",
      blocks: [{ id: "old-message", role: "user", text: "Earlier message" }],
    },
  };
  await preloadRemoteSession(machine.id, "preloaded-session");
  rememberRemoteSession("shell", "preloaded-session");
  // Hold every later sync: what shows must come from the preload alone.
  syncDelay = new Promise<void>(() => {});

  await act(async () =>
    root.render(
      createElement(SessionPane, {
        session: shell(),
        visible: true,
        focused: true,
        inSplit: false,
        composerFocused: false,
        recents: [],
        onFocus: vi.fn(),
        onClose: vi.fn(),
      } as unknown as SessionPaneProps),
    ),
  );
  expect(container.textContent).toContain("Earlier message");
  expect(container.textContent).not.toContain("What should we work on?");
});

it("reports a preloaded conversation to the App before any sync returns", async () => {
  hostConversation("cached-session", [{ id: "old-message", role: "user", text: "Earlier message" }]);
  await preloadRemoteSession(machine.id, "cached-session");
  // Hold every later sync: the header must not keep the shell's default agent.
  syncDelay = new Promise<void>(() => {});
  const onRemoteSnapshot = vi.fn();
  await render(shell(), { onRemoteSnapshot });
  expect(onRemoteSnapshot).toHaveBeenCalledWith("shell", expect.objectContaining({
    session: expect.objectContaining({ id: "cached-session", harness: "codex" }),
  }));
});

function hostConversation(id: string, blocks: HostSession["session"]["blocks"]) {
  dispatch({
    type: "create",
    commandId: "existing-session",
    projectId: "project",
    harness: "codex",
    model: gpt.id,
    runtimeMode: "supervised",
  });
  host = { ...host!, session: { ...host!.session, id, blocks } };
  rememberRemoteSession("shell", id);
}
const hostCalls = (method: string, sessionId?: string) =>
  vi.mocked(invoke).mock.calls.filter(([command, input]) => {
    const request = input as { method?: string; params?: { sessionId?: string } };
    return command === "remote_request" && request?.method === method &&
      (!sessionId || request.params?.sessionId === sessionId);
  });

it("opens on a pressed conversation's read still in flight instead of reading again", async () => {
  hostConversation("pressed-session", [{ id: "old-message", role: "user", text: "Earlier message" }]);
  let release!: () => void;
  syncDelay = new Promise<void>((resolve) => { release = resolve; });
  const pressed = preloadRemoteSession(machine.id, "pressed-session");
  await render();
  expect(hostCalls("sessions.sync", "pressed-session")).toHaveLength(1);
  release();
  await act(async () => pressed);
  await settle();
  expect(container.textContent).toContain("Earlier message");
  expect(hostCalls("sessions.sync", "pressed-session")).toHaveLength(1);
});

it("revalidates a tab when it is shown but not when it is hidden", async () => {
  hostConversation("switched-session", [{ id: "old-message", role: "user", text: "Earlier message" }]);
  await render();
  expect(hostCalls("sessions.sync", "switched-session")).toHaveLength(1);
  await render(shell(), { visible: false });
  expect(hostCalls("sessions.sync", "switched-session")).toHaveLength(1);
  await render();
  expect(hostCalls("sessions.sync", "switched-session")).toHaveLength(2);
  expect(hostCalls("environment.describe")).toHaveLength(1);
});

it("shows a conversation before its image previews finish downloading", async () => {
  hostConversation("image-session", [{
    id: "image-message",
    role: "user",
    text: "See screenshot",
    attachments: [{ id: "shot", name: "shot.png", kind: "image", mimeType: "image/png", size: 3 }],
  }]);
  const original = vi.mocked(invoke).getMockImplementation()!;
  let release!: () => void;
  const downloading = new Promise<void>((resolve) => { release = resolve; });
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    if ((input as { method?: string } | undefined)?.method === "attachments.read") {
      await downloading;
      return { data: btoa("png"), offset: 3, size: 3 };
    }
    return original(command, input);
  });
  await render();
  expect(container.textContent).toContain("See screenshot");
  expect(hostCalls("attachments.read")).toHaveLength(1);
  release();
  await settle();
});

it("retains a generated image downloaded while an older text sync is pending", async () => {
  hostConversation("image-sync-race", [{
    id: "generated", role: "image", text: "",
    image: { path: "/host/generated.png", name: "generated.png", mimeType: "image/png", size: 3 },
    attachments: [{ id: "generated-file", name: "generated.png", kind: "image", mimeType: "image/png", size: 3 }],
  }]);
  const original = vi.mocked(invoke).getMockImplementation()!;
  let releaseImage!: () => void;
  const downloading = new Promise<void>((resolve) => { releaseImage = resolve; });
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    if ((input as { method?: string } | undefined)?.method === "attachments.read") {
      // Only the original download succeeds. A redundant retry must not mask
      // the loss of bytes that were already displayed.
      if (hostCalls("attachments.read").length > 1) throw new Error("offline");
      await downloading;
      return { data: btoa("png"), offset: 3, size: 3 };
    }
    return original(command, input);
  });
  await render();
  let releaseSync!: () => void;
  syncDelay = new Promise<void>((resolve) => { releaseSync = resolve; });
  await render(shell(), { visible: false });
  await render();
  expect(hostCalls("sessions.sync", "image-sync-race")).toHaveLength(2);
  releaseImage();
  await settle();
  const image = container.querySelector('img[alt="generated.png"]');
  expect(image?.getAttribute("src")).toBe("data:image/png;base64,cG5n");
  host = { ...host!, revision: 2, session: { ...host!.session,
    blocks: [...host!.session.blocks, { id: "reply-after-image", role: "assistant", text: "Newer reply" }],
  } };
  releaseSync();
  syncDelay = undefined;
  await settle();
  expect(container.textContent).toContain("Newer reply");
  expect(container.querySelector('img[alt="generated.png"]')).toBe(image);
  expect(container.textContent).not.toContain("Could not open generated image.");
  expect(hostCalls("attachments.read")).toHaveLength(1);
});

it("hides branch controls when Git lookup reports no repository", async () => {
  branchFailure = "fatal: not a git repository";
  await render();
  expect(byLabel("No git repository")).toBeNull();
  expect(byLabel("Choose branch")).toBeNull();
});

it("creates the host session with the chosen settings on the first message", async () => {
  await render();
  await chooseEffort("Medium");
  expect(commands).toHaveLength(0);
  await send("Fix the tests");
  expect(commands.map((command) => command.type)).toEqual(["create", "send"]);
  expect(commands[0]).toMatchObject({
    projectId: "project",
    harness: "codex",
    model: "codex:gpt-test",
    modelSettings: { reasoningEffort: "medium" },
  });
  expect(commands[1]).toMatchObject({
    sessionId: "host-session",
    text: "Fix the tests",
  });
  expect(remoteSessionFor("shell")).toBe("host-session");
  expect(container.textContent).toContain("Fix the tests");
});

it("keeps a new session on its selected remote provider", async () => {
  providers = ["codex", "cursor"];
  catalog = {
    models: { codex: [gpt], cursor: [cursor] },
    errors: {},
  };
  await render({
    ...shell(),
    harness: "cursor",
    model: cursor.id,
    modelSettings: {},
  });
  await send("Use Cursor remotely");
  expect(commands[0]).toMatchObject({
    type: "create",
    harness: "cursor",
    model: cursor.id,
  });
});

it("drops settings from the tab that the host's model does not offer", async () => {
  await render({
    ...shell(),
    harness: "codex",
    model: "codex:gpt-test",
    modelSettings: { reasoningEffort: "high", serviceTier: "fast" },
  });
  await send("Fix the tests");
  expect(commands[0]).toMatchObject({ type: "create", model: "codex:gpt-test" });
  expect(commands[0]).toHaveProperty("modelSettings", {
    reasoningEffort: "high",
  });
});

it("sends a remote plan turn from the plus menu", async () => {
  await render();
  await act(async () => byLabel("Add files or choose a mode")!.click());
  const plan = [
    ...document.body.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent?.includes("Plan mode"))!;
  await act(async () => plan.click());
  await send("Plan the migration");
  expect(commands.at(-1)).toMatchObject({
    type: "send",
    text: "Plan the migration",
    intent: "plan",
  });
});

async function saveDraft(text: string) {
  await act(async () => byLabel("Add files or choose a mode")!.click());
  const draft = [
    ...document.body.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) =>
    button.textContent?.includes("Save this message without starting"),
  )!;
  await act(async () => draft.click());
  await type(text);
  await act(async () => byLabel("Save draft")!.click());
  await settle();
}
const transcriptItems = (text: string) =>
  [...container.querySelectorAll("ol[aria-label='Transcript'] li")].filter(
    (item) => item.textContent?.includes(text),
  );

it("saves and sends a remote draft", async () => {
  await render();
  await saveDraft("Review this later");
  expect(commands.map((command) => command.type)).toEqual(["create", "draft"]);
  expect(commands.at(-1)).toMatchObject({
    type: "draft",
    text: "Review this later",
  });
  expect(byLabel("Send remote draft")).not.toBeNull();
  await act(async () => byLabel("Send remote draft")!.click());
  await settle();
  expect(commands.at(-1)).toMatchObject({
    type: "send",
    text: "Review this later",
    draftBlockId: commands[1].commandId,
  });
});

it("keeps a new draft on screen while the host confirms it", async () => {
  await render();
  let releaseSync = () => {};
  syncDelay = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  await saveDraft("Review this later");
  expect(commands.map((command) => command.type)).toEqual(["create", "draft"]);
  expect(transcriptItems("Review this later")).toHaveLength(1);
  expect(container.textContent).not.toContain("What should we work on");
  expect(container.querySelector('[aria-label="Transcript"]')?.getAttribute("data-busy")).toBe("false");
  expect(byLabel("Send remote draft")).not.toBeNull();
  expect(byLabel("Remove remote draft")).not.toBeNull();
  await act(async () => {
    releaseSync();
    syncDelay = undefined;
  });
  await settle();
  expect(transcriptItems("Review this later")).toHaveLength(1);
});

it("replaces a sent draft with its message at once", async () => {
  await render();
  await saveDraft("Review this later");
  syncDelay = new Promise<void>(() => {});
  await act(async () => byLabel("Send remote draft")!.click());
  expect(commands.at(-1)).toMatchObject({ type: "send" });
  expect(transcriptItems("Review this later")).toHaveLength(1);
  expect(byLabel("Send remote draft")).toBeNull();
});

it("removes a draft-only conversation with its draft, as a local one", async () => {
  await render();
  await saveDraft("Review this later");
  const sessionId = remoteSessionFor("shell");
  expect(sessionId).toBe("host-session");
  await act(async () => byLabel("Remove remote draft")!.click());
  expect(transcriptItems("Review this later")).toHaveLength(0);
  await settle();
  expect(deletedSessions).toEqual([sessionId]);
  expect(commands.some((command) => command.type === "removeDraft")).toBe(
    false,
  );
  expect(remoteSessionFor("shell")).toBeUndefined();
  expect(container.textContent).toContain("What should we work on");
});

it("keeps a sent message visible until the host sync confirms it", async () => {
  await render();
  await send("First");
  let releaseSync = () => {};
  syncDelay = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  await type("Second");
  await act(async () => byLabel("Send")!.click());
  expect(commands.at(-1)).toMatchObject({ type: "send", text: "Second" });
  const secondMessages = () =>
    [...container.querySelectorAll("ol[aria-label='Transcript'] li")].filter(
      (item) => item.textContent === "Second",
    );
  expect(secondMessages()).toHaveLength(1);
  expect(
    container
      .querySelector("ol[aria-label='Transcript']")
      ?.getAttribute("data-busy"),
  ).toBe("true");
  await act(async () => {
    releaseSync();
    syncDelay = undefined;
  });
  await settle();
  expect(secondMessages()).toHaveLength(1);
});

it("does not flash a status banner while an ordinary message is in flight", async () => {
  await render();
  await send("First");
  let releaseDispatch = () => {};
  dispatchDelay = new Promise<void>((resolve) => {
    releaseDispatch = resolve;
  });

  await type("Second");
  await act(async () => byLabel("Send")!.click());
  expect(container.textContent).toContain("Second");
  expect(container.textContent).not.toContain("Waiting for the host to confirm");
  expect(container.querySelector('[aria-label="Transcript"]')?.getAttribute("data-execution-phase")).toBe("starting");

  await act(async () => {
    releaseDispatch();
    dispatchDelay = undefined;
  });
  await settle();
  expect(commands.at(-1)).toMatchObject({ type: "send", text: "Second" });
});

it("keeps the first turn active while its accepted message awaits host sync", async () => {
  await render();
  let releaseSync = () => {};
  syncDelay = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  await send("First remote turn");
  expect(commands.map((command) => command.type)).toEqual(["create", "send"]);
  const transcript = () =>
    container.querySelector("ol[aria-label='Transcript']");
  expect(transcript()?.textContent).toContain("First remote turn");
  expect(transcript()?.getAttribute("data-busy")).toBe("true");
  expect(transcript()?.getAttribute("data-execution-phase")).toBe("starting");
  await act(async () => {
    releaseSync();
    syncDelay = undefined;
  });
  await settle();
  expect(transcript()?.querySelectorAll("li")).toHaveLength(2);
  expect(transcript()?.getAttribute("data-busy")).toBe("false");
  expect(transcript()?.getAttribute("data-execution-phase")).toBeNull();
});

it("starts a remote session in the worktree chosen before its first message", async () => {
  await render();
  await act(async () => byLabel("Workspace Current checkout")!.click());
  const existing = [
    ...document.body.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent?.trim() === "Existing worktree…");
  await act(async () => existing!.click());
  await settle();
  const worktree = [
    ...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ].find((button) => button.title === "remote://env/home/me/repo-worktrees/dev");
  expect(worktree).toBeDefined();
  await act(async () => worktree!.click());
  await send("Work in dev");
  expect(commands[0]).toMatchObject({
    type: "create",
    executionCwd: "/home/me/repo-worktrees/dev",
  });
  expect(host?.session.cwd).toBe("/home/me/repo-worktrees/dev");
  // Once started, the bar no longer offers or labels the working copy.
  expect(container.querySelector('[aria-label="Workspace dev"]')).toBeNull();
  expect(byLabel("Workspace Worktree")).toBeNull();
});

it.each([
  { local: false, worktree: false },
  { local: true, worktree: false },
  { local: false, worktree: true },
])("updates Pi's execution directory when an unsent chat changes projects (local: $local, worktree: $worktree)", async ({ local, worktree }) => {
  const model: AgentModel = { id: "pi:test", harness: "pi", name: "Pi Test", nativeId: "test", settings: [] };
  providers = ["pi"];
  catalog = { models: { pi: [model] }, errors: {} };
  const targetProject = { id: "project-b", name: "A-Test", cwd: "/home/me/A-Test" };
  if (local) configureSharedHost("env", [
    { id: "project", name: "repo", cwd: "/home/me/repo" }, targetProject,
  ], machine.id);
  const initial = { ...shell(), cwd: local ? "/home/me/repo" : projectKey,
    harness: "pi" as const, model: model.id, modelSettings: {} };
  await render(initial);
  if (worktree) {
    await act(async () => byLabel("Workspace Current checkout")!.click());
    const create = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
      .find(button => button.textContent?.trim() === "New worktree");
    await act(async () => create!.click());
    expect(byLabel("Workspace New worktree")).not.toBeNull();
  }
  await type("Keep this prompt when switching projects");
  const textarea = container.querySelector("textarea")!;
  const target = local ? targetProject.cwd : rememberRemoteProject("env", targetProject).key;

  // Folder navigation retargets the same unsent chat and clears its checkout.
  branchFailure = "fatal: not a git repository (or any of the parent directories): .git";
  await render({ ...initial, cwd: target, executionCwd: undefined });
  expect(container.querySelector("textarea")).toBe(textarea);
  expect(textarea.value).toBe("Keep this prompt when switching projects");
  await act(async () => byLabel("Send")!.click());
  await settle();

  expect(commands[0]).toMatchObject({ type: "create", projectId: targetProject.id,
    harness: "pi", executionCwd: targetProject.cwd });
  expect(commands[1]).toMatchObject({ type: "send", text: "Keep this prompt when switching projects" });
  expect(invoke).not.toHaveBeenCalledWith("remote_request", expect.objectContaining({ method: "git.worktreeName" }));
});

it("creates a host worktree through the composer and selects it", async () => {
  await render();
  await act(async () => byLabel("Workspace Current checkout")!.click());
  expect(
    document.body.querySelector('[aria-label="Workspace"]'),
  ).not.toBeNull();
  expect(document.body.textContent).toContain("Existing worktree…");
  expect(document.body.textContent).not.toContain("Worktree settings");
  expect(
    document.body.querySelector('[aria-label="Existing worktrees"]'),
  ).toBeNull();
  expect(
    document.body.querySelector('input[placeholder="Search working copies…"]'),
  ).toBeNull();
  const create = [
    ...document.body.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent?.trim() === "New worktree");
  await act(async () => create!.click());
  expect(byLabel("Workspace New worktree")).not.toBeNull();
  expect(byLabel("Create worktree from main")).not.toBeNull();
  expect(byLabel("Branch main")).toBeNull();
  await act(async () => byLabel("Create worktree from main")!.click());
  const devBase = [
    ...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ].find((button) => button.textContent?.trim() === "dev");
  await act(async () => devBase!.click());
  expect(byLabel("Create worktree from dev")).not.toBeNull();
  expect(invoke).not.toHaveBeenCalledWith(
    "remote_request",
    expect.objectContaining({ method: "git.worktreeCreate" }),
  );
  await send("Work in new tree");
  expect(invoke).toHaveBeenCalledWith(
    "remote_request",
    expect.objectContaining({
      method: "git.worktreeCreate",
      params: expect.objectContaining({
        projectId: "project",
        cwd: "/home/me/repo",
        branch: "mc/work-in-new-tree",
        base: "dev",
        existing: false,
      }),
    }),
  );
  expect(commands[0]).toMatchObject({
    type: "create",
    executionCwd: createdWorktree,
  });
  expect(commands[0]).not.toHaveProperty("autoWorktreeBranch");
  expect(invoke).toHaveBeenCalledWith("remote_request", expect.objectContaining({
    method: "git.worktreeName",
    params: expect.objectContaining({ projectId: "project", message: "Work in new tree", harness: "codex" }),
  }));
  expect(createdWorktree).toBe("/home/me/repo-worktrees/wt-mc-work-in-new-tree");
  // The first message keeps the record, so the Host can show it after a reload.
  expect(commands[1]).toMatchObject({
    type: "send",
    worktreeCreation: {
      base: "dev",
      path: createdWorktree,
      log: expect.arrayContaining([
        { kind: "output", text: `Preparing worktree (new branch '${createdBranch}')` },
      ]),
    },
  });
  // The record reaches the transcript anchored to the first message, with Git's lines.
  const firstMessage = [...document.body.querySelectorAll<HTMLElement>("[data-block-id]")].find(
    (node) => node.textContent?.includes("Work in new tree"),
  );
  const record = document.body.querySelector<HTMLElement>('[aria-label="Worktree creation"]');
  expect(firstMessage).toBeDefined();
  expect(record?.dataset.status).toBe("created");
  expect(record?.dataset.anchor).toBe(firstMessage?.dataset.blockId);
  expect(record?.textContent).toContain(`Preparing worktree (new branch '${createdBranch}')`);
});

it("keeps a failed naming attempt retryable without creating a random worktree", async () => {
  await render();
  await act(async () => byLabel("Workspace Current checkout")!.click());
  const create = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === "New worktree");
  await act(async () => create!.click());
  nameFailure = "Could not generate a worktree name. Check the title model or agent connection and retry.";
  await send("Work in new tree");
  expect(invoke).not.toHaveBeenCalledWith("remote_request", expect.objectContaining({ method: "git.worktreeCreate" }));
  expect(commands).toEqual([]);
  expect(document.body.textContent).toContain("Could not generate a worktree name");
  nameFailure = undefined;
  const retry = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === "Try again");
  expect(retry).toBeDefined();
  await act(async () => retry!.click());
  await settle();
  expect(createdWorktree).toBe("/home/me/repo-worktrees/wt-mc-work-in-new-tree");
  expect(commands.map((command) => command.type)).toEqual(["create", "send"]);
});

it("searches and creates a host branch from the composer picker", async () => {
  await render();
  await act(async () => byLabel("Branch main")!.click());
  const search = document.body.querySelector<HTMLInputElement>(
    'input[aria-label="Search or create a branch"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(search, "feature/test");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const create = [
    ...document.body.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) =>
    button.textContent?.includes("Create and checkout feature/test"),
  );
  await act(async () => create!.click());
  await settle();
  expect(invoke).toHaveBeenCalledWith(
    "remote_request",
    expect.objectContaining({
      method: "workspace.run",
      params: expect.objectContaining({
        command: "git_create_branch",
        args: expect.objectContaining({
          name: "feature/test",
          cwd: "/home/me/repo",
        }),
      }),
    }),
  );
  expect(byLabel("Branch feature/test")).not.toBeNull();
});

it("keeps a failed host branch action in the picker", async () => {
  branchActionFailure =
    "Commit or stash changes on the host before switching branches";
  await render();
  await act(async () => byLabel("Branch main")!.click());
  const dev = [
    ...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ].find((button) => button.textContent?.includes("dev"));
  await act(async () => dev!.click());
  await settle();
  expect(
    document.body.querySelector('[aria-label="Branch picker"]'),
  ).not.toBeNull();
  expect(document.body.textContent).toContain(branchActionFailure);
});

it("locks a started remote session to its worktree like a local session", async () => {
  host = {
    projectId: "project",
    revision: 1,
    status: "idle",
    updatedAt: 0,
    session: {
      id: "host-session",
      cwd: "/home/me/repo",
      harness: "codex",
      model: "codex:gpt-test",
      modelSettings: {},
      runtimeMode: "supervised",
      title: "Existing conversation",
      blocks: [{ id: "first", role: "user", text: "Earlier work" }],
    },
  };
  rememberRemoteSession("shell", "host-session");
  await render();
  // A started conversation keeps its working copy and branch out of the composer bar.
  expect(container.querySelector('[aria-label="Workspace Current checkout"]')).toBeNull();
  expect(byLabel("Workspace Current checkout")).toBeNull();
  expect(byLabel("Branch main")).toBeNull();
  expect(commands).toHaveLength(0);
});

it("sends historical question answers with their durable identity from the desktop", async () => {
  dispatch({ type: "create", commandId: "existing", projectId: "project",
    harness: "codex", model: gpt.id, runtimeMode: "supervised" });
  host!.session.blocks = [{ id: "question-history", role: "system", text: "Which source?",
    question: { requestId: 7, allowLateReply: true, decision: "skipped", questions: [{
      id: "source", prompt: "Which source?", multiSelect: false, allowCustom: false,
      options: [{ id: "local", label: "Local" }],
    }] } }];
  rememberRemoteSession("shell", "host-session");
  commands = [];
  await render();
  await act(async () => byLabel("Answer historical question")!.click());
  await settle();
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({ type: "send", sessionId: "host-session",
    text: "Which source?\nLocal", followUpBehavior: "steer",
    questionAnswer: { blockId: "question-history", reply: { kind: "answered", answers: { source: ["local"] } } },
  });
});

it("applies effort changes directly and uses them on the next turn", async () => {
  await render();
  await send("First");
  await chooseEffort("Low");
  expect(commands.at(-1)).toMatchObject({
    type: "configure",
    model: "codex:gpt-test",
    modelSettings: { reasoningEffort: "low" },
  });
  expect(host?.session.modelSettings).toEqual({ reasoningEffort: "low" });
  await settle();
  expect(
    commands.filter((command) => command.type === "configure"),
  ).toHaveLength(1);
  await send("Second");
  expect(commands.at(-1)).toMatchObject({ type: "send", text: "Second" });

  // Reopening the tab shows the saved setting.
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(byLabel("Reasoning:")?.getAttribute("aria-label")).toBe(
    "Reasoning: Low",
  );
});

it("stages an existing Host conversation provider choice until its next send", async () => {
  providers = ["codex", "cursor"];
  catalog = { models: { codex: [gpt], cursor: [cursor] }, errors: {} };
  await render();
  await send("Earlier work");
  await chooseModel("Cursor", cursor.name);
  expect(commands.at(-1)).toMatchObject({
    type: "configure", sessionId: "host-session", harness: "cursor",
    model: cursor.id, modelSettings: {}, runtimeMode: "supervised",
  });
  expect(host?.session.harness).toBe("codex");
  expect(host?.session.pendingConfiguration?.harness).toBe("cursor");
  expect(container.textContent).toContain("Earlier work");
  expect(byLabel("Cursor Composer Test")).not.toBeNull();
  expect(byLabel("Reasoning:")).toBeNull();
  await send("Continue with Cursor");
  expect(host?.session.harness).toBe("cursor");
  expect(host?.session.pendingConfiguration).toBeUndefined();
  expect(commands.at(-1)).toMatchObject({ type: "send", sessionId: "host-session", text: "Continue with Cursor" });
  expect(commands.filter(command => command.type === "create")).toHaveLength(1);
  expect(commands.filter(command => command.type === "configure")).toHaveLength(1);
});

it("keeps a saved draft on the original agent and restores the pending choice when reopened", async () => {
  providers = ["codex", "cursor"];
  catalog = { models: { codex: [gpt], cursor: [cursor] }, errors: {} };
  const onRemoteSnapshot = vi.fn();
  await render(shell(), { onRemoteSnapshot });
  await send("Earlier work");
  await chooseModel("Cursor", cursor.name);
  await act(async () => root.unmount());
  root = createRoot(container);
  await render(shell(), { onRemoteSnapshot });
  expect(byLabel("Cursor Composer Test")).not.toBeNull();
  let release!: () => void;
  syncDelay = new Promise<void>(resolve => { release = resolve; });
  await saveDraft("Send this later");
  expect(host?.session.harness).toBe("codex");
  expect(onRemoteSnapshot.mock.calls.at(-1)?.[1].session.harness).toBe("codex");
  expect(onRemoteSnapshot.mock.calls.at(-1)?.[1].session.pendingConfiguration?.harness).toBe("cursor");
  await act(async () => { release(); syncDelay = undefined; });
  await settle();
  await act(async () => byLabel("Send remote draft")!.click());
  await settle();
  expect(host?.session.harness).toBe("cursor");
  expect(host?.session.pendingConfiguration).toBeUndefined();
});

it("keeps existing sessions on their provider when an older Host does not support handoff", async () => {
  handoffCapability = false;
  providers = ["codex", "cursor"];
  catalog = { models: { codex: [gpt], cursor: [cursor] }, errors: {} };
  await render();
  await send("Earlier work");
  await act(async () => container.querySelector<HTMLButtonElement>("[data-model-picker-trigger]")!.click());
  expect(document.body.querySelector('[role="tab"][aria-label="Codex"]')).not.toBeNull();
  expect(document.body.querySelector('[role="tab"][aria-label="Cursor"]')).toBeNull();
  expect(commands.filter(command => command.type === "configure")).toHaveLength(0);
});

it.each([false, true])("treats matching model IDs on different providers as a handoff (same settings: %s)", async (sameSettings) => {
  providers = ["codex", "cursor"];
  const sharedId = "shared-model";
  catalog = { models: { codex: [{ ...gpt, id: sharedId }], cursor: [{ ...cursor, id: sharedId, settings: sameSettings ? gpt.settings : [] }] }, errors: {} };
  await render({ ...shell(), harness: "codex", model: sharedId });
  await send("Earlier work");
  await chooseModel("Cursor", cursor.name);
  expect(commands.at(-1)).toMatchObject({ type: "configure", harness: "cursor", model: sharedId,
    modelSettings: sameSettings ? { reasoningEffort: "high" } : {} });
  if (!sameSettings) expect(byLabel("Reasoning:")).toBeNull();
});

it("holds a provider switch during a running turn and applies it once the turn ends", async () => {
  providers = ["codex", "cursor"];
  catalog = { models: { codex: [gpt], cursor: [cursor] }, errors: {} };
  dispatch({ type: "create", commandId: "existing", projectId: "project", harness: "codex", model: gpt.id, runtimeMode: "supervised" });
  host = { ...host!, status: "running", runId: "run", supportsQueue: true,
    session: { ...host!.session, busy: true, blocks: [{ id: "old", role: "user", text: "Earlier work" }] } };
  rememberRemoteSession("shell", "host-session");
  commands = [];
  await render();
  await chooseModel("Cursor", cursor.name);
  expect(commands).toHaveLength(0);
  await type("Wait for Cursor");
  await act(async () => byLabel("Send")!.click());
  expect(commands).toHaveLength(0);
  expect(container.querySelector("textarea")?.value).toBe("Wait for Cursor");
  await type("");
  await act(async () => byLabel("Stop")!.click());
  host = { ...host!, revision: host!.revision + 1, status: "idle", runId: undefined,
    session: { ...host!.session, busy: false } };
  await vi.waitFor(() => expect(commands.at(-1)).toMatchObject({ type: "configure", harness: "cursor" }), { timeout: 4_000 });
  await settle();
  await send("Continue after the turn");
  expect(commands.at(-1)).toMatchObject({ type: "send", text: "Continue after the turn" });
});

it("retries an accepted provider switch with its original command while waiting for a snapshot", async () => {
  providers = ["codex", "cursor"];
  catalog = { models: { codex: [gpt], cursor: [cursor] }, errors: {} };
  const original = vi.mocked(invoke).getMockImplementation()!;
  let accepted: ReturnType<typeof dispatch> | undefined;
  const attempts: HostCommand[] = [];
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    const request = input as { method?: string; params?: HostCommand } | undefined;
    if (request?.method === "commands.dispatch" && request.params?.type === "configure") {
      attempts.push(request.params);
      if (accepted) return accepted;
      accepted = dispatch(request.params);
      throw new Error("Response lost after host accepted the request");
    }
    return original(command, input);
  });
  await render();
  await send("Earlier work");
  let release!: () => void;
  syncDelay = new Promise<void>(resolve => { release = resolve; });
  await chooseModel("Cursor", cursor.name);
  const retry = [...container.querySelectorAll("button")].find(button => button.textContent === "Retry")!;
  expect(retry).toBeTruthy();
  await act(async () => retry.click());
  await settle();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await act(async () => { release(); syncDelay = undefined; });
  await settle();
  await send("Continue after retry");
  expect(commands.at(-1)).toMatchObject({ type: "send", text: "Continue after retry" });
});

it("keeps the receipt's provider identity when a newer provider is selected before retrying a settings change", async () => {
  providers = ["codex", "cursor"];
  catalog = { models: { codex: [gpt], cursor: [cursor] }, errors: {} };
  const original = vi.mocked(invoke).getMockImplementation()!;
  let accepted: ReturnType<typeof dispatch> | undefined;
  const attempts: HostCommand[] = [];
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    const request = input as { method?: string; params?: HostCommand } | undefined;
    if (request?.method === "commands.dispatch" && request.params?.type === "configure") {
      attempts.push(request.params);
      if (accepted?.commandId === request.params.commandId) return accepted;
      if (!accepted) {
        accepted = dispatch(request.params);
        throw new Error("Response lost after host accepted the request");
      }
    }
    return original(command, input);
  });
  await render();
  await send("Earlier work");
  let release!: () => void;
  syncDelay = new Promise<void>(resolve => { release = resolve; });
  await chooseEffort("Low");
  expect(attempts[0]).toMatchObject({ type: "configure", harness: "codex", modelSettings: { reasoningEffort: "low" } });
  await chooseModel("Cursor", cursor.name);
  expect(attempts).toHaveLength(1);
  const retry = [...container.querySelectorAll("button")].find(button => button.textContent === "Retry")!;
  await act(async () => retry.click());
  await settle();
  expect(attempts).toHaveLength(3);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[2]).toMatchObject({ type: "configure", harness: "cursor", model: cursor.id });
  await act(async () => { release(); syncDelay = undefined; });
  await settle();
  await send("Continue with Cursor after retry");
  expect(host?.session.harness).toBe("cursor");
  expect(commands.at(-1)).toMatchObject({ type: "send", text: "Continue with Cursor after retry" });
});

it("honors a switch back selected before the first provider change is confirmed", async () => {
  providers = ["codex", "cursor"];
  catalog = { models: { codex: [gpt], cursor: [cursor] }, errors: {} };
  await render({ ...shell(), harness: "codex", model: gpt.id, modelSettings: { reasoningEffort: "medium" } });
  await send("Earlier work");
  let release!: () => void;
  dispatchDelay = new Promise<void>(resolve => { release = resolve; });
  await chooseModel("Cursor", cursor.name);
  await chooseModel("Codex", gpt.name);
  await act(async () => { release(); dispatchDelay = undefined; });
  await settle();
  expect(commands.filter(command => command.type === "configure").map(command => command.harness)).toEqual(["cursor", "codex"]);
  expect(host?.session.harness).toBe("codex");
  await send("Continue with Codex");
  expect(commands.at(-1)).toMatchObject({ type: "send", text: "Continue with Codex" });
});

it("restores the current provider after a definitive switch rejection without automatically retrying", async () => {
  providers = ["codex", "cursor"];
  catalog = { models: { codex: [gpt], cursor: [cursor] }, errors: {} };
  const original = vi.mocked(invoke).getMockImplementation()!;
  const attempts: HostCommand[] = [];
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    const request = input as { method?: string; params?: HostCommand } | undefined;
    if (request?.method === "commands.dispatch" && request.params?.type === "configure") {
      attempts.push(request.params);
      throw new Error("Host rejected request: Wait for the provider session to finish syncing");
    }
    return original(command, input);
  });
  await render();
  await send("Earlier work");
  await chooseModel("Cursor", cursor.name);
  expect(attempts).toHaveLength(1);
  expect(byLabel("Codex GPT Test")).not.toBeNull();
  expect(container.textContent).toContain("Wait for the provider session to finish syncing");
  await send("Continue with the original provider");
  expect(commands.at(-1)).toMatchObject({ type: "send", text: "Continue with the original provider" });
  expect(host?.session.harness).toBe("codex");
});

it("keeps DeepSeek route IDs out of the model label while the Host catalog loads and fails", async () => {
  const id = 'deepseek:["deepseek-account","deepseek-flash"]';
  providers = ["deepseek"];
  catalog = new Error("DeepSeek catalog is offline");
  let releaseModels!: () => void;
  const listing = new Promise<void>(resolve => { releaseModels = resolve; });
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    if (command === "remote_request" && (input as { method?: string })?.method === "models.list")
      await listing;
    return original(command, input);
  });
  const trigger = () => container.querySelector<HTMLButtonElement>("[data-model-picker-trigger]")!;
  try {
    await render({ ...shell(), harness: "deepseek", model: id, modelSettings: {} });
    expect(trigger().textContent).toContain("deepseek-flash");
    expect(trigger().textContent).not.toContain("[");
    await act(async () => releaseModels());
    await settle();
    expect(container.textContent).toContain("DeepSeek catalog is offline");
    expect(trigger().textContent).toContain("deepseek-flash");
    expect(trigger().textContent).not.toContain("[");
    catalog = { models: { deepseek: [{ id, harness: "deepseek", name: "DeepSeek-V4.1-Flash" }] }, errors: {} };
    await act(async () => {
      [...container.querySelectorAll("button")].find(button => button.textContent === "Retry")!.click();
    });
    await settle();
    expect(trigger().textContent).toContain("DeepSeek-V4.1-Flash");
    expect(commands).toEqual([]);
  } finally {
    releaseModels();
    await settle();
  }
});

it("keeps a saved model's effort editable when the host catalog fails", async () => {
  await render();
  await send("First");
  catalog = new Error("Codex CLI is not authenticated");
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(container.textContent).toContain("Couldn’t load models");
  expect(byLabel("Reasoning:")?.getAttribute("aria-label")).toBe(
    "Reasoning: High",
  );
  await chooseEffort("Low");
  expect(commands.at(-1)).toMatchObject({
    type: "configure",
    model: "codex:gpt-test",
    modelSettings: { reasoningEffort: "low" },
  });
});

it("asks to connect the machine when it is not set up on this computer", async () => {
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "remote_machines" ? [] : undefined,
  );
  await render();
  expect(container.textContent).toContain(
    "The machine for this project isn’t connected on this computer.",
  );
  expect(container.querySelector("textarea")).toBeNull();
});

it("holds a settings change during a running turn and applies it afterwards", async () => {
  await render();
  await send("First");
  host = {
    ...host!,
    revision: host!.revision + 1,
    status: "running",
    runId: "run",
    session: { ...host!.session, busy: true },
  };
  await vi.waitFor(() => expect(byLabel("Stop")).not.toBeNull(), {
    timeout: 4_000,
  });
  await chooseEffort("Low");
  expect(commands.some((command) => command.type === "configure")).toBe(false);

  await act(async () => byLabel("Stop")!.click());
  expect(commands.at(-1)).toMatchObject({ type: "cancel", runId: "run" });

  host = {
    ...host!,
    revision: host!.revision + 1,
    status: "idle",
    runId: undefined,
    session: { ...host!.session, busy: false },
  };
  await vi.waitFor(
    () =>
      expect(commands.at(-1)).toMatchObject({
        type: "configure",
        modelSettings: { reasoningEffort: "low" },
      }),
    { timeout: 4_000 },
  );
});

it.each([false, true])("retries a lost create response without duplicating the first turn (remount: %s)", async (remount) => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  let accepted: ReturnType<typeof dispatch> | undefined;
  const attempts: HostCommand[] = [];
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    const request = input as { method?: string; params?: HostCommand } | undefined;
    if (request?.method === "commands.dispatch" && request.params?.type === "create") {
      attempts.push(request.params);
      if (accepted) return accepted;
      accepted = dispatch(request.params);
      throw new Error("Response lost after host accepted the request");
    }
    return original(command, input);
  });
  await render();
  await send("Keep this first message");
  expect(commands.map((command) => command.type)).toEqual(["create"]);
  if (remount) {
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
  }
  const retry = [...container.querySelectorAll("button")].find((button) => button.textContent === "Retry")!;
  expect(retry).toBeTruthy();
  await act(async () => retry.click());
  await settle();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(commands.map((command) => command.type)).toEqual(["create", "send"]);
  expect(commands[1]).toMatchObject({ text: "Keep this first message", sessionId: "host-session" });
  expect(transcriptItems("Keep this first message")).toHaveLength(1);
});

it("ignores a late create response after its tab has switched conversations", async () => {
  await render();
  let release!: () => void;
  dispatchDelay = new Promise<void>((resolve) => { release = resolve; });
  await send("Pending first message");
  await act(async () => rememberRemoteSession("shell", "different-session"));
  await act(async () => { release(); dispatchDelay = undefined; });
  await settle();
  expect(remoteSessionFor("shell")).toBe("different-session");
  expect(commands.map((command) => command.type)).toEqual(["create"]);
  expect(container.textContent).not.toContain("Pending first message");
});

it("shows the Host queue in the desktop composer, queues while busy, and edits and deletes shared rows", async () => {
  dispatch({ type: "create", commandId: "queue-session", projectId: "project", harness: "codex", model: gpt.id, runtimeMode: "supervised" });
  host = { ...host!, status: "running", runId: "shared-run", supportsQueue: true, canSteer: true,
    session: { ...host!.session, busy: true, blocks: [{ id: "old", role: "user", text: "Current work" }],
      queuedMessages: [{ id: "phone", text: "Queued from phone", attachments: [] }], queueStatus: "active" } };
  rememberRemoteSession("shell", "host-session");
  await render();
  expect(container.querySelector('[data-message-queue]')?.textContent).toContain("Queued from phone");
  await send("Queued from desktop");
  expect(host!.session.queuedMessages?.map(row => row.text)).toEqual(["Queued from phone", "Queued from desktop"]);
  expect(container.querySelector('[data-message-queue]')?.textContent).toContain("Queued from desktop");
  expect(container.querySelector('[aria-label="Transcript"]')?.textContent).not.toContain("Queued from desktop");
  await act(async () => byLabel("Edit queued message")!.click()); await settle();
  const edit = container.querySelector<HTMLTextAreaElement>("textarea")!;
  expect(edit.value).toBe("Queued from phone");
  expect(document.activeElement).toBe(edit);
  expect(host!.session.queuedMessages?.map(row => row.text)).toEqual(["Queued from desktop"]);
  expect(container.querySelector('[data-message-queue] textarea')).toBeNull();
  await send("Edited on desktop");
  expect(host!.session.queuedMessages?.map(row => row.text)).toEqual(["Edited on desktop", "Queued from desktop"]);
  expect(commands.filter(command => command.type === "send").at(-1)).toMatchObject({
    queueReturnPosition: { precedingIds: [], followingIds: [host!.session.queuedMessages![1].id], lastUserMessageId: "old" },
  });
  await act(async () => container.querySelector<HTMLButtonElement>(`[data-queue-id="${host!.session.queuedMessages![0].id}"] [aria-label="Remove queued message"]`)!.click()); await settle();
  expect(host!.session.queuedMessages).toHaveLength(1);
  // AutoAnimate retains the removed row until its exit finishes. Happy DOM's
  // WAAPI clock is independent of the Host synchronization microtasks.
  await act(async () => {
    for (const element of container.querySelectorAll("*"))
      for (const animation of element.getAnimations()) animation.finish();
  });
  await settle();
  host = { ...host!, status: "idle", session: { ...host!.session, busy: false } };
  await act(async () => container.querySelector<HTMLButtonElement>(`[data-queue-id="${host!.session.queuedMessages![0].id}"] [aria-label="Remove queued message"]`)!.click()); await settle();
  expect(container.querySelector('[aria-label="Transcript"]')?.getAttribute("data-busy")).toBe("false");
  expect(container.querySelector('[aria-label="Transcript"]')?.textContent).not.toContain("Queued from desktop");
  expect(commands.filter(command => command.type === "queue").map(command => command.type === "queue" && command.action)).toEqual(["remove", "remove", "remove"]);
});

it("reorders the desktop Host queue through a durable move command", async () => {
  dispatch({ type: "create", commandId: "queue-session", projectId: "project", harness: "codex", model: gpt.id, runtimeMode: "supervised" });
  host = { ...host!, status: "running", supportsQueue: true, canSteer: true,
    session: { ...host!.session, busy: true, blocks: [{ id: "old", role: "user", text: "Current work" }],
      queuedMessages: ["a", "b", "c"].map(id => ({ id, text: id, attachments: [] })), queueStatus: "active" } };
  rememberRemoteSession("shell", "host-session");
  await render();
  await act(async () => container.querySelector('[data-queue-id="b"] button')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  await settle();
  await act(async () => {
    for (const element of container.querySelectorAll("*"))
      for (const animation of element.getAnimations()) animation.finish();
  });
  expect(commands.find(command => command.type === "queue")).toMatchObject({ type: "queue", action: "move", messageId: "b", sessionId: "host-session" });
  expect(host!.session.queuedMessages?.map(row => row.id)).toEqual(["a", "c", "b"]);
  expect([...container.querySelectorAll<HTMLElement>("[data-queue-id]")].map(row => row.dataset.queueId)).toEqual(["a", "c", "b"]);
});

it("retains the Host queue and desktop draft when take-back attachment reading fails", async () => {
  dispatch({ type: "create", commandId: "queue-session", projectId: "project", harness: "codex", model: gpt.id, runtimeMode: "supervised" });
  host = { ...host!, status: "running", supportsQueue: true,
    session: { ...host!.session, busy: true, blocks: [{ id: "old", role: "user", text: "Current work" }],
      queuedMessages: [{ id: "image-row", text: "Queued image", attachments: [{ id: "image", name: "image.png", mimeType: "image/png", kind: "image", size: 3 }] }] } };
  rememberRemoteSession("shell", "host-session");
  await render();
  await type("Unsent draft");
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    if ((input as { method?: string })?.method === "attachments.read") throw new Error("Image unavailable");
    return original(command, input);
  });
  await act(async () => byLabel("Edit queued message")!.click());
  await settle();
  expect(container.querySelector("textarea")!.value).toBe("Unsent draft");
  expect(host!.session.queuedMessages?.map(row => row.id)).toEqual(["image-row"]);
  expect(commands.some(command => command.type === "queue")).toBe(false);
  expect(container.querySelector('[data-message-queue] [role="alert"]')?.textContent).toContain("Image unavailable");
});

it("puts a send to a busy Host conversation straight into the queue, never the transcript", async () => {
  dispatch({ type: "create", commandId: "queue-session", projectId: "project", harness: "codex", model: gpt.id, runtimeMode: "supervised" });
  host = { ...host!, status: "running", runId: "shared-run", supportsQueue: true, canSteer: true,
    session: { ...host!.session, busy: true, executionState: { runId: "shared-run", phase: "active", since: 1 },
      blocks: [{ id: "old", role: "user", text: "Current work" }] } };
  rememberRemoteSession("shell", "host-session");
  await render();
  let releaseDispatch = () => {};
  dispatchDelay = new Promise<void>((resolve) => { releaseDispatch = resolve; });
  await type("Next up");
  await act(async () => byLabel("Send")!.click());
  // In flight: already a queue row, and never a transcript bubble.
  expect(container.querySelector('[data-message-queue]')?.textContent).toContain("Next up");
  expect(container.querySelector('[aria-label="Transcript"]')?.textContent).not.toContain("Next up");
  expect(container.querySelector('[aria-label="Transcript"]')?.getAttribute("data-execution-phase")).toBe("active");
  await act(async () => {
    releaseDispatch();
    dispatchDelay = undefined;
  });
  await settle();
  expect(container.querySelector('[data-message-queue]')?.textContent?.match(/Next up/g)).toHaveLength(1);
  expect(container.querySelector('[aria-label="Transcript"]')?.textContent).not.toContain("Next up");
});

it("passes an explicit desktop account and leaves a following default for Host to resolve", async () => {
  configureSharedHost("env", [{ id: "project", name: "repo", cwd: "/home/me/repo" }], machine.id);
  rememberSharedProviderDefaults({ codex: "shared" });
  await render({ ...shell(), cwd: "/home/me/repo" });
  await send("Follow the current Host default");
  expect(commands.find(command => command.type === "create")).not.toHaveProperty("providerAccountId", "shared");
});
it("honors a temporary desktop account choice for the first Host create", async () => {
  configureSharedHost("env", [{ id: "project", name: "repo", cwd: "/home/me/repo" }], machine.id);
  saveProviderAccount({ provider: "codex", id: "work", label: "Work" });
  selectProviderAccount("codex", "/home/me/repo", "work");
  await render({ ...shell(), cwd: "/home/me/repo", harness: "codex", model: gpt.id, providerAccountId: "temporary" });
  await send("Use the selected account");
  expect(commands.find(command => command.type === "create")).toMatchObject({ providerAccountId: "temporary" });
});

it("dismisses a Host usage limit locally and resumes it with a continue turn", async () => {
  dispatch({ type: "create", commandId: "limited-session", projectId: "project", harness: "codex", model: gpt.id, runtimeMode: "supervised" });
  host = { ...host!, session: { ...host!.session, usageLimit: {},
    blocks: [{ id: "old", role: "user", text: "Earlier work" }] } };
  rememberRemoteSession("shell", "host-session");
  await render();
  const notice = () => container.querySelector("[data-usage-limit]");
  expect(notice()).not.toBeNull();
  expect(byLabel("Resume at reset")).toBeNull();

  // Reshowing the tab revalidates it against the Host.
  const resync = async () => {
    await render(shell(), { visible: false });
    await render();
  };
  await act(async () => byLabel("Dismiss usage limit notice")!.click());
  await resync();
  await vi.waitFor(() => expect(notice()).toBeNull());

  // A later limit from the Host shows again, and Resume sends the continue turn.
  host = { ...host!, revision: host!.revision + 1, session: { ...host!.session, usageLimit: undefined } };
  await resync();
  host = { ...host!, revision: host!.revision + 1, session: { ...host!.session, usageLimit: {} } };
  await resync();
  await vi.waitFor(() => expect(notice()).not.toBeNull());
  const resume = [...container.querySelectorAll<HTMLButtonElement>("[data-usage-limit] button")]
    .find((button) => button.textContent === "Resume")!;
  await act(async () => resume.click());
  await settle();
  expect(commands.at(-1)).toMatchObject({ type: "send", text: "Continue from where you left off." });
});

it.each([false, true])("syncs foreground streams promptly and shares an in-flight read across visibility changes (wait capability: %s)", async (supported) => {
  syncWaitCapability = supported;
  hostConversation(`stream-poll-${supported}`, [{ id: "reply", role: "assistant", text: "Streaming", streaming: true }]);
  host = { ...host!, status: "running", session: { ...host!.session, busy: true } };
  await render();
  let release!: () => void;
  syncDelay = new Promise<void>(resolve => { release = resolve; });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 160)); });
  // Render cost decides whether one or two prompt polls finish before the held one.
  const requests = hostCalls("sessions.sync", host.session.id);
  expect(requests.length).toBeGreaterThanOrEqual(2);
  expect((requests.at(-1)![1] as { params: { waitMs?: number } }).params.waitMs).toBe(supported ? 1_000 : undefined);
  await render(shell(), { visible: false });
  await render();
  expect(hostCalls("sessions.sync", host.session.id)).toHaveLength(requests.length);
  host = { ...host, status: "idle", session: { ...host.session, busy: false } };
  await act(async () => { release(); syncDelay = undefined; });
  await settle();
  expect(hostCalls("sessions.sync", host.session.id)).toHaveLength(requests.length);
});

it("keeps a running background conversation on the slow polling cadence", async () => {
  hostConversation("background-stream-poll", [{ id: "reply", role: "assistant", text: "Streaming", streaming: true }]);
  host = { ...host!, status: "running", session: { ...host!.session, busy: true } };
  await render(shell(), { visible: false });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); });
  expect(hostCalls("sessions.sync", host.session.id)).toHaveLength(1);
});
