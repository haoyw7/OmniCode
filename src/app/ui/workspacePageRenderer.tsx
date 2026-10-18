import type { Dispatch, SetStateAction } from "react";
import {
  type Automation,
  type AutomationRun,
} from "../../features/automations/model/automations";
import { DesktopBots } from "../../features/bots/ui/DesktopBots";
import type { CiRepairRequest } from "../../features/inbox/model/ciRepair";
import type { InboxProvider } from "../../features/inbox/model/githubTasks";
import { type InboxItem } from "../../features/inbox/model/githubTasks";
import type { InboxSessionPortal } from "../../features/inbox/ui/InboxDiscussionPanel";
import type { RecentProject } from "../../features/projects/model/recents";
import { ProjectsPage } from "../../features/projects/ui/ProjectsPage";
import { type OpenFileFn } from "../../features/search/model/search";
import { type SessionSummary } from "../../features/sessions/data/sessionStore";
import {
  type LinkedWorkItem,
  type Session,
} from "../../features/sessions/model/session";
import { requestTranscriptJump } from "../../features/sessions/model/transcriptJump";
import { type SettingsSectionId } from "../../features/settings/model/settings";
import { WorkflowsView } from "../../features/workflows/ui/WorkflowsView";
import { type AppViewRenderer } from "../../features/workspace/ui/AppViewHost";
import { type DesktopMode } from "../model/desktopMode";
import {
  AutomationsView,
  InboxView,
  NotesView,
  SearchView,
  SettingsView,
} from "../ui/workspaceSurfaces";

type Options = {
  desktopMode: DesktopMode;
  sidebarCwd: string;
  recents: RecentProject[];
  closeAppPage: () => void;
  onSelectProject: (path: string) => void;
  pickProject: () => Promise<void>;
  onNewChat: () => void;
  onRemoveProject: (path: string, options: { purgeData: boolean }) => void;
  onRestoreProject: (path: string) => void;
  assistantMachineId: string | undefined;
  onSelectHistorySession: (
    sessionId: string,
    project?: string | undefined,
    opts?:
      | {
          newColumn?: boolean | undefined;
          shouldNavigate?: (() => boolean) | undefined;
        }
      | undefined,
  ) => Promise<void>;
  onSelectRemoteSession: (project: string, remoteSessionId: string) => void;
  gitCwd: string;
  projectHistory: SessionSummary[];
  sessions: Session[];
  searchViewFocusToken: number;
  searchQueryRequest: { query: string; token: number } | undefined;
  onLeaveSearch: () => void;
  closeAppDialog: () => void;
  onOpenFile: OpenFileFn;
  onLeaveInbox: () => void;
  onStartInboxItem: (
    item: InboxItem,
    body?: string | undefined,
  ) => Promise<void>;
  onAskInboxItem: (item: InboxItem) => Promise<string>;
  onRestartInboxAsk: (item: InboxItem) => Promise<string>;
  setInboxAskPortal: Dispatch<SetStateAction<InboxSessionPortal | null>>;
  inboxRelatedSessions: SessionSummary[];
  repairSessions: SessionSummary[];
  onRepairChecks: (
    item: InboxItem,
    request: CiRepairRequest,
    sessionId?: string | undefined,
  ) => Promise<void>;
  onOpenInboxSession: (sessionId: string) => void;
  onOpenInboxIntegrations: (source: InboxProvider) => void;
  projectCwd: string;
  onLeaveNotes: () => void;
  onLeaveAutomations: () => void;
  launchAutomation: (
    automation: Automation,
    run: AutomationRun,
    reveal?: boolean,
    prompt?: string,
    sourceWorkItem?: LinkedWorkItem | undefined,
  ) => Promise<void>;
  onOpenAutomationSession: (sessionId: string) => Promise<void>;
  settingsSection: SettingsSectionId;
  settingsAnchor: string | null;
  notificationProjectPath: string | null;
  notificationSettingsRequest: number;
  sidebarHistory: SessionSummary[];
  onRemoveWorktree: (
    cwd: string,
    path: string,
    force: boolean,
    keepSessions?: boolean,
  ) => Promise<void>;
  onCheckWorktreeRemoval: (
    cwd: string,
    path: string,
    force: boolean,
  ) => Promise<void>;
  onDeleteWorktreeSessions: (sessionIds: readonly string[]) => Promise<boolean>;
  onCloseSettings: () => void;
  onSelectSettingsSection: (section: SettingsSectionId) => void;
  onOpenArchivedSession: (sessionId: string) => void;
  onArchiveHistorySession: (
    sessionId: string,
    archived: boolean,
  ) => Promise<boolean>;
  onDeleteHistorySession: (sessionId: string) => Promise<boolean>;
  onOpenWhatsNew: (version: string) => void;
};

