import type { SessionPaneProps } from "../../sessions/model/sessionPane";
import type { RemoteSessionProps, RemoteSessionOverrides } from "../model/remoteSessionPresentation";
import { isDefinitiveCommandRejection } from "../../../client/commandOutbox";
import { startHostPolling } from "../../../client/polling";
import { browserLifecycle } from "../../../platform/browserLifecycle";
import { RemoteSnapshotReporter } from "../model/remoteSnapshotReporter";
import { submitHostSession, type HostSubmissionOptions } from "../model/hostSessionSubmission";
import { executionWarningText } from "../../../integrations/harness/core/executionWarnings";
import { sessionComposerConfiguration } from "../../../domain/composerConfiguration";
import { requestedProviderAccountId, supportsProviderAccounts, workBuddyAccountIdForModel } from "../../providers/model/providerAccounts";
import { MessageQueue } from "../../../shared/ui/messaging/MessageQueue";
import { captureQueueReturnPosition, lastQueueUserMessageId } from "../../../domain/messageQueue";
import { CONTINUE_PROMPT } from "../../sessions/model/inFlight";
import { titleStateFor } from "../../../domain/titlePolicy";
import { useHostQueue } from "./useHostQueue";
import { outgoingPlacement, withOutgoing, type OutgoingMessage } from "../model/outgoing";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { ComposerNotice, ComposerNoticeButton } from "../../../shared/ui/ComposerNotice";
import { AlertCircle, Info } from "../../../shared/ui/icons";
import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStableHandlers } from "../../../shared/hooks/useStableHandlers";
import { hostOrchestrationClient } from "../../orchestration/model/orchestrationClient";
import { localizeOrchestrationMessage } from "../../orchestration/model/orchestrationMessages";
import { OrchestrationActions, OrchestrationWorkers, OrchestrationRuntimeContext, type OrchestrationRuntime, type OrchestrationWorkerDetail } from "../../orchestration/model/OrchestrationActions";
import { type OrchestrationProposal, type Attachment, type Block, type ComposerTurnOptions, type HarnessId, type RuntimeMode, type Session, type WorkspaceMode, type PlanBuildTarget, type QueueReturnPosition, type PersistedWorktreeCreation, type WorktreeCreation, type AgentModel, HARNESSES } from "../../../contracts/session";
import { sharedSessionBackend } from "../../sessions/data/sharedSessionBackend";

import { readRemoteQueuedAttachments, uploadRemoteAttachments } from "../model/remoteAttachments";
import { needsRemoteAttachmentPreviews, reuseRemoteAttachmentPreviews } from "../model/remoteAttachmentPreviews";
import { loadRemoteHostCatalog, loadRemoteHostDescriptor } from "../model/remoteHostMetadata";
import { WORKTREE_NAME_ERROR } from "../../../domain/worktreeNaming";
import { anchorWorktreeCreation, appendWorktreeCreationLog, completeWorktreeCreation, failWorktreeCreation, foldWorktreeCreation, persistWorktreeCreation, startWorktreeCreation, WORKTREE_CREATION_FOLD_MS } from "../../../domain/worktreeCreation";

import { fallbackModelName } from "../../../integrations/harness/core/modelCatalog";


import { LOCAL_MODEL_SOURCE, ModelSourceContext, type ModelSource } from "../../sessions/model/modelSource";
import { notifyGitChanged } from "../../../platform/tauri/fs";
import type { Worktree } from "../../../contracts/worktree";
import { useProjectBranchesState } from "../../source-control/hooks/useProjectBranches";
import { registerRemoteSessionActions } from "../model/remoteSessionActions";
import { notifyReviewChanged, registerHostCheckpointRoute } from "../../sessions/model/checkpoint";
import { dispatchRemoteCommand, loadRemoteSession, loadRemoteSessionPreviews, loadRemoteSessionText, OPEN_CONNECTIONS_EVENT, pendingRemoteCommand, rememberRemotePendingExecutionCwd, rememberRemoteSession, REMOTE_HISTORY_CHANGE, remoteRequest, reportRemoteMachineStatus, remotePendingExecutionCwd, remoteSessionFor, useRemoteMachines } from "../model/connections";
import { parseRemotePath, projectPath, remoteProjectFor, ensureSharedProject, type RemoteProject } from "../model/remoteProjects";
import { carryModelSettings, findRemoteModel, remoteModelControls, sameModelSettings } from "../model/remoteModels";
import { isRemoteProvider, type RemoteProvider } from "../../../contracts/provider";
import { type CommandReceipt, type HostCommand, type HostDescriptor, type HostModelCatalog, type HostSession, type HostWorktree, type RemoteAttachment, type RemoteMachine } from "../../../contracts/protocol";


type Configuration = {
  harness: RemoteProvider;
  model: string;
  settings: Record<string, string>;
  mode: RuntimeMode;
};

const sameConfiguration = (a: Configuration, b: Configuration) =>
  a.harness === b.harness &&
  a.model === b.model &&
  a.mode === b.mode &&
  sameModelSettings(a.settings, b.settings);

type OptimisticTurn = {
  queueReturnPosition?: QueueReturnPosition;
  questionAnswer?: ComposerTurnOptions["questionAnswer"];
  refreshTitle?: boolean;
  commandId: string;
  text: string;
  attachments: Attachment[];
  intent: "default" | "plan" | "build" | "orchestrate";
  retryProposalBlockId?: string;
  draft?: boolean;
  draftBlockId?: string;
  planBlockId?: string;
  startedAt: number;
  turnModel: NonNullable<Block["turnModel"]>;
};

const noop = () => {};
const cachedSessionSnapshots = new Map<string, HostSession>();
const cachedDescriptors = new Map<string, HostDescriptor>();
const cachedCatalogs = new Map<string, HostModelCatalog>();
const snapshotKey = (machineId: string, sessionId: string) =>
  `${machineId}:${sessionId}`;
const descriptorKey = (machineId: string, environmentId: string) =>
  JSON.stringify([machineId, environmentId]);
const catalogKey = (machineId: string, environmentId: string, projectId: string) =>
  JSON.stringify([machineId, environmentId, projectId]);
function rememberSessionSnapshot(key: string, snapshot: HostSession) {
  cachedSessionSnapshots.delete(key);
  cachedSessionSnapshots.set(key, snapshot);
  if (cachedSessionSnapshots.size > 8)
    cachedSessionSnapshots.delete(cachedSessionSnapshots.keys().next().value!);
}

const pendingSessionSnapshots = new Map<string, Promise<HostSession>>();

/** Fetches a host conversation into the snapshot cache, so its tab opens with
 * the transcript already laid out, as a local session read from disk does. */
export async function preloadRemoteSession(
  machineId: string,
  sessionId: string,
): Promise<void> {
  const key = snapshotKey(machineId, sessionId);
  if (cachedSessionSnapshots.has(key)) return;
  await pendingSnapshot(key, () => loadRemoteSessionText(machineId, sessionId));
}

/** One full read per conversation: a tab mounting while its press/hover
 * prefetch is still in flight waits for that read instead of starting another. */
function pendingSnapshot(
  key: string,
  load: () => Promise<HostSession>,
): Promise<HostSession> {
  const pending = pendingSessionSnapshots.get(key);
  if (pending) return pending;
  const request = load().then((snapshot) => {
    rememberSessionSnapshot(key, snapshot);
    return snapshot;
  });
  pendingSessionSnapshots.set(key, request);
  const settle = () => {
    if (pendingSessionSnapshots.get(key) === request)
      pendingSessionSnapshots.delete(key);
  };
  void request.then(settle, settle);
  return request;
}

let activeSessionPrefetch: Promise<void> | undefined;

/** Warms a host conversation from a sidebar hover or press. One prefetch runs
 * at a time so sweeping across the list does not queue full transcripts. */
export function prefetchRemoteSession(machineId: string, sessionId: string) {
  const key = snapshotKey(machineId, sessionId);
  if (
    activeSessionPrefetch ||
    cachedSessionSnapshots.has(key) ||
    pendingSessionSnapshots.has(key)
  )
    return;
  const request = preloadRemoteSession(machineId, sessionId).catch(
    () => undefined,
  );
  activeSessionPrefetch = request;
  void request.then(() => {
    if (activeSessionPrefetch === request) activeSessionPrefetch = undefined;
  });
}

/** A tab in a project on another machine. The host owns the session; this
 * renders the normal session pane with actions routed to the host. */
