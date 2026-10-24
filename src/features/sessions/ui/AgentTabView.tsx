import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AgentTranscript } from "./AgentTranscript";
import { TranscriptFind } from "./TranscriptFind";
import { clearTranscriptJump, peekTranscriptJump, subscribeTranscriptJump } from "../model/transcriptJump";
import { HarnessIcon } from "../../../shared/ui/HarnessIcon";
import { findModel } from "../../../integrations/harness/core/modelCatalog";
import { sessionDisplayTitle } from "../model/session";
import { sessionExecutionCwd } from "../../../domain/session";
import { HARNESS_TITLE } from "../../../contracts/session";
import { type Session } from "../../../contracts/session";
import { createNote } from "../../notes";
import { noteTitle } from "../../../domain/notesText";
import { loadNotesEnabled, subscribeNotesEnabled } from "../../settings/model/settings";
import { hostOrchestrationClient } from "../../orchestration/model/orchestrationClient";
import { loadRemoteSession } from "../../connections/model/connections";
import type { HostSession } from "../../../contracts/protocol";
import { parseRemotePath, remotePath } from "../../connections/model/remoteProjects";

/**
 * One orchestration worker, watched from its lead's workspace.
 *
 * Read-only on purpose: the run belongs to the orchestrator, which decides
 * what each worker is asked and when. A composer here would put a second
 * voice into a conversation the lead is holding, so the way to change course
 * is to say so in the lead's own transcript.
 */
export function AgentTabView({
  title,
  session: initialSession,
  visible,
  focused = visible,
  onOpenFile,
}: {
  title: string;
  session?: Session;
  visible: boolean;
  focused?: boolean;
  onOpenFile?: (path: string) => void;
}) {
  const { t: uiT } = useTranslation();
  const [hostSession, setHostSession] = useState<Session>();
  const session = hostSession?.id === initialSession?.id ? hostSession : initialSession;
  const openFile = useCallback((path: string) => {
    const source = initialSession && hostOrchestrationClient.reference(initialSession.id);
    if (!source || source.project.local || parseRemotePath(path)) return onOpenFile?.(path);
    const cwd = session && parseRemotePath(sessionExecutionCwd(session))?.hostPath;
    const absolute = path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\")
      ? path : `${cwd ?? source.project.cwd}/${path}`;
    onOpenFile?.(remotePath(source.project.environmentId, absolute));
  }, [initialSession?.id, session, onOpenFile]);
  useEffect(() => {
    const source = initialSession && hostOrchestrationClient.reference(initialSession.id);
    if (!source || source.sessionId === source.leadId || !visible) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let known: HostSession | undefined;
    const poll = async () => {
      let active = false;
      try {
        const next = await loadRemoteSession(source.machineId, source.sessionId, known);
        if (disposed || next.projectId !== source.project.projectId || next.session.orchestrationLeadId !== source.leadId) return;
        known = next;
        setHostSession(hostOrchestrationClient.desktopSession(source, next));
        active = next.status === "running";
      } catch { /* Retain readable worker history while disconnected. */ }
      if (!disposed) timer = setTimeout(() => void poll(), active ? 750 : 3_000);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [initialSession?.id, visible]);
  const navigateBlockRef = useRef<
    ((blockId: string | null, query?: string) => boolean) | null
  >(null);
  const [navigatorReady, setNavigatorReady] = useState(false);
  const onNavigateReady = useCallback(
    (navigate: (blockId: string | null, query?: string) => boolean) => {
      navigateBlockRef.current = navigate;
      setNavigatorReady(true);
    },
    [],
  );
  const navigateBlock = useCallback(
    (blockId: string | null, query?: string) =>
      navigateBlockRef.current?.(blockId, query) ?? false,
    [],
  );
  const jumpRequest = useSyncExternalStore(
    subscribeTranscriptJump,
    () => peekTranscriptJump(session?.id ?? ""),
    () => null,
  );
  useEffect(() => {
    if (!visible || !navigatorReady || !session || !jumpRequest) return;
    const frame = requestAnimationFrame(() => {
      if (navigateBlock(jumpRequest.blockId, jumpRequest.query)) {
        clearTranscriptJump(session.id, jumpRequest.token);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, navigatorReady, jumpRequest, navigateBlock, session?.id]);
  const notesEnabled = useSyncExternalStore(
    subscribeNotesEnabled,
    loadNotesEnabled,
    () => true,
  );
  const saveNote = useCallback(
    async (text: string) => {
      if (!session) return;
      const sessionTitle = sessionDisplayTitle(session.title, session.harness);
      await createNote({
        title:
          sessionTitle && sessionTitle !== "New session"
            ? sessionTitle
            : noteTitle(text),
        body: text,
        sourceSessionId: session.id,
        sourceCwd: session.cwd,
      });
    },
    [session?.cwd, session?.harness, session?.id, session?.title],
  );
  const saveSelectionNote = useCallback(
    async (text: string) => {
      if (!session) return;
      await createNote({
        title: noteTitle(text),
        body: text,
        sourceSessionId: session.id,
        sourceCwd: session.cwd,
      });
    },
    [session?.cwd, session?.id],
  );
  if (!session) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <p className="max-w-sm text-[12px] leading-5 text-content/45">
          {uiT(
            "This agent is no longer running. Its work is summarised in the orchestrator's conversation.",
          )}
        </p>
      </div>
    );
  }
  const model = findModel(session.model)?.name ?? session.model;
  return (
    <div data-agent-tab className="flex h-full min-h-0 flex-col">
      <div className="@container relative min-h-0 flex-1">
        <AgentTranscript
          blocks={session.blocks}
          busy={session.busy}
          cwd={sessionExecutionCwd(session)}
          harness={session.harness}
          model={session.model}
          visible={visible}
          onOpenFile={onOpenFile ? openFile : undefined}
          onSaveNote={notesEnabled ? saveNote : undefined}
          onSaveSelectionNote={notesEnabled ? saveSelectionNote : undefined}
          onNavigateReady={onNavigateReady}
          managed
        />
        <TranscriptFind
          blocks={session.blocks}
          visible={visible}
          focused={focused}
          onNavigate={navigateBlock}
        />
      </div>
      <footer className="flex shrink-0 items-center gap-1.5 border-t border-stroke px-3 py-1.5 font-sans text-[11px] text-content/45">
        <HarnessIcon harness={session.harness} className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate" title={title}>
          {model} · {HARNESS_TITLE[session.harness]}
        </span>
        <span className="ml-auto shrink-0">
          {uiT("Run by the orchestrator · read-only")}
        </span>
      </footer>
    </div>
  );
}
