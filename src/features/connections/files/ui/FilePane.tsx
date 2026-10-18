import { FileExplorerFrame } from "./FileExplorerFrame";
import { IconButton } from "../../../../shared/ui/forms/IconButton";
import type { OpenFileFn } from "../../../search/model/search";
import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { lazySurface } from "../../../../shared/ui/lazySurface";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { memo, useSyncExternalStore } from "react";
import {
  MarkdownViewShell,
  useMarkdownMode,
} from "../../../sessions/ui/MarkdownModeToggle";
import { SurfaceTabs } from "../../../workspace/ui/SurfaceTabs";
import {
  isAgentTab,
  isSubagentTab,
  isWorkflowAgentTab,
  isWorkflowRunTab,
  isAppViewTab,
  isChangesTab,
  isCommitTab,
  isPlanTab,
  isReleaseNotesTab,
  isReviewTab,
  isSessionChangesTab,
  isTerminalTab,
  type EditorPane,
  type FilePaneTab,
} from "../../../workspace/model/layout";
import { isImagePath } from "../model/filePreview";
import type { TerminalMetaPatch } from "../../../terminal/model/terminalTab";
import type { EditorNavigationTarget } from "../../../search/model/search";
import { editorPathsEqual } from "../../../search/model/search";
import type { PlanBuildTarget, Session } from "../../../sessions/model/session";
import { Play, X } from "../../../../shared/ui/icons";
import { BuildTargetButton } from "../../../sessions/ui/SecondOpinionButton";
import {
  loadDiffViewer,
  subscribeDiffViewer,
} from "../../../settings/model/settings";
import { WorkflowAgentTabView, WorkflowRunTabView } from "../../../workflows/ui/WorkflowTabs";
import { AgentTabView } from "../../../sessions/ui/AgentTabView";
import { SubagentTabView } from "../../../sessions/ui/SubagentTabView";
import { MarkdownPreview } from "../../../sessions/ui/AgentMarkdown";
import { BinaryFileView } from "./BinaryFileView";
import { ReleaseNotesSurface } from "../../../../app/ui/ReleaseNotesSurface";
import { isRemoteProjectPath } from "../../../projects/model/recents";
import { AppViewHost } from "../../../workspace/ui/AppViewHost";

const CommitDiff = lazySurface(async () => {
  const module = await import("../../../source-control/ui/CommitDiff");
  return { default: module.CommitDiff };
});
const FileEditor = lazySurface(async () => {
  const module = await import("./FileEditor");
  return { default: module.FileEditor };
});
const SessionChangesDiff = lazySurface(async () => {
  const module = await import("../../../source-control/ui/SessionChangesDiff");
  return { default: module.SessionChangesDiff };
});
const TerminalView = lazySurface(async () => {
  const module = await import("../../../terminal/ui/TerminalView");
  return { default: module.TerminalView };
});
const WorkingTreeDiff = lazySurface(async () => {
  const module = await import("../../../source-control/ui/WorkingTreeDiff");
  return { default: module.WorkingTreeDiff };
});

type Props = {
  pane: EditorPane;
  focused: boolean;
  visible?: boolean;
  /** The title bar already names a standalone file, so avoid repeating it. */
  showTabs?: boolean;
  /** Shell actions attached to this pane's tab row. */
  tabsTrailing?: ReactNode;
  /** Window chrome clearance before the first tab. */
  tabsLeading?: ReactNode;
  dirtyFileIds: Set<string>;
  fileErrorCounts: Map<string, number>;
  sessions: Session[];
  onFocus: (paneId: string) => void;
  onSelectFile: (paneId: string, fileId: string) => void;
  onCloseFile: (paneId: string, fileId: string) => void;
  onCloseOtherFiles: (paneId: string, fileId: string) => void;
  onPinFile?: (fileId: string) => void;
  onDirtyChange: (fileId: string, dirty: boolean) => void;
  onErrorCountChange: (fileId: string, count: number) => void;
  onReorderFiles: (paneId: string, ids: string[]) => void;
  onOpenFile: OpenFileFn;
  onClosePane?: (paneId: string) => void;
  onOpenTerminal?: (cwd: string) => void;
  onFileMoved?: (from: string, to: string) => void;
  onFileDeleted?: (path: string) => void;
  filesSearchOpen?: boolean;
  onFilesSearchOpenChange?: (open: boolean) => void;
  onUpdatePlan: (sessionId: string, blockId: string, text: string) => void;
  onBuildPlan: (
    sessionId: string,
    blockId: string,
    target?: PlanBuildTarget,
  ) => void;
  editorNavigation?: EditorNavigationTarget | null;
  onPaneDragStart?: (event: ReactPointerEvent<HTMLElement>) => void;
  onTerminalMetaChange?: (fileId: string, patch: TerminalMetaPatch) => void;
};

