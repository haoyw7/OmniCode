import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import { DesktopBotsButton } from "../../features/bots/ui/DesktopBotsButton";
import type { RecentProject } from "../../features/projects/model/recents";
import type { LiveAgent } from "../../features/sessions/model/liveAgents";
import { type Session } from "../../features/sessions/model/session";
import { WorkflowSidebarSection } from "../../features/workflows/ui/WorkflowSidebarSection";
import { HarnessIcon } from "../../features/sessions/ui/HarnessIcon";
import { TerminalSpinner } from "../../features/sessions/ui/TerminalSpinner";
import {
  leafIds,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";
import { SessionSurfaceActions } from "../../features/workspace/ui/SessionSurfaceToolbar";
import { type DesktopMode } from "../model/desktopMode";
import type { InstalledUpdate } from "../model/updateNotice";
import { presentManualUpdatesWith } from "../model/updater";
import { ActivityBar, type ActivityBarProps } from "./ActivityBar";
import { DesktopModeToggle, DesktopNavigation, DesktopNewSessionAction } from "./DesktopNavigation";
import { useUpdateStatus } from "./useUpdateStatus";

type Options = {
  desktopMode: DesktopMode;
  onDesktopModeChange: (mode: DesktopMode) => void;
  activeTab: WorkspaceTab;
  sessions: Session[];
  workspaceVisible: boolean;
  setTabs: Dispatch<SetStateAction<WorkspaceTab[]>>;
  activeAppView:
    | "settings"
    | "search"
    | "inbox"
    | "notes"
    | "automations"
    | "workflows"
    | "assistant"
    | "projects"
    | undefined;
  assistantMachineId: string | undefined;
  onOpenAssistant: (machineId?: string | undefined) => void;
  sidebarCwd: string;
  recents: RecentProject[];
  liveAgents: LiveAgent[];
  active: Session | undefined;
  onSelectLiveAgent: (sessionId: string) => void;
  onGoToFile: () => void;
  onOpenInbox: () => void;
  notesEnabled: boolean;
  onOpenNotes: () => void;
  onOpenSettings: () => void;
  onOpenAutomations: () => void;
  onOpenWorkflows: () => void;
  appPage: "inbox" | "notes" | "automations" | "workflows" | "projects" | null;
  inboxUnseen: boolean;
  onOpenNotificationSettings: (path?: string | undefined) => void;
  updateNotice: InstalledUpdate | null;
  onOpenWhatsNew: (version: string) => void;
  setUpdateNotice: Dispatch<SetStateAction<InstalledUpdate | null>>;
  onNewDesktopSession: () => void;
  openAppView: (
    kind:
      | "settings"
      | "search"
      | "inbox"
      | "notes"
      | "automations"
      | "workflows"
      | "assistant"
      | "projects",
  ) => void;
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
};

export function useWorkspaceChrome({
  desktopMode,
  onDesktopModeChange,
  activeTab,
  sessions,
  workspaceVisible,
  setTabs,
  activeAppView,
  assistantMachineId,
  onOpenAssistant,
  sidebarCwd,
  recents,
  liveAgents,
  active,
  onSelectLiveAgent,
  onGoToFile,
  onOpenInbox,
  notesEnabled,
  onOpenNotes,
  onOpenSettings,
  onOpenAutomations,
  onOpenWorkflows,
  appPage,
  inboxUnseen,
  onOpenNotificationSettings,
  updateNotice,
  onOpenWhatsNew,
  setUpdateNotice,
  onNewDesktopSession,
  openAppView,
  onSelectHistorySession,
}: Options) {
  const desktopModeToggle = (
    <DesktopModeToggle mode={desktopMode} onChange={onDesktopModeChange} />
  );

  // Full/split view reshapes every card of the active chat, so its toggle
  // lives in the window's top bar beside the window controls.
  const activeLeafIds = activeTab ? leafIds(activeTab.layout) : [];

  const activeSessionLeafCount = activeLeafIds.filter((id) =>
    sessions.some((session) => session.id === id),
  ).length;

  const surfaceModeToggle =
    workspaceVisible &&
    activeTab &&
    activeSessionLeafCount === 1 &&
    activeLeafIds.length > 1 ? (
      <SessionSurfaceActions
        mode={activeTab.surfaceMode ?? "split"}
        onModeChange={(surfaceMode) =>
          setTabs((current) =>
            current.map((entry) =>
              entry.id === activeTab.id ? { ...entry, surfaceMode } : entry,
            ),
          )
        }
      />
    ) : null;

  const windowLeading = (
    <DesktopBotsButton
      active={activeAppView === "assistant"}
      selectedMachineId={assistantMachineId}
      onOpen={onOpenAssistant}
    />
  );

  const updateStatus = useUpdateStatus();

  const [manualUpdateOpen, setManualUpdateOpen] = useState(false);

  const setUpdateSnapshot = updateStatus.setSnapshot;

  useEffect(
    () =>
      presentManualUpdatesWith((snapshot) => {
        setUpdateSnapshot(snapshot);
        setManualUpdateOpen(true);
      }),
    [setUpdateSnapshot],
  );

  const activityBarProps = useMemo(
    () =>
      ({
        updateStatus,
        cwd: sidebarCwd,
        recents,
        liveAgents,
        activeSessionId: active?.id,
        onSelectAgent: onSelectLiveAgent,
        onSearch: onGoToFile,
        onOpenInbox,
        onOpenNotes: notesEnabled ? onOpenNotes : undefined,
        onOpenSettings,
        onOpenAutomations,
        onOpenWorkflows,
        searchActive: activeAppView === "search",
        inboxActive: appPage === "inbox",
        notesActive: activeAppView === "notes",
        automationsActive: activeAppView === "automations",
        workflowsActive: activeAppView === "workflows",
        settingsActive: activeAppView === "settings",
        notesEnabled,
        inboxUnseen,
        onOpenNotificationSettings,
        updateNotice,
        onOpenWhatsNew,
        onDismissUpdate: () => setUpdateNotice(null),
      }) satisfies ActivityBarProps,
    [
      updateStatus,
      sidebarCwd,
      recents,
      liveAgents,
      active?.id,
      onSelectLiveAgent,
      onGoToFile,
      onOpenInbox,
      notesEnabled,
      onOpenNotes,
      onOpenSettings,
      onOpenAutomations,
      onOpenWorkflows,
      activeAppView,
      appPage,
      inboxUnseen,
      onOpenNotificationSettings,
      updateNotice,
      onOpenWhatsNew,
    ],
  );

  const sidebarNavigation = {
    primary: <DesktopNewSessionAction mode={desktopMode} onNew={onNewDesktopSession} />,
    scrollable: <DesktopNavigation
      onProjects={() => openAppView("projects")}
      projectsActive={appPage === "projects"}
      onBots={() => onOpenAssistant()}
      botsActive={activeAppView === "assistant"}
      activity={activityBarProps}
    />,
  };

  const titlebarNavigation = null;

  const sidebarFooter = useMemo(
    () => <ActivityBar layout="sidebar-footer" {...activityBarProps} />,
    [activityBarProps],
  );

  const sidebarWorkflows = useMemo(
    () => (
      <WorkflowSidebarSection
        renderHarnessIcon={(harness) => <HarnessIcon harness={harness} />}
        runningIndicator={<TerminalSpinner className="inline-flex size-4 shrink-0 select-none items-center justify-center text-[16px] leading-none text-accent" />}
        activeSessionId={active?.id}
        onOpenSession={(sessionId) => void onSelectHistorySession(sessionId)}
        onOpenWorkflows={onOpenWorkflows}
        workflowsActive={activeAppView === "workflows"}
      />
    ),
    [active?.id, onSelectHistorySession, onOpenWorkflows, activeAppView],
  );
  return {
    desktopModeToggle,
    activityBarProps,
    manualUpdateOpen,
    setManualUpdateOpen,
    sidebarFooter,
    sidebarNavigation,
    sidebarWorkflows,
    surfaceModeToggle,
    titlebarNavigation,
    updateStatus,
    windowLeading,
  };
}