export function RemoteSession({
  shell,
  visible,
  onSnapshot,
  onOpenFile,
  onOpenDiff,
  onOpenPlan,
  render,
  unavailableHeader,
}: RemoteSessionProps) {
  const { t: uiT } = useTranslation();
  const [, refreshProject] = useState(0);
  const [projectError, setProjectError] = useState("");
  const project = remoteProjectFor(shell.cwd);
  useEffect(() => {
    if (!project?.local || project.projectId) return;
    let alive = true;
    void ensureSharedProject(shell.cwd).then(() => {
      if (alive) refreshProject(value => value + 1);
    }, error => { if (alive) setProjectError(String(error)); });
    return () => { alive = false; };
  }, [shell.cwd, project?.local, project?.projectId]);
  const { machines, loaded } = useRemoteMachines(!!project);
  const machine = project
    ? machines.find((entry) => entry.environmentId === project.environmentId)
    : undefined;
  if (!project || !machine || !project.projectId)
    return (
      <>
        {unavailableHeader}
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-[13px] text-content/60">
          {projectError || (!project
            ? uiT(
                "This project’s machine details are missing. Add the project again from the project rail.",
              )
            : loaded
              ? uiT(
                  "The machine for this project isn’t connected on this computer.",
                )
              : uiT("Connecting to the machine…"))}
        </p>
        {project && loaded ? (
          <button
            type="button"
            className="rounded-lg bg-selection px-3 py-1.5 text-[12px] hover:bg-selection-hover"
            onClick={() =>
              window.dispatchEvent(new Event(OPEN_CONNECTIONS_EVENT))
            }
          >
            {uiT("Manage machines")}
          </button>
        ) : null}
      </div>
      </>
    );
  return (
    <ConnectedRemoteSession
      key={`${machine.id}:${shell.id}`}
      shell={shell}
      visible={visible}
      onSnapshot={onSnapshot}
      onOpenFile={onOpenFile}
      onOpenDiff={onOpenDiff}
      onOpenPlan={onOpenPlan}
      machine={machine}
      project={project}
      render={render}
    />
  );
}