function FilePaneComponent({
  pane,
  focused,
  visible = true,
  showTabs = true,
  tabsTrailing,
  tabsLeading,
  dirtyFileIds,
  fileErrorCounts,
  sessions,
  onFocus,
  onSelectFile,
  onCloseFile,
  onCloseOtherFiles,
  onPinFile,
  onDirtyChange,
  onErrorCountChange,
  onReorderFiles,
  onOpenFile,
  onClosePane,
  onOpenTerminal,
  onFileMoved,
  onFileDeleted,
  filesSearchOpen,
  onFilesSearchOpenChange,
  onUpdatePlan,
  onBuildPlan,
  editorNavigation,
  onPaneDragStart,
  onTerminalMetaChange,
}: Props) {
  const { t } = useTranslation();
  const explorer = pane.files.find((file) => file.explorer);
  const documents = explorer ? pane.files.filter((file) => !file.explorer) : pane.files;
  const diffViewer = useSyncExternalStore(
    subscribeDiffViewer,
    loadDiffViewer,
    loadDiffViewer,
  );
  const activeFile = pane.files.find((file) => file.id === pane.activeFileId);
  const assistantPage = activeFile?.appView?.kind === "assistant";
  const sessionReview =
    activeFile && isSessionChangesTab(activeFile) ? activeFile : undefined;
  const unifiedReview =
    !!activeFile &&
    !sessionReview &&
    (isChangesTab(activeFile) ||
      (diffViewer === "unified" && isReviewTab(activeFile)));
  const commitReview = !!activeFile && isCommitTab(activeFile);

  const renderHeader = (leading?: ReactNode, trailing?: ReactNode, showDocument?: () => void) => (
    !assistantPage && (explorer || showTabs || tabsTrailing) ? (
        <SurfaceTabs
          files={documents}
          activeFileId={pane.activeFileId}
          dirtyFileIds={dirtyFileIds}
          fileErrorCounts={fileErrorCounts}
          onSelectFile={(fileId) => { showDocument?.(); onSelectFile(pane.id, fileId); }}
          onCloseFile={(fileId) => onCloseFile(pane.id, fileId)}
          onCloseOtherFiles={(fileId) => onCloseOtherFiles(pane.id, fileId)}
          onPinFile={onPinFile}
          onReorder={(ids) => onReorderFiles(pane.id, ids)}
          onPaneDragStart={onPaneDragStart}
          leading={<>{tabsLeading}{leading}</>}
          trailing={<>{trailing}{tabsTrailing}{explorer && onClosePane ? <IconButton size="sm" data-file-toolbar-action label={t("Close panel")} onClick={() => onClosePane(pane.id)}><X /></IconButton> : null}</>}
        />
    ) : null
  );

  const content = (
      <div className="relative min-h-0 flex-1">
        {sessionReview ? (
          <div className="absolute inset-0 h-full">
            <SessionChangesDiff
              key={sessionReview.id}
              cwd={sessionReview.cwd}
              sessionId={sessionReview.sessionChanges.sessionId}
              focusPath={sessionReview.path}
            />
          </div>
        ) : commitReview && activeFile?.commit ? (
          <div className="absolute inset-0 h-full">
            <CommitDiff cwd={activeFile.cwd} sha={activeFile.commit.sha} />
          </div>
        ) : unifiedReview && activeFile ? (
          <div className="absolute inset-0 h-full">
            <WorkingTreeDiff
              key={activeFile.id}
              cwd={activeFile.cwd}
              focusPath={activeFile.path}
              focusKind={activeFile.changeKind}
            />
          </div>
        ) : null}
        {pane.files.map((file) => {
          if (
            file.explorer ||
            isCommitTab(file) ||
            isChangesTab(file) ||
            isSessionChangesTab(file) ||
            (unifiedReview && isReviewTab(file))
          )
            return null;
          return (
            <div
              key={file.id}
              aria-hidden={file.id !== pane.activeFileId}
              inert={file.id !== pane.activeFileId}
              className={
                file.id === pane.activeFileId
                  ? "absolute inset-0 h-full"
                  : isTerminalTab(file)
                    ? "absolute inset-0 h-full invisible pointer-events-none"
                    : "hidden"
              }
            >
              {isAppViewTab(file) ? (
                <AppViewHost
                  kind={file.appView.kind}
                  visible={visible && file.id === pane.activeFileId}
                  focused={focused && file.id === pane.activeFileId}
                />
              ) : isWorkflowRunTab(file) ? (
                <WorkflowRunTabView file={file} />
              ) : isWorkflowAgentTab(file) ? (
                <WorkflowAgentTabView
                  file={file}
                  visible={visible && file.id === pane.activeFileId}
                  onOpenFile={onOpenFile}
                />
              ) : isSubagentTab(file) ? (
                <SubagentTabView
                  file={file}
                  session={sessions.find((entry) => entry.id === file.subagent.parentSessionId)}
                  visible={visible && file.id === pane.activeFileId}
                  onOpenFile={onOpenFile}
                />
              ) : isAgentTab(file) ? (
                <AgentTabView
                  title={file.path}
                  session={sessions.find(
                    (entry) => entry.id === file.agent.sessionId,
                  )}
                  visible={visible && file.id === pane.activeFileId}
                  focused={focused && file.id === pane.activeFileId}
                  onOpenFile={onOpenFile}
                />
              ) : isPlanTab(file) ? (
                <PlanSurface
                  file={file}
                  sessions={sessions}
                  onOpenFile={onOpenFile}
                  onUpdatePlan={onUpdatePlan}
                  onBuildPlan={onBuildPlan}
                />
              ) : isReleaseNotesTab(file) ? (
                <ReleaseNotesSurface source={file.releaseNotes} />
              ) : isTerminalTab(file) ? (
                <TerminalView
                  id={file.id}
                  cwd={file.cwd}
                  active={focused && file.id === pane.activeFileId}
                  onMetaChange={(patch) =>
                    onTerminalMetaChange?.(file.id, patch)
                  }
                />
              ) : isImagePath(file.path) ? (
                <BinaryFileView path={file.path} cwd={file.cwd} />
              ) : (
                <FileEditor
                  path={file.path}
                  cwd={file.cwd}
                  showDiff={!!file.review}
                  showPathHeader={!!explorer && file.id === pane.activeFileId}
                  active={focused && file.id === pane.activeFileId}
                  navigation={
                    editorNavigation &&
                    editorPathsEqual(file.path, editorNavigation.path)
                      ? editorNavigation
                      : null
                  }
                  onDirtyChange={(_path, dirty) =>
                    onDirtyChange(file.id, dirty)
                  }
                  onErrorCountChange={(_path, count) =>
                    onErrorCountChange(file.id, count)
                  }
                  onOpenFile={onOpenFile}
                />
              )}
            </div>
          );
        })}
      </div>
  );
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col" onMouseDown={() => onFocus(pane.id)}>
      {explorer ? <FileExplorerFrame key={explorer.cwd} cwd={explorer.cwd} focused={focused} hasDocument={documents.length > 0}
        renderHeader={renderHeader} onOpenFile={onOpenFile} onOpenTerminal={onOpenTerminal} activePath={activeFile?.explorer ? undefined : activeFile?.path} onFileMoved={onFileMoved} onFileDeleted={onFileDeleted}
        searchOpen={filesSearchOpen} onSearchOpenChange={onFilesSearchOpenChange}>{content}</FileExplorerFrame>
        : <>{renderHeader()}{content}</>}
    </div>
  );
}