export function createWorkspacePageRenderer({
  desktopMode,
  sidebarCwd,
  recents,
  closeAppPage,
  onSelectProject,
  pickProject,
  onNewChat,
  onRemoveProject,
  onRestoreProject,
  assistantMachineId,
  onSelectHistorySession,
  onSelectRemoteSession,
  gitCwd,
  projectHistory,
  sessions,
  searchViewFocusToken,
  searchQueryRequest,
  onLeaveSearch,
  closeAppDialog,
  onOpenFile,
  onLeaveInbox,
  onStartInboxItem,
  onAskInboxItem,
  onRestartInboxAsk,
  setInboxAskPortal,
  inboxRelatedSessions,
  repairSessions,
  onRepairChecks,
  onOpenInboxSession,
  onOpenInboxIntegrations,
  projectCwd,
  onLeaveNotes,
  onLeaveAutomations,
  launchAutomation,
  onOpenAutomationSession,
  settingsSection,
  settingsAnchor,
  notificationProjectPath,
  notificationSettingsRequest,
  sidebarHistory,
  onRemoveWorktree,
  onCheckWorktreeRemoval,
  onDeleteWorktreeSessions,
  onCloseSettings,
  onSelectSettingsSection,
  onOpenArchivedSession,
  onArchiveHistorySession,
  onDeleteHistorySession,
  onOpenWhatsNew,
}: Options) {
  const renderAppView: AppViewRenderer = (kind, active) => {
    switch (kind) {
      case "projects":
        return (
          <ProjectsPage
            mode={desktopMode}
            cwd={sidebarCwd}
            recents={recents}
            onSelect={(path) => {
              closeAppPage();
              onSelectProject(path);
            }}
            onOpen={pickProject}
            onNewChat={onNewChat}
            onArchive={(path) => onRemoveProject(path, { purgeData: false })}
            onRestore={onRestoreProject}
          />
        );
      case "assistant":
        return (
          <DesktopBots
            selectedMachineId={assistantMachineId}
            onLocalSession={onSelectHistorySession}
            onRemoteSession={onSelectRemoteSession}
          />
        );
      case "search":
        return (
          <SearchView
            open={active}
            cwd={gitCwd}
            recents={recents}
            history={projectHistory}
            sessions={sessions.filter((session) => !session.inboxAsk)}
            focusToken={searchViewFocusToken}
            queryRequest={searchQueryRequest}
            onClose={onLeaveSearch}
            onOpenFile={(path) => {
              closeAppDialog();
              onOpenFile(path);
            }}
            onOpenSession={(sessionId, blockId, query) => {
              closeAppDialog();
              if (blockId) requestTranscriptJump(sessionId, blockId, query);
              void onSelectHistorySession(sessionId);
            }}
            onOpenProject={(path) => {
              closeAppDialog();
              onSelectProject(path);
            }}
          />
        );
      case "inbox":
        return (
          <InboxView
            active={active}
            cwd={sidebarCwd}
            recents={recents}
            onClose={onLeaveInbox}
            onStart={(...args: Parameters<typeof onStartInboxItem>) =>
              onStartInboxItem(...args).then(closeAppPage)
            }
            onAsk={onAskInboxItem}
            onAskRestart={onRestartInboxAsk}
            onAskMount={setInboxAskPortal}
            sessions={inboxRelatedSessions}
            repairSessions={repairSessions}
            onRepairChecks={(...args: Parameters<typeof onRepairChecks>) =>
              onRepairChecks(...args).then(closeAppPage)
            }
            onOpenSession={(sessionId: string) => {
              closeAppPage();
              onOpenInboxSession(sessionId);
            }}
            onOpenIntegrations={onOpenInboxIntegrations}
          />
        );
      case "notes":
        return (
          <NotesView
            active={active}
            cwd={projectCwd}
            recents={recents}
            onClose={onLeaveNotes}
          />
        );
      case "automations":
        return (
          <AutomationsView
            active={active}
            cwd={projectCwd}
            recents={recents}
            onClose={onLeaveAutomations}
            onLaunch={(automation, run) => {
              closeAppPage();
              return launchAutomation(automation, run, true);
            }}
            onOpenSession={(
              ...args: Parameters<typeof onOpenAutomationSession>
            ) => {
              closeAppPage();
              return onOpenAutomationSession(...args);
            }}
          />
        );
      case "workflows":
        return <WorkflowsView cwd={projectCwd} />;
      case "settings":
        return (
          <SettingsView
            active={active}
            section={settingsSection}
            anchor={settingsAnchor}
            notificationProjectPath={notificationProjectPath}
            notificationSettingsRequest={notificationSettingsRequest}
            recents={recents}
            cwd={sidebarCwd}
            sessions={sidebarHistory}
            liveSessions={sessions}
            onRemoveWorktree={onRemoveWorktree}
            onCheckWorktreeRemoval={onCheckWorktreeRemoval}
            onDeleteWorktreeSessions={onDeleteWorktreeSessions}
            onClose={onCloseSettings}
            onSelectSection={onSelectSettingsSection}
            onOpenSession={(sessionId: string) => {
              closeAppDialog();
              onOpenArchivedSession(sessionId);
            }}
            onArchiveSession={onArchiveHistorySession}
            onDeleteSession={onDeleteHistorySession}
            onRestoreProject={onRestoreProject}
            onDeleteProject={(path) =>
              onRemoveProject(path, { purgeData: true })
            }
            onOpenWhatsNew={onOpenWhatsNew}
          />
        );
    }
  };
  return renderAppView;
}
