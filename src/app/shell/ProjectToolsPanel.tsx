import { useTranslation } from "../../shared/i18n/useTranslation";
import { useGitFileStatuses } from "../../features/source-control/hooks/useGitFileStatuses";
import { BranchPicker } from "../../features/source-control/ui/BranchPicker";
import { SidebarWorktreeSwitcher } from "../../features/source-control/ui/SidebarWorktreeSwitcher";
import { FileTree } from "../../features/connections/files/ui/FileTree";
import { ProjectSearch } from "../../features/projects/ui/ProjectSearch";
import { SourceControl } from "../../features/source-control/ui/SourceControl";
import { isRemoteProjectPath } from "../../features/projects/model/recents";
import {
  cachedRemoteSessions,
  remotePendingExecutionCwd,
  remoteSessionFor,
} from "../../features/connections/model/connections";
import {
  parseRemotePath,
  remotePath,
  remoteProjectFor,
} from "../../features/connections/model/remoteProjects";
import type { SidebarProps } from "./Sidebar.types";

export type ProjectToolsPanelProps = Omit<SidebarProps, "tab"> & {
  tab: "files" | "changes";
  showHeader?: boolean;
  contentHeight?: number;
};

export function projectToolsCwd(props: Pick<SidebarProps, "cwd" | "gitCwd" | "activeSessionId">): string {
  const remote = isRemoteProjectPath(props.cwd) || !!remoteProjectFor(props.cwd);
  const project = remote ? remoteProjectFor(props.cwd) : undefined;
  const sessionId = props.activeSessionId ? remoteSessionFor(props.activeSessionId) : undefined;
  const session = cachedRemoteSessions(props.cwd).find((row) => row.id === sessionId);
  const executionCwd = session?.executionCwd ?? session?.cwd
    ?? (props.activeSessionId ? remotePendingExecutionCwd(props.activeSessionId) : undefined)
    ?? (remote && props.gitCwd && props.gitCwd !== props.cwd
      ? (parseRemotePath(props.gitCwd)?.hostPath ?? props.gitCwd)
      : undefined);
  return remote && project && !project.local
    ? remotePath(project.environmentId, executionCwd ?? project.cwd)
    : props.gitCwd || props.cwd;
}

export function ProjectToolsPanel({ showHeader = true, contentHeight, ...props }: ProjectToolsPanelProps) {
  const { t } = useTranslation();
  const gitRoot = projectToolsCwd(props);
  const statuses = useGitFileStatuses(gitRoot, props.open && props.tab === "files");
  if (props.recents !== undefined && (!props.cwd || props.cwd === "~")) {
    return <p className="px-3 py-2 text-[12px] text-content/50">{t("Choose project")}</p>;
  }
  const remote = isRemoteProjectPath(props.cwd) || !!remoteProjectFor(props.cwd);
  return (
    <div data-project-tools-panel={props.tab} data-project-working-copy
      className={`flex min-h-0 min-w-0 flex-1 flex-col ${props.tab === "changes" ? "overflow-y-auto" : "overflow-hidden"}`}
      style={contentHeight === undefined ? undefined : { height: contentHeight, maxHeight: contentHeight }}>
      {showHeader ? (
        <div data-project-tools-context className="flex h-8 shrink-0 items-center gap-1 px-2">
          <BranchPicker cwd={gitRoot} enabled={props.open && !props.workspaceSwitchPending} popoverSide="bottom" />
          {!remote && props.onSelectWorkspace ? <SidebarWorktreeSwitcher
            cwd={props.cwd} compact iconOnly tabStats={props.worktreeTabStats}
            onSelect={props.onSelectWorkspace} pending={props.workspaceSwitchPending}
            switchError={props.workspaceSwitchError} /> : null}
        </div>
      ) : null}
      {props.tab === "files" ? (
        props.filesSearchOpen ? <ProjectSearch cwd={gitRoot} focusToken={props.searchFocusToken}
          onOpenFile={props.onOpenFile} onClose={() => props.onFilesSearchOpenChange(false)} />
          : <FileTree key={gitRoot} cwd={gitRoot} rootLabel={props.explorerRootLabel}
            onOpenFile={props.onOpenFile} onOpenTerminal={isRemoteProjectPath(props.cwd) ? undefined : props.onOpenTerminal}
            onFileMoved={props.onFileMoved} onFileDeleted={props.onFileDeleted}
            onSearch={props.onOpenFilesSearch} gitStatuses={statuses} />
      ) : (
        <div data-project-changes-content
          className={`flex min-h-[480px] shrink-0 flex-col ${props.recents !== undefined ? "flex-1" : ""}`}
          style={contentHeight === undefined ? undefined : { height: Math.max(480, contentHeight) }}>
          <SourceControl cwd={gitRoot} enabled={props.open} textHarness={props.textHarness}
            selectedPath={props.selectedDiffPath} selectedKind={props.selectedDiffKind} selectedSha={props.selectedCommitSha}
            onOpenFile={props.onOpenDiff ?? ((file) => props.onOpenFile(file, undefined, { exact: true }))}
            onOpenAllChanges={props.onOpenAllChanges ?? (() => {})} onOpenCommit={props.onOpenCommit ?? (() => {})} />
        </div>
      )}
    </div>
  );
}