export const FilePane = memo(FilePaneComponent, (previous, next) => {
  if (
    previous.pane !== next.pane ||
    previous.focused !== next.focused ||
    previous.visible !== next.visible ||
    previous.showTabs !== next.showTabs ||
    previous.tabsTrailing !== next.tabsTrailing ||
    previous.tabsLeading !== next.tabsLeading ||
    previous.dirtyFileIds !== next.dirtyFileIds ||
    previous.fileErrorCounts !== next.fileErrorCounts ||
    previous.onFocus !== next.onFocus ||
    previous.onSelectFile !== next.onSelectFile ||
    previous.onCloseFile !== next.onCloseFile ||
    previous.onCloseOtherFiles !== next.onCloseOtherFiles ||
    previous.onPinFile !== next.onPinFile ||
    previous.onDirtyChange !== next.onDirtyChange ||
    previous.onErrorCountChange !== next.onErrorCountChange ||
    previous.onReorderFiles !== next.onReorderFiles ||
    previous.onClosePane !== next.onClosePane ||
    previous.onOpenTerminal !== next.onOpenTerminal ||
    previous.onFileMoved !== next.onFileMoved ||
    previous.onFileDeleted !== next.onFileDeleted ||
    previous.filesSearchOpen !== next.filesSearchOpen ||
    previous.onFilesSearchOpenChange !== next.onFilesSearchOpenChange ||
    previous.onOpenFile !== next.onOpenFile ||
    previous.onUpdatePlan !== next.onUpdatePlan ||
    previous.onBuildPlan !== next.onBuildPlan ||
    previous.editorNavigation !== next.editorNavigation ||
    Boolean(previous.onPaneDragStart) !== Boolean(next.onPaneDragStart) ||
    previous.onTerminalMetaChange !== next.onTerminalMetaChange
  ) {
    return false;
  }

  for (const file of next.pane.files) {
    // Plans and agent tabs both read a live session object from this pane.
    const sessionId = file.plan?.sessionId ?? file.agent?.sessionId;
    if (!sessionId) continue;
    const before = previous.sessions.find(
      (session) => session.id === sessionId,
    );
    const after = next.sessions.find((session) => session.id === sessionId);
    if (before !== after) return false;
  }
  return true;
});