function ConnectedRemoteSession({
  shell,
  visible,
  onSnapshot,
  onOpenFile,
  onOpenDiff,
  onOpenPlan,
  machine,
  project,
  render,
}: {
  shell: Session;
  visible: boolean;
  onSnapshot?: (shellId: string, snapshot?: HostSession) => void;
  onOpenFile: SessionPaneProps["onOpenFile"];
  onOpenDiff: SessionPaneProps["onOpenDiff"];
  onOpenPlan: SessionPaneProps["onOpenPlan"];
  machine: RemoteMachine;
  project: RemoteProject;
  render: (overrides: RemoteSessionOverrides) => ReactNode;
}) {
  const { t: uiT } = useTranslation();
  // A native local chat already has a catalog before its first send mounts
  // this Host pane. Keep it until the project-specific Host catalog arrives.
  const fallbackModelSource = project.local && !project.machine ? LOCAL_MODEL_SOURCE : undefined;
  const [descriptor, setDescriptor] = useState<HostDescriptor | undefined>(() =>
    cachedDescriptors.get(descriptorKey(machine.id, machine.environmentId)),
  );
  const parentActions = useContext(OrchestrationActions);
  const parentWorkers = useContext(OrchestrationWorkers);
  const source = useMemo(() => ({ machineId: machine.id, project }), [machine.id, project]);
  const orchestrationEnabled = !!descriptor?.capabilities.includes("sessions.orchestration");
  const handoffEnabled = !!descriptor?.capabilities.includes("sessions.handoff");
  const [proposalEdits, setProposalEdits] = useState<ReadonlyMap<string, { proposal: OrchestrationProposal; revision: number }>>(() => new Map());
  const [online, setOnline] = useState(false);
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState(() => remoteSessionFor(shell.id));
  // A revisit first paints the cached snapshot, then catches up asynchronously.
  // That first successful sync is history even though the pane is visible now.
  const historySyncPending = useRef(!!sessionId);
  const [transcriptHistory, setTranscriptHistory] = useState<HostSession>();
  useEffect(() => {
    if (!visible && sessionId) historySyncPending.current = true;
  }, [visible, sessionId]);
  const boundSession = useRef(sessionId);
  const bindingVersion = useRef(0);
  const deletingSession = useRef<string | undefined>(undefined);
  useEffect(() => {
    const changed = () => {
      const next = remoteSessionFor(shell.id);
      if (next !== boundSession.current) {
        if (boundSession.current) historySyncPending.current = !!next;
        setTranscriptHistory(undefined);
        bindingVersion.current++;
        boundSession.current = next;
        setStarting(undefined);
        setUnseenSend(undefined);
        setChanges(undefined);
        setProposalEdits(new Map());
        applied.current = undefined;
        setError("");
        setRemovingDraft(undefined);
        preparingRef.current = false;
        setSnapshot(
          next
            ? cachedSessionSnapshots.get(snapshotKey(machine.id, next))
            : undefined,
        );
      }
      setPending(
        pendingRemoteCommand(
          project.key,
          machine.environmentId,
          next ?? null,
          shell.id,
        ),
      );
      setSessionId(next);
    };
    window.addEventListener(REMOTE_HISTORY_CHANGE, changed);
    changed();
    return () => window.removeEventListener(REMOTE_HISTORY_CHANGE, changed);
  }, [shell.id, machine.id]);
  const [snapshot, setSnapshot] = useState<HostSession | undefined>(() =>
    sessionId
      ? cachedSessionSnapshots.get(snapshotKey(machine.id, sessionId))
      : undefined,
  );
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const describedHost = useRef<string | undefined>(undefined);
  const [refresh, setRefresh] = useState(0);
  const [catalog, setCatalog] = useState<HostModelCatalog | undefined>(() =>
    cachedCatalogs.get(catalogKey(machine.id, machine.environmentId, project.projectId)),
  );
  const [catalogError, setCatalogError] = useState("");
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [selectedCwd, setSelectedCwd] = useState(
    () => remotePendingExecutionCwd(shell.id) ?? (project.local && shell.executionCwd ? parseRemotePath(shell.executionCwd)?.hostPath ?? shell.executionCwd : undefined) ?? project.cwd,
  );
  const [draftWorkspaceMode, setDraftWorkspaceMode] =
    useState<WorkspaceMode>("current");
  const [draftWorktreeBase, setDraftWorktreeBase] = useState("HEAD");
  // The worktree the first send asked the host to create, shown above that message.
  const [worktreeCreation, setWorktreeCreation] = useState<WorktreeCreation>();
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const preparingRef = useRef(false);
  const [unseenSend, setUnseenSend] = useState<
    Pick<
      OptimisticTurn,
      | "commandId"
      | "text"
      | "startedAt"
      | "turnModel"
      | "attachments"
      | "draftBlockId"
      | "queueReturnPosition"
    > & {
      sessionId: string;
      placement: OutgoingMessage["placement"];
    }
  >();
  // A first message waits here while its session is created on the host.
  const [starting, setStarting] = useState<
    OptimisticTurn & { failed?: boolean }
  >();
  const [pending, setPending] = useState(() =>
    pendingRemoteCommand(
      project.key,
      machine.environmentId,
      sessionId ?? null,
      shell.id,
    ),
  );
  const [draft, setDraft] = useState<Configuration>(() => ({
    harness: isRemoteProvider(shell.harness) ? shell.harness : "codex",
    model: shell.model,
    settings: shell.modelSettings ?? {},
    mode: shell.runtimeMode,
  }));
  const [draftProjectId, setDraftProjectId] = useState(project.projectId);
  if (draftProjectId !== project.projectId) {
    // Folder changes reuse the unsent composer. Reset its project-owned state
    // before rendering children, keeping the input and attachment reads mounted.
    setDraftProjectId(project.projectId);
    setSelectedCwd(project.cwd);
    setDraftWorkspaceMode("current");
    setDraftWorktreeBase("HEAD");
    setWorktreeCreation(undefined);
    setStarting(undefined);
    setError("");
    setDraft({
      harness: isRemoteProvider(shell.harness) ? shell.harness : "codex",
      model: shell.model,
      settings: shell.modelSettings ?? {},
      mode: shell.runtimeMode,
    });
  }
  // Changes to a started session, applied when it is idle.
  const [changes, setChanges] = useState<Configuration>();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setPending(
      pendingRemoteCommand(
        project.key,
        machine.environmentId,
        sessionId ?? null,
        shell.id,
      ),
    );
  }, [project.key, machine.environmentId, sessionId]);

  const hostSession =
    snapshot && snapshot.session.id === sessionId
      ? snapshot.session
      : undefined;
  useEffect(() => {
    if (hostSession) rememberRemotePendingExecutionCwd(shell.id);
  }, [hostSession?.id, shell.id]);
  // Headers and account controls need immediate metadata. The pane owns live
  // text; its workspace copy can coalesce prose without delaying this transcript.
  const snapshotReporter = useMemo(
    () => new RemoteSnapshotReporter((value) => {
      if (boundSession.current === value.session.id && deletingSession.current !== value.session.id)
        onSnapshot?.(shell.id, value);
    }),
    [shell.id, onSnapshot],
  );
  useEffect(() => {
    snapshotReporter.update(hostSession ? snapshot : undefined);
  }, [snapshot, hostSession, snapshotReporter]);
  useEffect(() => () => snapshotReporter.dispose(), [snapshotReporter]);
  const executionCwd = hostSession?.executionCwd || hostSession?.cwd || selectedCwd;
  const { branches } = useProjectBranchesState(
    projectPath(project, executionCwd),
    online,
  );
  const activeSessionId = hostSession?.id ?? sessionId;
  const hasHostBlock = (commandId: string) =>
    !!hostSession?.blocks.some((block) => block.id === commandId || block.id === `queue-send:${commandId}`) ||
    !!hostSession?.queuedMessages?.some((row) => row.id === commandId);
  const unseenActive =
    !!unseenSend &&
    unseenSend.sessionId === activeSessionId &&
    !hasHostBlock(unseenSend.commandId);
  const startingActive =
    !!starting && !starting.failed && !hasHostBlock(starting.commandId);
  const pendingSendActive =
    (pending?.type === "send" || pending?.type === "compact") &&
    pending.sessionId === activeSessionId &&
    !hasHostBlock(pending.commandId);
  const busy =
    !!hostSession?.busy ||
    unseenActive ||
    (startingActive && !starting?.draft) ||
    pendingSendActive;
  // A message the host has not recorded yet shows where it will land: tinted
  // in the transcript, or as a row of the queue of a busy conversation.
  const outgoing: OutgoingMessage | undefined =
    unseenActive && unseenSend
      ? {
          id: unseenSend.commandId,
          text: unseenSend.text,
          attachments: unseenSend.attachments,
          startedAt: unseenSend.startedAt,
          turnModel: unseenSend.turnModel,
          placement: unseenSend.placement,
          queueReturnPosition: unseenSend.queueReturnPosition,
        }
      : pendingSendActive && pending
        ? {
            id: pending.commandId,
            text: pending.type === "send" ? pending.text : "/compact",
            queueReturnPosition: pending.type === "send" ? pending.queueReturnPosition : undefined,
            placement: pending.type === "send"
              ? outgoingPlacement(hostSession && snapshot, pending.followUpBehavior)
              : "transcript",
          }
        : undefined;
  const hostView = useMemo(
    () => (snapshot && hostSession ? withOutgoing(snapshot, outgoing) : snapshot),
    // The outgoing message is rebuilt each render from these fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, hostSession, outgoing?.id, outgoing?.placement, outgoing?.text],
  );
  const viewSession = hostSession && hostView?.session;
  // The Host keeps its limit until the next turn; dismissal is local to this view.
  const usageLimitKey = viewSession?.usageLimit
    ? `${hostSession?.id}:${viewSession.usageLimit.resetsAt ?? ""}`
    : undefined;
  const [dismissedUsageLimit, setDismissedUsageLimit] = useState<string>();
  useEffect(() => {
    if (!usageLimitKey) setDismissedUsageLimit(undefined);
  }, [usageLimitKey]);
  // An accepted turn stays on screen until a sync shows the host's copy, so
  // the transcript never drops it for a moment in between.
  useEffect(() => {
    if (starting && !starting.failed && hasHostBlock(starting.commandId))
      setStarting(undefined);
    if (unseenSend && hasHostBlock(unseenSend.commandId)) setUnseenSend(undefined);
  }, [hostSession, starting, unseenSend]);
  // A draft being removed leaves the transcript at once, as it does locally,
  // and returns if the host turns the removal down.
  const [removingDraft, setRemovingDraft] = useState<string>();
  useEffect(() => {
    if (
      removingDraft &&
      !hostSession?.blocks.some((block) => block.id === removingDraft)
    )
      setRemovingDraft(undefined);
  }, [hostSession, removingDraft]);
  useEffect(() => {
    if (
      unseenSend &&
      hostSession?.id === unseenSend.sessionId &&
      hostSession.blocks.some((block) => block.id === unseenSend.commandId)
    )
      setUnseenSend((current) =>
        current?.commandId === unseenSend.commandId ? undefined : current,
      );
  }, [hostSession, unseenSend]);

  useEffect(() => {
    let disposed = false;
    if (!visible) return;
    let failed = 0;
    const version = bindingVersion.current;
    const stale = () =>
      disposed ||
      version !== bindingVersion.current ||
      (!!sessionId && deletingSession.current === sessionId);
    // Every request carries the expected host identity; describe again only
    // after a failure, when the host may have been replaced. Revealing or
    // hiding a tab keeps the description it already has.
    const hostKey = descriptorKey(machine.id, machine.environmentId);
    let described = describedHost.current === hostKey;
    const poll = async (waitMs?: number) => {
      let active = false;
      try {
        if (!described) {
          const host = await loadRemoteHostDescriptor(machine.id, machine.environmentId);
          if (stale()) return;
          cachedDescriptors.set(hostKey, host);
          // An unchanged description keeps its object, so the pane does not
          // re-render for it.
          setDescriptor((current) =>
            current && JSON.stringify(current) === JSON.stringify(host)
              ? current
              : host,
          );
          described = true;
          describedHost.current = hostKey;
        }
        const known =
          snapshotRef.current?.session.id === sessionId
            ? snapshotRef.current
            : undefined;
        // Text first: image previews download after the transcript is shown.
        let next = sessionId
          ? known
            ? await loadRemoteSessionText(machine.id, sessionId, known,
                waitMs)
            : await pendingSnapshot(
                snapshotKey(machine.id, sessionId),
                () => loadRemoteSessionText(machine.id, sessionId),
              )
          : undefined;
        if (stale()) return;
        if (next && next.projectId !== project.projectId)
          throw new Error("This session belongs to a different host project");
        // Preview downloads can finish while this text request is in flight.
        // Merge against the current snapshot, not only the one sent to sync,
        // or an older response removes a displayed image and downloads it again.
        if (next) next = reuseRemoteAttachmentPreviews(next, snapshotRef.current);
        setOnline(true);
        reportRemoteMachineStatus(machine.id, true);
        // A catalog request that failed while offline is retried on recovery.
        if (failed) setCatalogRefresh((value) => value + 1);
        failed = 0;
        if (next && sessionId)
          rememberSessionSnapshot(snapshotKey(machine.id, sessionId), next);
        if (next && historySyncPending.current) {
          setTranscriptHistory(next);
          if (visible) historySyncPending.current = false;
        }
        setSnapshot(next);
        if (next && sessionId && needsRemoteAttachmentPreviews(next)) {
          const key = snapshotKey(machine.id, sessionId);
          void loadRemoteSessionPreviews(machine.id, next).then((hydrated) => {
            // Hiding the tab restarts this effect; finished downloads still apply.
            if (hydrated === next || version !== bindingVersion.current) return;
            setSnapshot((current) => {
              if (current?.session.id !== hydrated.session.id) return current;
              const merged = reuseRemoteAttachmentPreviews(current, hydrated);
              if (merged !== current) rememberSessionSnapshot(key, merged);
              return merged;
            });
          }, () => undefined);
        }
        if (next) {
          hostOrchestrationClient.bindShell(source, next.session.id, shell.id);
          hostOrchestrationClient.accept(source, next);
        }
        active = !!next?.session.busy || next?.orchestration?.status === "active";
      } catch (reason) {
        if (stale()) return;
        setOnline(false);
        reportRemoteMachineStatus(machine.id, false);
        described = false;
        describedHost.current = undefined;
        failed++;
        throw reason;
      }
      return active;
    };
    const stopPolling = startHostPolling({
      poll,
      supportsWait: () => !!sessionId && !!cachedDescriptors.get(hostKey)?.capabilities.includes("sessions.sync.wait.v1"),
      onError: () => {}, // The pane owns its connection status and descriptor refresh above.
      lifecycle: browserLifecycle,
    });
    return () => {
      disposed = true;
      stopPolling();
    };
  }, [
    machine.id,
    machine.environmentId,
    project.projectId,
    sessionId,
    refresh,
    visible,
    onSnapshot,
  ]);

  useEffect(() => {
    if (!descriptor || descriptor.environmentId !== machine.environmentId) return;
    let disposed = false;
    const applyCatalog = (value: HostModelCatalog) => {
      if (disposed) return;
      cachedCatalogs.set(catalogKey(machine.id, machine.environmentId, project.projectId), value);
      setCatalog(value);
      setCatalogError("");
    };
    void loadRemoteHostCatalog(machine.id, machine.environmentId, project.projectId, applyCatalog)
      .then(applyCatalog)
      .catch((reason) => {
        if (!disposed) {
          setCatalogError(String(reason));
          setCatalog(value => value ? { ...value, pending: [] } : value);
        }
      });
    return () => {
      disposed = true;
    };
  }, [
    machine.id,
    machine.environmentId,
    descriptor?.environmentId,
    project.projectId,
    catalogRefresh,
  ]);

  const providers = useMemo(
    () => (descriptor?.providers ??
      (fallbackModelSource ? HARNESSES.filter(id => fallbackModelSource.available(id)) : [])
    ).filter(isRemoteProvider),
    [descriptor, fallbackModelSource],
  );
  // A new session starts with the tab's model when the host offers it, and
  // otherwise with the host's first model. Settings follow the host's entry:
  // the same id can differ between machines, such as `claude:opus` offering a
  // 1M context only on an account that has it.
  useEffect(() => {
    if (!online || sessionId || !catalog || !providers.length) return;
    const harness = providers.includes(draft.harness)
      ? draft.harness
      : providers[0];
    const models = catalog.models[harness] ?? [];
    const model =
      findRemoteModel(models, draft.model) ??
      (harness === draft.harness ? undefined : models[0]) ??
      models[0];
    if (!model) return;
    setDraft((current) => {
      const settings = carryModelSettings(
        model.settings ?? [],
        current.settings,
      );
      return current.harness === harness &&
        current.model === model.id &&
        sameModelSettings(settings, current.settings)
        ? current
        : { ...current, harness, model: model.id, settings };
    });
  }, [online, catalog, providers, sessionId, draft.harness, draft.model]);

  const composerConfiguration = hostSession && sessionComposerConfiguration(hostSession);
  const saved: Configuration | undefined = composerConfiguration && {
    harness: composerConfiguration.harness as RemoteProvider,
    model: composerConfiguration.model,
    settings: composerConfiguration.modelSettings ?? {},
    mode: composerConfiguration.runtimeMode,
  };
  const configuration = saved ? (changes ?? saved) : draft;
  const updateConfiguration = (
    update: (current: Configuration) => Configuration,
  ) => {
    if (saved) setChanges(update(changes ?? saved));
    else setDraft(update);
  };

  const selectedTurnModel = (): NonNullable<Block["turnModel"]> => ({
    harness: configuration.harness,
    id: configuration.model,
    name:
      findRemoteModel(
        catalog?.models[configuration.harness] ?? [],
        configuration.model,
      )?.name ?? fallbackModelName(configuration.harness, configuration.model),
  });
  const optimisticTurn = (
    text: string,
    attachments: Attachment[] = [],
    intent: "default" | "plan" | "build" | "orchestrate" = "default",
    draft = false,
    draftBlockId?: string,
    planBlockId?: string,
  ): OptimisticTurn => ({
    commandId: crypto.randomUUID(),
    text,
    attachments,
    intent,
    draft,
    draftBlockId,
    planBlockId,
    startedAt: Date.now(),
    turnModel: selectedTurnModel(),
  });

  const run = async (
    command: HostCommand,
    optimistic?: OptimisticTurn,
    followup?: HostCommand,
  ): Promise<CommandReceipt | undefined> => {
    if (sendingRef.current) return undefined;
    const version = bindingVersion.current;
    const commandConfiguration: Configuration | undefined = command.type === "configure"
      ? {
          harness: command.harness ?? saved?.harness ?? configuration.harness,
          model: command.model,
          settings: command.modelSettings,
          mode: command.runtimeMode,
        }
      : undefined;
    sendingRef.current = true;
    setSending(true);
    setError("");
    if (command.type === "send" || command.type === "compact")
      setUnseenSend((current) =>
        current?.commandId === command.commandId
          ? current
          : {
              sessionId: command.sessionId,
              commandId: command.commandId,
              text: command.type === "send" ? command.text : "/compact",
              attachments: optimistic?.attachments ?? [],
              startedAt: optimistic?.startedAt ?? Date.now(),
              turnModel: optimistic?.turnModel ?? selectedTurnModel(),
              draftBlockId:
                command.type === "send" ? command.draftBlockId : undefined,
              queueReturnPosition: command.type === "send" ? command.queueReturnPosition : undefined,
              // Decided as it leaves, so the message never changes places.
              placement: command.type === "send"
                ? outgoingPlacement(
                    snapshotRef.current?.session.id === command.sessionId
                      ? snapshotRef.current
                      : undefined,
                    command.followUpBehavior,
                  )
                : "transcript",
            },
      );
    // Keep the original ID across disconnects and app restarts. An ambiguous
    // response is retried explicitly instead of silently sending a new prompt.
    try {
      setPending(command);
      const receipt = await dispatchRemoteCommand(
        machine.id, project.key, machine.environmentId, command, shell.id, followup, {
          deferFollowup: true,
          onCreated: id => {
            if (!alive.current || version !== bindingVersion.current) return false;
            openSession(id);
            return true;
          },
        },
      );
      if (command.type === "create") {
        if (titleStateFor(shell).source === "manual") {
          await remoteRequest(machine.id, "sessions.update", {
            projectId: project.projectId,
            sessionId: receipt.sessionId,
            title: shell.title,
          });
        }
        if (version === bindingVersion.current) openSession(receipt.sessionId);
      }
      if (!alive.current || version !== bindingVersion.current) return receipt;
      if (commandConfiguration) {
        // Retry receipts need the same protection as the first response: a
        // snapshot may still describe the previous provider for a moment.
        applied.current = commandConfiguration;
      }
      if (command.type === "draft") {
        // Accepted drafts are actionable before the next snapshot arrives.
        setSnapshot((current) => ({
          ...(current?.session.id === command.sessionId
            ? current
            : {
                projectId: project.projectId,
                revision: 0,
                updatedAt: Date.now(),
              }),
          status: "idle",
          session: {
            ...(current?.session.id === command.sessionId
              ? current.session
              : shell),
            id: command.sessionId,
            cwd: selectedCwd,
            harness: hostSession?.harness ?? configuration.harness,
            model: hostSession?.model ?? configuration.model,
            modelSettings: hostSession?.modelSettings ?? configuration.settings,
            runtimeMode: hostSession?.runtimeMode ?? configuration.mode,
            busy: false,
            blocks: [
              ...(current?.session.id === command.sessionId
                ? current.session.blocks
                : []
              ).filter(
                (block) => !block.draft && block.id !== command.commandId,
              ),
              {
                id: command.commandId,
                role: "user",
                text: command.text,
                draft: true,
                attachments: optimistic?.attachments ?? [],
              },
            ],
          },
        }));
        setStarting(undefined);
      }
      setPending(
        pendingRemoteCommand(
          project.key,
          machine.environmentId,
          command.type === "create" ? receipt.sessionId : (sessionId ?? null),
          shell.id,
        ),
      );
      setRefresh((value) => value + 1);
      return receipt;
    } catch (reason) {
      if (!alive.current || version !== bindingVersion.current)
        return undefined;
      const message = String(reason);
      if (isDefinitiveCommandRejection(reason)) {
        if (commandConfiguration) {
          // A definitive refusal must not loop the auto-apply effect. Preserve
          // any newer choice the user made while this request was in flight.
          setChanges(current => current && sameConfiguration(current, commandConfiguration) ? undefined : current);
          setRefresh(value => value + 1);
        }
        if (command.type === "send" || command.type === "compact")
          setUnseenSend((current) =>
            current?.commandId === command.commandId ? undefined : current,
          );
      }
      setPending(pendingRemoteCommand(project.key, machine.environmentId,
        remoteSessionFor(shell.id) ?? sessionId ?? null, shell.id));
      setError(uiT(message.replace(/^Error: /, "").replace(/^Host rejected request: /, "")));
      return undefined;
    } finally {
      sendingRef.current = false;
      if (alive.current) setSending(false);
    }
  };

  const queue = useHostQueue(hostView, async (command, transient) => {
    if (!transient) return run(command);
    const receipt = await remoteRequest<CommandReceipt>(machine.id, "commands.dispatch", command);
    if (alive.current) setRefresh((value) => value + 1);
    return receipt;
  });

  // A conversation that was only a draft goes with it, as a local one does,
  // and the tab starts over as a new conversation.
  const discardSession = async (id: string) => {
    const version = bindingVersion.current;
    deletingSession.current = id;
    try {
      await remoteRequest(machine.id, "sessions.delete", {
        projectId: project.projectId,
        sessionId: id,
      });
      cachedSessionSnapshots.delete(snapshotKey(machine.id, id));
      if (!alive.current || version !== bindingVersion.current) return;
      setSnapshot(undefined);
      rememberRemoteSession(shell.id);
      onSnapshot?.(shell.id, undefined);
    } catch (reason) {
      if (!alive.current || version !== bindingVersion.current) return;
      deletingSession.current = undefined;
      setRefresh((value) => value + 1);
      setRemovingDraft(undefined);
      setError(String(reason).replace(/^Error: /, ""));
    }
  };

  const openSession = (id: string) => {
    if (project.local) {
      sharedSessionBackend()?.rememberSession(id, project.key);
      sharedSessionBackend()?.rememberSession(shell.id, project.key);
    }
    boundSession.current = id;
    rememberRemoteSession(shell.id, id, project);
    setSessionId(id);
  };

  // The Host stages cross-provider choices until send. A running turn keeps
  // its settings; the choice is saved once it finishes.
  const applying = useRef(false);
  // The last change the host accepted, until a sync reflects it.
  const applied = useRef<Configuration>(undefined);
  useEffect(() => {
    if (!changes || !saved || !hostSession) return;
    if (
      sameConfiguration(changes, saved) &&
      !applying.current &&
      (!applied.current || sameConfiguration(applied.current, saved))
    ) {
      applied.current = undefined;
      setChanges(undefined);
      return;
    }
    if (applied.current && sameConfiguration(changes, applied.current)) return;
    if (busy || snapshot?.orchestration?.status === "active" || !online || pending || applying.current) return;
    applying.current = true;
    void run({
      type: "configure",
      commandId: crypto.randomUUID(),
      sessionId: hostSession.id,
      ...(handoffEnabled ? { harness: changes.harness } : {}),
      model: changes.model,
      modelSettings: changes.settings,
      runtimeMode: changes.mode,
    })
      .finally(() => {
        applying.current = false;
      });
  });

  const dispatchTurn = async (
    id: string,
    turn: OptimisticTurn,
    uploaded?: RemoteAttachment[],
  ) => {
    const version = bindingVersion.current;
    const refs = turn.draftBlockId
      ? []
      : (uploaded ??
        (await uploadRemoteAttachments(machine.id, turn.attachments)));
    if (!alive.current || version !== bindingVersion.current) return undefined;
    return run(
      turn.draft
        ? {
            type: "draft",
            commandId: turn.commandId,
            sessionId: id,
            text: turn.text,
            attachments: refs,
          }
        : message(
            id,
            turn.text,
            turn.commandId,
            refs,
            turn.intent,
            turn.draftBlockId,
            turn.planBlockId,
            turn.refreshTitle,
            turn.retryProposalBlockId,
            turn.questionAnswer,
            turn.queueReturnPosition,
          ),
      turn,
    );
  };

  const startSession = async (turn: OptimisticTurn) => {
    const version = bindingVersion.current;
    try {
      const uploaded = await uploadRemoteAttachments(
        machine.id,
        turn.attachments,
      );
      if (version !== bindingVersion.current) return;
      let executionCwd = selectedCwd;
      let persistedCreation: PersistedWorktreeCreation | undefined;
      if (draftWorkspaceMode === "worktree") {
        // The record sits under the first message, which shares the turn's id
        // with the host's copy once the session exists.
        const creationId = crypto.randomUUID();
        setWorktreeCreation(
          anchorWorktreeCreation(
            startWorktreeCreation(draftWorktreeBase, creationId),
            creationId,
            turn.commandId,
          ),
        );
        try {
          const branch = await remoteRequest<string>(machine.id, "git.worktreeName", {
            projectId: project.projectId,
            cwd: selectedCwd,
            harness: draft.harness,
            message: turn.text || turn.attachments.map((file) => file.name).join(", "),
          });
          if (!alive.current || version !== bindingVersion.current) return;
          const tree = await remoteRequest<HostWorktree>(
            machine.id,
            "git.worktreeCreate",
            {
              projectId: project.projectId,
              cwd: selectedCwd,
              branch,
              base: draftWorktreeBase,
              existing: false,
            },
          );
          const finished = completeWorktreeCreation(
            (tree.log ?? []).reduce(
              (next, line) => appendWorktreeCreationLog(next, creationId, line),
              startWorktreeCreation(draftWorktreeBase, creationId),
            ),
            creationId,
            tree.path,
          );
          persistedCreation = persistWorktreeCreation(finished);
          setWorktreeCreation(
            anchorWorktreeCreation(finished, creationId, turn.commandId),
          );
          window.setTimeout(
            () =>
              setWorktreeCreation((current) =>
                current?.id === creationId
                  ? foldWorktreeCreation(current, creationId)
                  : current,
              ),
            WORKTREE_CREATION_FOLD_MS,
          );
          if (version !== bindingVersion.current) return;
          executionCwd = tree.path;
          rememberRemotePendingExecutionCwd(shell.id, tree.path);
          if (alive.current) {
            setSelectedCwd(tree.path);
            setDraftWorkspaceMode("current");
          }
        } catch (reason) {
          const key = String(reason).replace(/^Error: /, "").replace(/^Host rejected request: /, "");
          setWorktreeCreation((current) =>
            current?.id === creationId
              ? failWorktreeCreation(current, creationId, String(reason))
              : current,
          );
          if (alive.current && version === bindingVersion.current) {
            setError(key === WORKTREE_NAME_ERROR ? uiT(key) : String(reason));
            setStarting({ ...turn, failed: true });
          }
          return;
        }
      }
      const followupMessage: Exclude<HostCommand, { type: "create" }> = turn.draft
        ? {
            type: "draft",
            commandId: turn.commandId,
            sessionId: "",
            text: turn.text,
            attachments: uploaded,
          }
        : message(
            "",
            turn.text,
            turn.commandId,
            uploaded,
            turn.intent,
            turn.draftBlockId,
            turn.planBlockId,
            turn.refreshTitle,
            turn.retryProposalBlockId,
          );
      // The first message keeps the worktree it created, so its log survives a reload.
      const followup: Exclude<HostCommand, { type: "create" }> =
        persistedCreation && followupMessage.type === "send"
          ? { ...followupMessage, worktreeCreation: persistedCreation }
          : followupMessage;
      const receipt = await run(
        {
          type: "create",
          commandId: crypto.randomUUID(),
          projectId: project.projectId,
          executionCwd,
          harness: draft.harness,
          model: draft.model,
          modelSettings: draft.settings,
          runtimeMode: draft.mode,
          ...(shell.inboxAsk ? { inboxAsk: shell.inboxAsk } : {}),
          ...(project.local && supportsProviderAccounts(draft.harness)
            ? { providerAccountId: draft.harness === "workbuddy" ? workBuddyAccountIdForModel(draft.model, requestedProviderAccountId(draft.harness, project.cwd)) : (shell.harness === draft.harness ? shell.providerAccountId : undefined) ?? requestedProviderAccountId(draft.harness, project.cwd) }
            : {}),
        },
        turn,
        followup,
      );
      if (version !== bindingVersion.current) return;
      if (!receipt) {
        if (alive.current) setStarting({ ...turn, failed: true });
        return;
      }
      if (version !== bindingVersion.current) return;
      const sent = await run(
        { ...followup, sessionId: receipt.sessionId },
        turn,
      );
      if (alive.current && version === bindingVersion.current)
        if (!sent) setStarting({ ...turn, failed: true });
    } catch (reason) {
      if (alive.current && version === bindingVersion.current) {
        setError(String(reason));
        setStarting({ ...turn, failed: true });
      }
    } finally {
      preparingRef.current = false;
    }
  };

  const message = (
    id: string,
    text: string,
    commandId: string = crypto.randomUUID(),
    attachments: RemoteAttachment[] = [],
    intent: "default" | "plan" | "build" | "orchestrate" = "default",
    draftBlockId?: string,
    planBlockId?: string,
    refreshTitle = false,
    retryProposalBlockId?: string,
    questionAnswer?: ComposerTurnOptions["questionAnswer"],
    queueReturnPosition?: QueueReturnPosition,
  ): Extract<HostCommand, { type: "send" | "compact" }> =>
    text.trim().toLowerCase() === "/compact" &&
    !attachments.length &&
    !draftBlockId &&
    intent === "default"
      ? { type: "compact", commandId, sessionId: id }
      : {
          type: "send",
          commandId,
          sessionId: id,
          text,
          attachments,
          intent,
          ...(draftBlockId ? { draftBlockId } : {}),
          ...(planBlockId ? { planBlockId } : {}),
          ...(refreshTitle ? { refreshTitle: true } : {}),
          ...(retryProposalBlockId ? { retryProposalBlockId } : {}),
          ...(questionAnswer ? { questionAnswer, followUpBehavior: "steer" } : {}),
          ...(queueReturnPosition ? { queueReturnPosition, followUpBehavior: "queue" } : {}),
        };

  const submit = (
    text: string,
    attachments: Attachment[] = [],
    options?: HostSubmissionOptions,
    asDraft = false,
    planBlockId?: string,
  ): boolean => {
    if (shell.inboxAsk && !descriptor?.capabilities.includes("sessions.inbox.v1")) {
      setError(uiT("Update the Host to discuss inbox items in this conversation."));
      return false;
    }
    if (
      !online ||
      sending ||
      preparingRef.current ||
      pending ||
      (busy && (!snapshot?.supportsQueue || asDraft || !!options?.draftBlockId || !!planBlockId)) ||
      (!text.trim() && !attachments.length && !options?.noteCard && !shell.noteCard && !options?.handoffCard && !shell.handoffCard)
    )
      return false;
    const intent =
      options?.intent === "plan" || options?.intent === "build" || options?.intent === "orchestrate"
        ? options.intent
        : "default";
    if (intent === "orchestrate" && !orchestrationEnabled) return false;
    const turn = optimisticTurn(
      text,
      attachments,
      intent,
      asDraft,
      options?.draftBlockId,
      planBlockId,
    );
    turn.refreshTitle = options?.refreshTitle;
    turn.retryProposalBlockId = options?.retryProposalBlockId;
    turn.questionAnswer = options?.questionAnswer;
    turn.queueReturnPosition = options?.queueReturnPosition;
    preparingRef.current = true;
    setStarting(turn);
    // Application-launched turns retain their full context and completion
    // callback even when this pane closes before Host finishes the turn.
    if (!asDraft && (options?.onSettled || options?.managed || options?.ciRepair || options?.ciContext ||
      options?.secondOpinion || options?.noteCard || shell.noteCard || options?.handoffCard || shell.handoffCard ||
      options?.buildTarget || options?.resendEdited || options?.appRequestId || options?.queuedMessageId)) {
      const version = bindingVersion.current;
      const target: Session = { ...(hostSession ?? shell), id: shell.id,
        cwd: projectPath(project, project.cwd), executionCwd: projectPath(project, selectedCwd),
        harness: configuration.harness, model: configuration.model, modelSettings: configuration.settings,
        runtimeMode: configuration.mode, workspaceMode: hostSession ? undefined : draftWorkspaceMode,
        worktreeBase: draftWorktreeBase, inboxAsk: shell.inboxAsk ?? hostSession?.inboxAsk };
      void submitHostSession(target, text, attachments, { ...options, planBlockId: planBlockId ?? options?.planBlockId, commandId: turn.commandId }, next => {
        if (alive.current) { setSnapshot(next); setRefresh(value => value + 1); }
      }).then(accepted => {
        if (!accepted) options?.onSubmissionRejected?.();
      }).catch(reason => {
        options?.onSubmissionRejected?.();
        if (alive.current && (version === bindingVersion.current || remoteSessionFor(shell.id))) {
          setError(String(reason)); setStarting({ ...turn, failed: true });
        }
      }).finally(() => { preparingRef.current = false; });
      return true;
    }
    if (!hostSession) {
      if (sessionId || !draft.model) {
        preparingRef.current = false;
        setStarting(undefined);
        return false;
      }
      void startSession(turn);
      return true;
    }
    if (changes) {
      preparingRef.current = false;
      setStarting(undefined);
      return false;
    }
    const version = bindingVersion.current;
    void dispatchTurn(hostSession.id, turn)
      .then((receipt) => {
        if (alive.current && version === bindingVersion.current)
          if (!receipt) setStarting({ ...turn, failed: true });
      })
      .catch((reason) => {
        if (alive.current && version === bindingVersion.current) {
          setError(String(reason));
          setStarting({ ...turn, failed: true });
        }
      })
      .finally(() => {
        preparingRef.current = false;
      });
    return true;
  };

  const modelSource = useMemo<ModelSource>(() => {
    const models = (harness: HarnessId) =>
      catalog ? catalog.models[harness as RemoteProvider] ?? [] : fallbackModelSource?.modelsFor(harness) ?? [];
    const savedModel = configuration.model;
    const savedSettings = configuration.settings;
    return {
      id: `remote:${machine.environmentId}`,
      modelsFor: models,
      resolve: (harness, id = "") => {
        if (!catalog && fallbackModelSource) return fallbackModelSource.resolve(harness, id);
        const provider = harness as RemoteProvider;
        // Keep the saved model's effort visible even when the host catalog is
        // loading, failed, or no longer lists it.
        const sameHarness = provider === configuration.harness;
        const controls = remoteModelControls(
          catalog,
          provider,
          id,
          sameHarness && id === savedModel ? savedSettings : {},
          sameHarness ? savedModel : undefined,
        );
        const listed = controls.model;
        return {
          ...(listed ?? {
            id,
            harness,
            name: id ? fallbackModelName(harness, id) : "Loading models…",
            nativeId: id.replace(/^[a-z]+:/, ""),
          }),
          settings: controls.settings,
        } satisfies AgentModel;
      },
      find: (id) =>
        providers
          .flatMap((harness) => models(harness))
          .find((m) => m.id === id),
      available: (harness) =>
        providers.includes(harness as RemoteProvider) &&
        (!hostSession || handoffEnabled || hostSession.harness === harness),
      probed: () => !!descriptor || !!fallbackModelSource?.probed(),
      loading: (harness) => !!catalog?.pending?.includes(harness as RemoteProvider) && !models(harness).length,
      // The host re-probes when a provider CLI changes or its catalog ages,
      // so each picker opening asks again.
      refresh: () => setCatalogRefresh((value) => value + 1),
    };
  }, [
    catalog,
    catalogError,
    descriptor,
    fallbackModelSource,
    handoffEnabled,
    hostSession?.harness,
    providers,
    machine.environmentId,
    configuration.harness,
    configuration.model,
    configuration.settings,
  ]);

  const startingExecution = useMemo<Session["executionState"]>(() => {
    // A queued or steering message must not replace the running turn's phase.
    if (hostSession?.busy) return undefined;
    const turn = outgoing?.placement === "transcript"
      ? outgoing
      : startingActive && starting && !starting.draft
        ? { id: starting.commandId, startedAt: starting.startedAt }
        : undefined;
    return turn ? {
      runId: turn.id,
      phase: "starting",
      since: (turn.startedAt ?? Date.now()) + (hostSession ? snapshot?.clockOffsetMs ?? 0 : 0),
    } : undefined;
  }, [
    hostSession, snapshot?.clockOffsetMs, outgoing?.id, outgoing?.placement,
    outgoing?.startedAt, startingActive, starting,
  ]);

  // Show a message the host has not confirmed yet in the transcript.
  // A draft being sent is replaced by its message at once, as locally.
  const leavingDrafts = new Set(
    [
      removingDraft,
      startingActive ? starting?.draftBlockId : undefined,
      pendingSendActive && pending?.type === "send"
        ? pending.draftBlockId
        : undefined,
      unseenActive ? unseenSend?.draftBlockId : undefined,
    ].filter(Boolean),
  );
  const blocks: Block[] = (viewSession?.blocks ?? []).filter(
    (block) => !leavingDrafts.has(block.id),
  );
  // Without the host's conversation yet, an outgoing or first message shows
  // on its own.
  const unconfirmed: Block | undefined =
    outgoing
      ? hostSession
        ? undefined
        : {
            id: outgoing.id,
            role: "user",
            text: outgoing.text,
            sending: true,
            ...(outgoing.attachments?.length ? { attachments: outgoing.attachments } : {}),
            ...(outgoing.startedAt ? { startedAt: outgoing.startedAt } : {}),
            ...(outgoing.turnModel ? { turnModel: outgoing.turnModel } : {}),
          }
      : startingActive && starting
      ? {
          id: starting.commandId,
          role: "user",
          text: starting.text,
          attachments: starting.attachments,
          draft: starting.draft,
          ...(starting.draft ? {} : { sending: true }),
          startedAt: starting.startedAt + (hostSession ? snapshot?.clockOffsetMs ?? 0 : 0),
          turnModel: starting.turnModel,
        }
      : undefined;
  const session: Session = {
    ...(viewSession ?? {
      title: shell.title,
      blocks: [],
    }),
    id: shell.id,
    // The source keeps the discussion in its Inbox portal before the first
    // Host projection arrives, then the Host owns the persisted marker.
    inboxAsk: viewSession?.inboxAsk ?? shell.inboxAsk,
    usageLimit:
      usageLimitKey && usageLimitKey !== dismissedUsageLimit
        ? viewSession?.usageLimit
        : undefined,
    cwd: projectPath(project, project.cwd),
    executionCwd: projectPath(project, executionCwd),
    workspaceMode: hostSession ? undefined : draftWorkspaceMode,
    worktreeBase: hostSession ? undefined : draftWorktreeBase,
    worktreeCreation,
    branch: branches?.current ?? hostSession?.branch,
    harness: hostSession?.harness ?? configuration.harness,
    model: hostSession?.model ?? configuration.model,
    modelSettings: hostSession?.modelSettings ?? configuration.settings,
    runtimeMode: hostSession?.runtimeMode ?? configuration.mode,
    pendingConfiguration: hostSession && (hostSession.pendingConfiguration || changes) ? {
      harness: configuration.harness, model: configuration.model,
      modelSettings: configuration.settings, runtimeMode: configuration.mode,
    } : undefined,
    executionState: startingExecution ?? viewSession?.executionState,
    busy,
    blocks: (unconfirmed ? [...blocks, unconfirmed] : blocks).map(block => {
      const edit = proposalEdits.get(block.id);
      return edit && block.orchestration?.status === "ready" && snapshot?.orchestration?.proposalId !== block.id
        ? { ...block, orchestration: edit.proposal } : block;
    }),
  };

  const catalogProblem = catalog?.errors[configuration.harness] ?? catalogError;
  const retryPending = async () => {
    if (!pending || sendingRef.current) return;
    const version = bindingVersion.current;
    setStarting((current) =>
      current ? { ...current, failed: false } : current,
    );
    const receipt = await run(pending);
    if (
      receipt &&
      pending.type === "create" &&
      version === bindingVersion.current
    ) {
      const next = pendingRemoteCommand(
        project.key,
        machine.environmentId,
        receipt.sessionId,
        shell.id,
      );
      if (next) await run(next);
    }
  };
  const notice =
    pending && !sending
      ? {
          text: uiT("Waiting for the host to confirm your request."),
          detail: error,
          action: { label: "Retry", run: () => void retryPending() },
        }
      : starting?.failed
        ? {
            text: uiT(starting.draft ? "Couldn’t save the draft on {name}." : "Couldn’t send the message on {name}.", { name: machine.name }),
            detail: error,
            action: {
              label: "Try again",
              run: () => {
                const turn = { ...starting, failed: false };
                setStarting(turn);
                preparingRef.current = true;
                if (!sessionId) void startSession(turn);
                else
                  void dispatchTurn(sessionId, turn)
                    .then((sent) => {
                      if (alive.current)
                        if (!sent) setStarting({ ...turn, failed: true });
                    })
                    .catch((reason) => {
                      if (alive.current) {
                        setError(String(reason));
                        setStarting({ ...turn, failed: true });
                      }
                    })
                    .finally(() => {
                      preparingRef.current = false;
                    });
              },
            },
          }
        : error
          ? {
              text: error,
              action: { label: "Dismiss", run: () => setError("") },
            }
          : catalogProblem
            ? {
                text: uiT("Couldn’t load models from {name}.", { name: machine.name }),
                detail: catalogProblem,
                action: {
                  label: "Retry",
                  run: () => setCatalogRefresh((value) => value + 1),
                },
              }
            : undefined;
  const noticeIsError = !!(error || catalogProblem || starting?.failed);

  const selectWorktree = async (tree: Worktree) => {
    const parsed = project.local && !project.machine ? { hostPath: tree.path, environmentId: machine.environmentId, machine: undefined }
      : parseRemotePath(tree.path);
    if (!parsed || parsed.environmentId !== machine.environmentId || parsed.machine?.distribution !== project.machine?.distribution)
      throw new Error("Choose a worktree on this machine");
    if (sessionId)
      throw new Error(
        "This session’s worktree is fixed. Start a new session to use another.",
      );
    if (parsed.hostPath === executionCwd) return;
    rememberRemotePendingExecutionCwd(shell.id, parsed.hostPath);
    setSelectedCwd(parsed.hostPath);
  };

  const buildPlan = (blockId: string, target?: PlanBuildTarget) => {
    const block = hostSession?.blocks.find(
      (entry) => entry.id === blockId && entry.role === "plan",
    );
    if (!block || !block.text.trim() || block.streaming || busy) return;
    submit(
      `Build the approved plan:\n\n${block.text}`,
      [],
      { intent: "build", buildTarget: target },
      false,
      blockId,
    );
  };

  const stopTurn = () => {
    if (snapshot?.orchestration && ["active", "paused"].includes(snapshot.orchestration.status)) {
      void controlRun("stop").catch(reason => setError(String(reason)));
      return;
    }
    if (hostSession?.busy && snapshot?.runId)
      void run({
        type: "cancel",
        commandId: crypto.randomUUID(),
        sessionId: hostSession.id,
        runId: snapshot.runId,
      });
  };
  const approve = (
    requestId: number,
    decision: Parameters<SessionPaneProps["onApproval"]>[2],
  ) => {
    if (!hostSession || !snapshot?.runId) return;
    void run({
      type: "approve",
      commandId: crypto.randomUUID(),
      sessionId: hostSession.id,
      runId: snapshot.runId,
      requestId,
      decision,
    });
  };
  const answer = (
    requestId: number,
    reply: Parameters<SessionPaneProps["onQuestionReply"]>[2],
  ) => {
    if (!hostSession || !snapshot?.runId) return;
    void run({
      type: "answer",
      commandId: crypto.randomUUID(),
      sessionId: hostSession.id,
      runId: snapshot.runId,
      requestId,
      reply,
    });
  };
  const keepQuestionOpen = (requestId: number) => {
    if (!hostSession || !snapshot?.runId || hostSession.harness !== "deepseek") return;
    void run({ type: "keepQuestionOpen", commandId: crypto.randomUUID(),
      sessionId: hostSession.id, runId: snapshot.runId, requestId });
  };
  const compact = () => {
    if (!hostSession || busy || pending || changes || !online) return false;
    void run(message(hostSession.id, "/compact"));
    return true;
  };
  const saveDraft = (text: string, attachments: Attachment[]) =>
    submit(text, attachments, undefined, true);
  const switchAccount = (providerAccountId: string) => {
    const id = hostSession?.id;
    if (!id || !online || !descriptor?.capabilities.includes("sessions.switchAccount"))
      return false;
    if (busy || pending || changes) {
      setError(uiT("Wait for the current turn before switching accounts"));
      return true;
    }
    setError("");
    void remoteRequest(machine.id, "sessions.switchAccount", {
      projectId: project.projectId,
      sessionId: id,
      providerAccountId,
    }).then(
      () => {
        if (alive.current) setRefresh((value) => value + 1);
      },
      (reason) => {
        if (alive.current)
          setError(uiT(String(reason).replace(/^Error: /, "").replace(/^Host rejected request: /, "")));
      },
    );
    return true;
  };

  const refreshOrchestration = async () => {
    const id = hostSession?.id;
    if (!id || !alive.current) return;
    const next = await loadRemoteSession(machine.id, id, snapshotRef.current);
    if (!alive.current || boundSession.current !== id) return;
    snapshotRef.current = next;
    setSnapshot(next);
    hostOrchestrationClient.accept(source, next);
  };
  const controlRun = async (action: "resume" | "stop" | "cancelTask", taskId?: string) => {
    const view = snapshotRef.current?.orchestration;
    if (!view || !online || !orchestrationEnabled || pending)
      throw new Error(uiT("Connect to the Host before controlling this run."));
    const receipt = await run({ type: "orchestration", action, commandId: crypto.randomUUID(),
      projectId: project.projectId, sessionId: view.leadId, orchestrationId: view.id,
      ...(taskId ? { taskId } : {}) });
    if (!receipt) throw new Error(uiT("The Host has not confirmed this request. Retry it before continuing."));
    await refreshOrchestration();
  };
  const runViews = useMemo(() => {
    const view = snapshot?.orchestration;
    if (!view) return [];
    return [{ ...view, cwd: project.key, workspace: view.workspace && {
      ...view.workspace, projectCwd: project.key,
      checkoutCwd: projectPath(project, view.workspace.checkoutCwd),
    } }];
  }, [snapshot?.orchestration, project]);
  const orchestrationRuntime = useMemo<OrchestrationRuntime>(() => ({
    subscribe: hostOrchestrationClient.subscribe,
    snapshot: () => runViews,
    hydrate: async () => undefined,
    resumeBlocker: () => runViews[0]?.resumeBlocker && ({ id: runViews[0].resumeBlocker.sessionId, title: runViews[0].resumeBlocker.title }),
    resumeLeadBusy: () => !!runViews[0]?.resumeLeadBusy,
    resume: () => controlRun("resume"),
    stop: () => controlRun("stop"),
    cancelTask: (_, taskId) => controlRun("cancelTask", taskId),
  }), [runViews, online, orchestrationEnabled, pending, hostSession?.id, sending]);
  const hostWorker = (worker: OrchestrationWorkerDetail): OrchestrationWorkerDetail => ({
    ...worker,
    leadId: shell.id,
    sessionId: hostOrchestrationClient.shellId(source, worker.sessionId),
    host: { ...source, leadId: hostSession?.id ?? worker.leadId, sessionId: worker.sessionId },
  });
  const hostActions = orchestrationEnabled ? {
    open: () => parentActions?.open(shell.id),
    openAgents: (workers: OrchestrationWorkerDetail[]) => parentActions?.openAgents?.(workers.map(hostWorker)),
    update: (_: string, blockId: string, proposal: OrchestrationProposal) => {
      if (!snapshot || busy || pending) return;
      setProposalEdits(current => new Map(current).set(blockId, {
        proposal, revision: current.get(blockId)?.revision ?? snapshot.revision,
      }));
    },
    confirm: async (_: string, blockId: string) => {
      const current = snapshotRef.current;
      if (!current || !online || busy || pending) throw new Error(uiT("Wait for the proposal to finish before confirming."));
      const edit = proposalEdits.get(blockId);
      const receipt = await run({ type: "orchestration", action: "confirmProposal", commandId: crypto.randomUUID(),
        projectId: project.projectId, sessionId: current.session.id, proposalBlockId: blockId,
        expectedRevision: edit?.revision ?? current.revision,
        ...(edit ? { edit: { maxWorkers: edit.proposal.settings.maxWorkers, tasks: edit.proposal.tasks } } : {}),
      });
      if (!receipt) {
        await refreshOrchestration();
        throw new Error(uiT("The Host has not confirmed this request. Retry it before continuing."));
      }
      setProposalEdits(edits => { const next = new Map(edits); next.delete(blockId); return next; });
      await refreshOrchestration();
    },
    retry: (_: string, blockId: string) => {
      const proposal = hostSession?.blocks.find(block => block.id === blockId)?.orchestration;
      if (proposal) submit(proposal.request, [], { intent: "orchestrate", retryProposalBlockId: blockId });
    },
    reload: (_: string, blockId: string) => {
      setProposalEdits(edits => { const next = new Map(edits); next.delete(blockId); return next; });
      setRefresh(value => value + 1);
    },
  } : null;
  useEffect(
    () =>
      registerRemoteSessionActions(shell.id, {
        buildPlan,
        submit: (text, attachments, options) =>
          submit(text, attachments, options),
        saveDraft,
        stop: stopTurn,
        compact,
        approve,
        answer,
        keepQuestionOpen,
        switchAccount,
      }),
    [shell.id, buildPlan, saveDraft, stopTurn, compact, approve, answer, keepQuestionOpen, switchAccount],
  );

  // The Host captures this conversation's edits; review, Keep and Undo run there.
  const checkpointEnabled = !!descriptor?.capabilities.includes("sessions.checkpoint");
  const hostSessionId = hostSession?.id;
  // The review card mounts only once its calls reach the Host, never this
  // computer's store for the same tab id.
  const [checkpointRoute, setCheckpointRoute] = useState<string>();
  useEffect(() => {
    if (!checkpointEnabled || !hostSessionId) return;
    const toWindow = (path: string) =>
      projectPath(project, path);
    const unregister = registerHostCheckpointRoute(shell.id, async <T,>(
      action: "status" | "diff" | "undo" | "keep",
      relative?: string,
      turnId?: string,
    ) => {
      const result = await remoteRequest<{ path?: string; files?: { path: string }[] }>(
        machine.id,
        "sessions.checkpoint",
        { projectId: project.projectId, sessionId: hostSessionId, action,
          ...(turnId ? { turnId } : {}),
          ...(relative === undefined ? {} : { path: relative }) },
      );
      return (result.files
        ? { ...result, files: result.files.map((file) => ({ ...file, path: toWindow(file.path) })) }
        : { ...result, path: toWindow(result.path ?? "") }) as T;
    });
    setCheckpointRoute(hostSessionId);
    return () => {
      unregister();
      setCheckpointRoute(undefined);
    };
  }, [checkpointEnabled, hostSessionId, shell.id, machine.id, machine.environmentId, project.local, project.projectId]);
  const completedTools = hostSession?.blocks.reduce(
    (count, block) =>
      block.role === "tool" && (block.tool?.status === "completed" || block.tool?.status === "success")
        ? count + 1
        : count,
    0,
  ) ?? 0;
  useEffect(() => {
    // Tool completion precedes the final workspace snapshot. Invalidate again
    // at Host settlement, including short turns missed between two polls.
    if (checkpointEnabled && hostSessionId) notifyReviewChanged(shell.id);
  }, [checkpointEnabled, hostSessionId, completedTools, snapshot?.lastCompletedRunId,
    snapshot?.runId, snapshot?.status, shell.id]);

  const hostFilePath = (path: string) => {
    const existing = parseRemotePath(path);
    if (existing) return path;
    const absolute =
      path.startsWith("/") ||
      path.startsWith("\\\\") ||
      /^[A-Za-z]:[\\/]/.test(path)
        ? path
        : `${executionCwd.replace(/[\\/]+$/, "")}/${path.replace(/^\.\//, "")}`;
    return projectPath(project, absolute);
  };

  // Inline callbacks below would be new on every host update; stable
  // forwarders keep the pane and every transcript block memoized.
  const overrides = useStableHandlers<RemoteSessionOverrides>({
    session,
    composerNotice: notice ? (
      <div className="px-2 pb-1.5" data-host-notice>
        <ComposerNotice
          size="compact"
          tone={noticeIsError ? "danger" : "info"}
          role={noticeIsError ? "alert" : "status"}
          icon={noticeIsError ? <AlertCircle className="size-3.5" /> : <Info className="size-3.5" />}
          detail={notice.detail ? localizeOrchestrationMessage(notice.detail, uiT) : undefined}
          actions={notice.action ? (
            <ComposerNoticeButton
              disabled={!online && notice.action.label !== "Dismiss"}
              onClick={notice.action.run}
            >
              {uiT(notice.action.label)}
            </ComposerNoticeButton>
          ) : undefined}
        >
          {localizeOrchestrationMessage(notice.text, uiT)}
        </ComposerNotice>
      </div>
    ) : undefined,
    transcriptHistory: transcriptHistory?.session.id === hostSession?.id
      ? transcriptHistory?.session.blocks
      : undefined,
    clockOffsetMs: hostSession ? snapshot?.clockOffsetMs : undefined,
    messageQueue: { render: (restore) => <MessageQueue
      key={snapshot?.session.id}
      {...queue}
      disabled={!online || sending || !!pending}
      onRestore={async (message) => {
        const id = snapshot?.session.id;
        if (!id) return;
        const version = bindingVersion.current;
        const current = () => alive.current && version === bindingVersion.current;
        const attachments = await readRemoteQueuedAttachments(machine.id, id, message.attachments);
        if (!current()) return;
        const latest = snapshotRef.current?.session;
        const position = latest?.id === id ? captureQueueReturnPosition(
          latest.queuedMessages ?? [], message.id,
          lastQueueUserMessageId(latest.blocks),
        ) : undefined;
        try {
          await queue.onDelete(message.id);
        } catch (reason) {
          const removal = pendingRemoteCommand(project.key, machine.environmentId, id, shell.id);
          if (current() && removal?.type === "queue" && removal.action === "remove" && removal.messageId === message.id)
            restore({ ...message, attachments }, position);
          throw reason;
        }
        if (current()) restore({ ...message, attachments }, position);
      }}
    /> },
    hostManaged: true,
    remoteSession: !project.local,
    hostFeatures: {
      attachments: !!descriptor?.capabilities.includes("attachments.upload"),
      plan: !!descriptor?.capabilities.includes("sessions.plan"),
      draft: !!descriptor?.capabilities.includes("sessions.draft"),
      orchestration: orchestrationEnabled,
      checkpoint: checkpointEnabled && !!hostSessionId && checkpointRoute === hostSessionId,
    },
    hostSessionLoading: !!sessionId && !hostSession && !session.blocks.length,
    hostSessionStarted: !!sessionId,
    allowedModelHarnesses: hostSession
      ? handoffEnabled
        ? [...new Set([hostSession.harness, ...providers])]
        : [hostSession.harness]
      : providers.length
        ? providers
        : ["codex", "claude"],
    onSubmit: (_, text, attachments, options) =>
      submit(text, attachments, options),
    onStop: stopTurn,
    onStopBackgroundTask: descriptor?.capabilities.includes("sessions.stopBackgroundTask") && hostSession && ["claude", "deepseek"].includes(hostSession.harness)
      ? async (_, taskId) => {
          await remoteRequest(machine.id, "sessions.stopBackgroundTask", {
            projectId: project.projectId, sessionId: hostSession.id, taskId,
          });
        }
      : undefined,
    onApproval: (_, requestId, decision) => approve(requestId, decision),
    onQuestionReply: (_, requestId, reply) => answer(requestId, reply),
    onCompactContext: compact,
    onModelChange: (_, harness, model) => {
      if (!isRemoteProvider(harness)) return;
      if (hostSession && !handoffEnabled && harness !== hostSession.harness) return;
      updateConfiguration((current) => ({
        ...current,
        harness,
        model,
        settings: carryModelSettings(
          modelSource.resolve(harness, model).settings ?? [],
          current.settings,
        ),
      }));
    },
    onModelSettingsChange: (_, settings) =>
      updateConfiguration((current) => ({ ...current, settings })),
    onRuntimeModeChange: (_, mode) =>
      updateConfiguration((current) => ({ ...current, mode })),
    onOpenFile: (path) => onOpenFile(hostFilePath(path)),
    // Session reviews keep their scope so the Host answers with this conversation's edits.
    onOpenDiff: (path, review) => review
      ? onOpenDiff(path ? hostFilePath(path) : undefined, review)
      : onOpenDiff(path ? hostFilePath(path) : undefined),
    // Machine-local navigation callbacks are supplied by SessionPane for local Hosts.
    onCwdChange: noop,
    onBranchChange: () => {
      notifyGitChanged();
    },
    onWorktreeChange: (_, tree) => selectWorktree(tree),
    onWorkspaceModeChange: (_, mode, base) => {
      setDraftWorkspaceMode(mode);
      if (base) setDraftWorktreeBase(base);
    },
    onWorktreeBaseChange: (_, base) => setDraftWorktreeBase(base),
    onManageWorktrees: undefined,
    onSaveDraft: (_, text, attachments) => saveDraft(text, attachments),
    onRemoveDraft: (_, draftBlockId) => {
      if (!hostSession || busy || pending || !online || removingDraft)
        return false;
      setRemovingDraft(draftBlockId);
      if (hostSession.blocks.every((block) => block.id === draftBlockId))
        void discardSession(hostSession.id);
      else
        void run({
          type: "removeDraft",
          commandId: crypto.randomUUID(),
          sessionId: hostSession.id,
          draftBlockId,
        }).then((receipt) => {
          if (!receipt && alive.current) setRemovingDraft(undefined);
        });
      return true;
    },
    onDeleteQueuedMessage: (_, id) => queue.onDelete(id),
    onReorderQueuedMessage: (_, id, beforeId) => queue.onReorder(id, beforeId),
    onSteerQueuedMessage: (_, id) => queue.onSteer(id),
    onResumeQueue: () => queue.onResume(),
    onUsageLimitResume: () => {
      if (descriptor?.capabilities.includes("sessions.usageLimit.v1") && hostSession) {
        if (!busy) void run({ type: "usageLimit", action: "resume", commandId: crypto.randomUUID(), sessionId: hostSession.id });
        return;
      }
      if (busy || !submit(CONTINUE_PROMPT)) return;
      setDismissedUsageLimit(usageLimitKey);
    },
    onUsageLimitResumeAtReset: descriptor?.capabilities.includes("sessions.usageLimit.v1") && hostSession
      ? (_, enabled) => { void run({ type: "usageLimit", action: "resumeAtReset", enabled,
        commandId: crypto.randomUUID(), sessionId: hostSession.id }); }
      : undefined,
    onUsageLimitDismiss: () => {
      if (descriptor?.capabilities.includes("sessions.usageLimit.v1") && hostSession)
        void run({ type: "usageLimit", action: "dismiss", commandId: crypto.randomUUID(), sessionId: hostSession.id });
      else setDismissedUsageLimit(usageLimitKey);
    },
    onOpenPlan: (_, blockId) => onOpenPlan(shell.id, blockId),
    onBuildPlan: (_, blockId, target) => buildPlan(blockId, target),
    onSecondOpinion: undefined,
    onHandoff: undefined,
    onBtwSubmit: undefined,
    onBtwRetry: undefined,
    onBtwDelete: undefined,
    onBtwModelChange: undefined,
    onArchiveSession: undefined,
    onDeleteSession: undefined,
    // The Host reports conversations running in the same checkout.
    reviewUndoLocked: false,
  });

  return (
    <ModelSourceContext.Provider value={modelSource}>
      <OrchestrationRuntimeContext.Provider value={orchestrationRuntime}>
      <OrchestrationActions.Provider value={hostActions}>
      <OrchestrationWorkers.Provider value={{ ...parentWorkers,
        selectedId: runViews[0]?.tasks.find(task => hostOrchestrationClient.shellId(source, task.sessionId) === parentWorkers.selectedId)?.sessionId ?? null,
        inspect: id => parentWorkers.inspect(id ? hostOrchestrationClient.shellId(source, id) : null),
        openDetails: parentWorkers.openDetails ? worker => parentWorkers.openDetails?.(hostWorker(worker)) : undefined,
      }}>
      <div data-pane-background-geometry className="relative flex h-full min-h-0 flex-col">
        {snapshot?.executionWarnings?.length ? (
          <div role="status" className="desktop-toolbar shrink-0 border-b border-stroke px-4 py-2 text-[12px] text-content/65">
            {snapshot.executionWarnings.map((warning, index) => <p key={`${index}:${warning}`}>{executionWarningText(warning, uiT)}</p>)}
          </div>
        ) : null}
        <div data-pane-background-geometry className="min-h-0 flex-1">{render(overrides)}</div>
      </div>
      </OrchestrationWorkers.Provider>
      </OrchestrationActions.Provider>
      </OrchestrationRuntimeContext.Provider>
    </ModelSourceContext.Provider>
  );
}
