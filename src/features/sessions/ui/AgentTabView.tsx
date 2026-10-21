import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { errorMessage } from "../../../shared/lib/errorMessage";
import { toast } from "sonner";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AgentTranscript } from "./AgentTranscript";
import { TranscriptFind } from "./TranscriptFind";
import {
  clearTranscriptJump,
  peekTranscriptJump,
  subscribeTranscriptJump,
} from "../model/transcriptJump";
import { HarnessIcon } from "./HarnessIcon";
import { findModel } from "../model/models";
import {
  HARNESS_TITLE,
  sessionDisplayTitle,
  sessionExecutionCwd,
  type Session,
} from "../model/session";
import { createNote, noteTitle } from "../../notes";
import {
  loadNotesEnabled,
  subscribeNotesEnabled,
} from "../../settings/model/settings";
import { hostOrchestrationClient } from "../../orchestration/model/orchestrationClient";
import { workerSessionQuery } from "../../orchestration/model/workerSessionQueries";
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
  const source = initialSession && hostOrchestrationClient.reference(initialSession.id);
  const workerQuery = useQuery({
    ...workerSessionQuery(source),
    enabled: !!source && source.sessionId !== source.leadId && visible,
  }, queryClient);
  const hostSession = useMemo(() => source && workerQuery.data
    ? hostOrchestrationClient.desktopSession(source, workerQuery.data) : undefined,
  [workerQuery.data, source?.machineId, source?.project]);
  const session = hostSession?.id === initialSession?.id ? hostSession : initialSession;
  const openFile = useCallback((path: string) => {
    const source = initialSession && hostOrchestrationClient.reference(initialSession.id);
    if (!source || source.project.local || parseRemotePath(path)) return onOpenFile?.(path);
    const cwd = session && parseRemotePath(sessionExecutionCwd(session))?.hostPath;
    const absolute = path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\")
      ? path : `${cwd ?? source.project.cwd}/${path}`;
    onOpenFile?.(remotePath(source.project.environmentId, absolute));
  }, [initialSession?.id, session, onOpenFile]);
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
  const { mutateAsync: saveNoteRecord } = useMutation({
    mutationFn: createNote,
    onError: (reason) => toast.error(errorMessage(reason)),
  }, queryClient);
  const saveNote = useCallback(
    async (text: string) => {
      if (!session) return;
      const sessionTitle = sessionDisplayTitle(session.title, session.harness);
      await saveNoteRecord({
        title:
          sessionTitle && sessionTitle !== "New session"
            ? sessionTitle
            : noteTitle(text),
        body: text,
        sourceSessionId: session.id,
        sourceCwd: session.cwd,
      });
    },
    [session?.cwd, session?.harness, session?.id, session?.title, saveNoteRecord],
  );
  const saveSelectionNote = useCallback(
    async (text: string) => {
      if (!session) return;
      await saveNoteRecord({
        title: noteTitle(text),
        body: text,
        sourceSessionId: session.id,
        sourceCwd: session.cwd,
      });
    },
    [session?.cwd, session?.id, saveNoteRecord],
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