function PlanSurface({
  file,
  sessions,
  onOpenFile,
  onUpdatePlan,
  onBuildPlan,
}: {
  file: FilePaneTab;
  sessions: Session[];
  onOpenFile: (path: string) => void;
  onUpdatePlan: (sessionId: string, blockId: string, text: string) => void;
  onBuildPlan: (
    sessionId: string,
    blockId: string,
    target?: PlanBuildTarget,
  ) => void;
}) {
  const { t: uiT } = useTranslation();
  const plan = file.plan;
  const [mode, setMode] = useMarkdownMode(file.path);
  const session = plan
    ? sessions.find((entry) => entry.id === plan.sessionId)
    : undefined;
  const block = plan
    ? session?.blocks.find((entry) => entry.id === plan.blockId)
    : undefined;
  const remote = !!session && isRemoteProjectPath(session.cwd);

  if (!block || !plan) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <p className="text-[13px] text-content/70">
          {uiT("This plan is no longer in the session.")}
        </p>
      </div>
    );
  }

  const buildDisabled =
    !!session?.busy ||
    !block.text.trim() ||
    block.plan?.status === "streaming" ||
    block.plan?.status === "building" ||
    block.plan?.status === "built";
  const buildLabel =
    block.plan?.status === "building"
      ? "Building…"
      : block.plan?.status === "built"
        ? "Built"
        : "Build";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <MarkdownViewShell
        mode={mode}
        onModeChange={setMode}
        preview={
          <MarkdownPreview
            text={block.text}
            streaming={block.streaming}
            cwd={file.cwd}
            onOpenFile={onOpenFile}
          />
        }
        actions={
          <div className="flex items-center font-sans">
            <button
              type="button"
              disabled={buildDisabled}
              onClick={() => onBuildPlan(plan.sessionId, block.id)}
              className={`flex h-6 items-center gap-1.5 bg-content px-2.5 font-sans text-[11px] font-medium text-background-base hover:bg-content/90 disabled:cursor-not-allowed disabled:opacity-40 ${
                session ? "rounded-l-md" : "rounded-md"
              }`}
            >
              <Play className="size-3" />
              {buildLabel}
            </button>
            {session && !remote ? (
              <BuildTargetButton
                from={session.harness}
                model={session.model}
                settings={session.modelSettings}
                disabled={buildDisabled}
                onPick={(target) =>
                  onBuildPlan(plan.sessionId, block.id, target)
                }
              />
            ) : null}
          </div>
        }
        source={
          <textarea
            aria-label={uiT("Plan markdown")}
            spellCheck={false}
            value={block.text}
            disabled={
              remote ||
              block.plan?.status === "streaming" ||
              block.plan?.status === "building" ||
              block.plan?.status === "built"
            }
            onChange={(event) =>
              onUpdatePlan(plan.sessionId, block.id, event.currentTarget.value)
            }
            className="h-full w-full resize-none overflow-auto bg-transparent px-5 pb-5 pt-14 font-mono text-[13px] leading-6 text-content outline-none disabled:opacity-70"
          />
        }
      />
    </div>
  );
}
