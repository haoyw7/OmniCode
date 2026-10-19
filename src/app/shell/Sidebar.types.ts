import type { ReactNode } from "react";
import type { WorktreeFocus } from "../../features/source-control/model/worktreeFocus";
import type { SidebarTabId } from "../../features/settings/model/appearance";
import type { OpenFileFn } from "../../features/search/model/search";
import type { LinkedWorkItem } from "../../features/sessions/model/session";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import type { SessionReminder } from "../../features/sessions/model/sessionReminders";
import type { PaneEdge } from "../../features/workspace/model/layout";
import type { RecentProject } from "../../features/projects/model/recents";
type SidebarTab = SidebarTabId;

export type SidebarProps = {
  desktopMode?: "chat" | "code";
  modeToggle?: ReactNode;
  headerBrand?: ReactNode;
  headerNavigation?: ReactNode;
  /** The Workflows section (runs and saved workflows), shown in the sessions tab. */
  workflowsSection?: ReactNode;
  cwd: string;
  recents?: RecentProject[];
  projectHistory?: SessionSummary[];
  loadedProjectPaths?: ReadonlySet<string>;
  failedProjectPaths?: ReadonlySet<string>;
  onSelectProject?: (path: string) => void;
  onOpenProject?: () => void;
  onRemoveProject?: (path: string, options: { purgeData: boolean }) => void;
  onOpenNotificationSettings?: (projectPath?: string) => void;
  onLoadProject?: (path: string) => Promise<void>;
  onPrefetchRemoteProject?: (path: string) => Promise<void>;
  onNewInProject?: (path: string) => string | void;
  /** Working copy for Changes / explorer git. Falls back to `cwd`. */
  gitCwd?: string;
  /** Branch identity shown for a worktree whose folder has a temporary name. */
  explorerRootLabel?: string;
  /** Open tabs per worktree path key, for the worktree switcher. */
  worktreeTabStats?: ReadonlyMap<string, { tabs: number; busy: boolean }>;
  onSelectWorkspace?: (focus?: WorktreeFocus) => void;
  workspaceSwitchPending?: boolean;
  workspaceSwitchError?: string;
  open: boolean;
  sessions: SessionSummary[];
  busySessionIds: Set<string>;
  /** Sessions waiting on approvals or questions (also used by status filters). */
  approvalSessionIds: Set<string>;
  /** Question subset, so waiting for an answer is not labeled as an approval. */
  questionSessionIds?: ReadonlySet<string>;
  activeSessionId?: string;
  /** Actually visible conversation; null while another app page covers it. */
  visibleSessionId?: string | null;
  /** Retained live summaries, including blank/background chats; actual tabs
   * are identified separately by openSessionIds. */
  openSessions?: readonly SessionSummary[];
  /** Actual session leaves in this window, excluding retained closed sessions. */
  openSessionIds?: ReadonlySet<string>;
  status: "idle" | "error";
  /** First listing for this project has not arrived yet. */
  pending: boolean;
  /** `newColumn` opens the chat beside the focused column instead of in it. */
  onSelectSession: (
    sessionId: string,
    project?: string,
    opts?: { newColumn?: boolean },
  ) => void;
  onSelectRemoteSession?: (project: string, sessionId: string) => void;
  onRemoteSessionDeleted?: (sessionId: string, project?: string) => void;
  onSessionNavigationOrder?: (ids: readonly string[]) => void;
  onPrefetchSession?: (sessionId: string) => void;
  /**
   * Split a sidebar session onto a pane. `hostProject` is set when
   * `sessionId` is a Host session id that still needs a local shell.
   */
  onPlaceSessionOnPane?: (
    sessionId: string,
    targetId: string,
    edge: PaneEdge,
    hostProject?: string,
  ) => void;
  onRenameSession?: (sessionId: string, title: string) => void;
  onArchiveSession?: (sessionId: string, archived: boolean) => void;
  onArchiveSessions?: (
    sessionIds: readonly string[],
    archived: boolean,
  ) => void;
  onPinSession?: (sessionId: string, pinned: boolean) => void;
  onPinSessions?: (sessionIds: readonly string[], pinned: boolean) => void;
  onSetSessionLinkedWorkItem?: (
    sessionId: string,
    item: LinkedWorkItem | undefined,
  ) => void;
  reminders?: readonly SessionReminder[];
  onSetReminders?: (sessionIds: readonly string[], dueAt: number) => void;
  onCancelReminders?: (sessionIds: readonly string[]) => void;
  onDeleteSession?: (sessionId: string) => void;
  onDeleteSessions?: (sessionIds: readonly string[]) => void;
  onOpenFile: OpenFileFn;
  onOpenTerminal?: (cwd: string) => void;
  onFileMoved?: (from: string, to: string) => void;
  onFileDeleted?: (path: string) => void;
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  filesSearchOpen: boolean;
  onFilesSearchOpenChange: (open: boolean) => void;
  onOpenFilesSearch?: () => void;
  searchFocusToken?: number;
  onNew?: () => string | void;
  /** Starts a projectless chat; its folder is created on the first message. */
  onNewChat?: () => void;
  onToggleSidebar?: () => void;
  chromeInMenuBar?: boolean;
  /** Primary action stays fixed; other destinations scroll with the project tree. */
  navigation?: { primary: ReactNode; scrollable: ReactNode };
  /** Settings, updates and other account rows pinned to the bottom. */
  footer?: ReactNode;
  onOpenInboxItem?: (item: LinkedWorkItem, sessionId: string) => void;
  onGoToFile?: () => void;
  unseenFinishedIds?: Set<string>;
  /** Linked GitHub work changed after the session last advanced. */
  linkedSessionUpdateIds?: ReadonlySet<string>;
};
