import { startMotionClock, stopMotionClock, finishMotion } from "../../tests/helpers/sharedMotionClock";
// @vitest-environment happy-dom
import { act, createElement, Fragment, StrictMode, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "../../tests/helpers/queryRoot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { SessionPaneProps } from "../features/sessions/ui/SessionPane";
import { sessionComposerConfiguration } from "../features/sessions/model/composerConfiguration";
import { newSession, type Session } from "../features/sessions/model/session";
import { beginComposerAttachmentRead, clearComposerDraft, getComposerDraft, setComposerAttachmentCount, setComposerDraft } from "../features/sessions/model/draftCache";
import { ADD_TO_CHAT_EVENT, type AddToChatRequest } from "../features/sessions/model/quoteDraft";
import {
  newAppViewWorkspaceTab,
  newEditorWorkspaceTab,
  newFileTab,
  newTab,
  newTerminalFile,
  newWorkflowRunTab,
  openEditorTab,
} from "../features/workspace/model/layout";
import type {
  OpenScopedWorkflowActorSessionSideTabRequest,
  WorkflowRunSidePaneTab,
} from "../features/workflows/kit/lib/workspaceSidePane";
import {
  createProjectTerminal,
  type DockSide,
} from "../features/projects/model/projectTerminal";
import { setUiLanguage } from "../shared/i18n/language";
import {
  saveMenuBarVisible,
  saveNotesEnabled,
} from "../features/settings/model/settings";
import { loadSessionSidebarOpen } from "../features/settings/model/appearance";
import { saveProjectSidebarTab } from "../features/settings/model/projectSidebarTab";
import type { GitBranches } from "../platform/tauri/fs";
import { activatePreferenceStore, SharedPreferenceStore, type PreferenceRequest, type PreferenceSnapshot } from "../features/settings/model/sharedPreferences";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  paneRendered: vi.fn(),
  viewMounted: vi.fn(),
  notificationFocus: vi.fn(),
  fileOpen: vi.fn(),
  diffOpen: vi.fn(),
  projectBranches: vi.fn<(cwd: string) => GitBranches | null>(),
  windowMinimize: vi.fn(async () => {}),
  windowMaximize: vi.fn(async () => {}),
  windowClose: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "main",
    onFocusChanged: async () => () => {},
    onCloseRequested: async () => () => {},
    setTitle: async () => {},
    setFocus: async () => {},
    unminimize: async () => {},
    isMaximized: async () => false,
    onResized: async () => () => {},
    minimize: mocks.windowMinimize,
    toggleMaximize: mocks.windowMaximize,
    close: mocks.windowClose,
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(async () => true),
  message: vi.fn(async () => {}),
  open: vi.fn(async () => null),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => {}),
}));
vi.mock("./model/preloadNavigation", () => ({
  preloadNavigationWhenIdle: () => () => {},
}));
vi.mock("./hooks/useIdleSessionDetach", () => ({
  useIdleSessionDetach: () => {},
}));
vi.mock("../features/source-control/hooks/useProjectBranches", () => ({
  useProjectBranches: (cwd: string) => mocks.projectBranches(cwd),
}));
vi.mock("../features/inbox/hooks/useInboxUnseen", () => ({
  useInboxActivity: () => ({
    unseen: false,
    linkedSessionUpdateIds: new Set(),
    linkedSessionUpdates: new Map(),
  }),
}));
vi.mock("../features/notifications/hooks/useInputNotifications", () => ({
  useInputNotifications: (_sessions: Session[], activeId?: string) => mocks.notificationFocus(activeId),
}));
vi.mock("../features/notifications/hooks/useSessionReminders", () => ({
  useSessionReminders: () => ({
    reminders: [],
    due: [],
    error: null,
    schedule: () => {},
    cancel: () => {},
    dismissDue: () => {},
    open: () => {},
    refresh: () => {},
  }),
}));
vi.mock("../features/quick-composer/hooks/useQuickComposerLaunches", () => ({
  useQuickComposerLaunches: () => {},
}));
vi.mock("../features/sessions/data/nativeSessions", async (original) => ({
  ...(await original<
    typeof import("../features/sessions/data/nativeSessions")
  >()),
  installNativeSessionSync: () => () => {},
}));
vi.mock("../integrations/harness", async (original) => ({
  ...(await original<typeof import("../integrations/harness")>()),
  registerBuiltinHarnesses: () => {},
  startHarnessBridge: () => () => {},
  probeHarnessAvailability: async () => {},
  refreshHarnessCatalogs: async () => {},
  stopHarnessTextPrompts: async () => {},
}));
vi.mock("./model/appLifecycle", async (original) => ({
  ...(await original<typeof import("./model/appLifecycle")>()),
  bindResumedSessions: () => {},
}));
vi.mock("../features/connections/files/model/fileIndex", async (original) => ({
  ...(await original<typeof import("../features/connections/files/model/fileIndex")>()),
  prefetchProjectFiles: () => {},
  resolveFileOpenRequest: async (cwd: string, path: string) => {
    return await mocks.fileOpen(cwd, path);
  },
  resolveOpenablePath: async (cwd: string, path: string) =>
    await mocks.diffOpen(cwd, path),
}));

// Keep App's state, command dispatch, workspace model and pane rendering real.
// These shell/view substitutes isolate background services and rich editors.
vi.mock("./shell/MenuBar", async () => {
  const { createElement: el } = await import("react");
  const { loadMenuBarVisible } =
    await import("../features/settings/model/settings");
  const { WindowControls } = await import("./shell/WindowControls");
  return {
    MENU_BAR_HEIGHT: 36,
    MenuBar: ({
      dispatch,
      windowLeading,
      windowActions,
      windowNavigation,
    }: {
      dispatch: (id: string) => void;
      windowLeading?: ReactNode;
      windowActions?: ReactNode;
      windowNavigation?: ReactNode;
    }) =>
      el(
        "nav",
        { "data-menu": true },
        ...[
          "App: Settings",
          "App: Open Project",
          "View: Inbox",
          "View: Notes",
          "View: Automations",
          "View: Workflows",
          "View: Search Everywhere",
          "View: Toggle Changes",
          "App: Find in Files",
          "Pane: Close",
          "Tab: Close All",
          "Session: Next",
          "Terminal: Toggle Dock",
        ].map((id) =>
          el(
            "button",
            { key: id, "data-command": id, onClick: () => dispatch(id) },
            id,
          ),
        ),
        loadMenuBarVisible() ? el("div", { "data-window-leading": true }, windowLeading) : null,
        loadMenuBarVisible() ? windowActions : null,
        loadMenuBarVisible() ? windowNavigation : null,
        loadMenuBarVisible() ? el(WindowControls) : null,
      ),
  };
});
vi.mock("./shell/WindowChrome", async (original) => {
  const { createElement: el } = await import("react");
  return {
    ...(await original<typeof import("./shell/WindowChrome")>()),
    WindowNavigation: () => null,
    WindowNavigationSpace: () => null,
    TitleBar: ({
      tabs,
      activeId,
      onSelect,
    }: {
      tabs: { id: string; files: string[] }[];
      activeId: string;
      onSelect: (id: string) => void;
    }) =>
      el(
        "div",
        { "data-title-bar": true },
        ...tabs.map((tab) =>
          el(
            "button",
            {
              key: tab.id,
              "data-select-tab": tab.id,
              "data-active": String(tab.id === activeId),
              "data-files": tab.files.join("|"),
              onClick: () => onSelect(tab.id),
            },
            tab.id,
          ),
        ),
      ),
  };
});
vi.mock("./shell/Sidebar", async () => {
  const { createElement: el } = await import("react");
  const { SurfaceVisibilityContext } = await import("../shared/ui/SurfaceVisibility");
  return {
    Sidebar: ({
      navigation,
      footer,
      modeToggle,
      headerNavigation,
      open,
      onOpenFile,
      cwd,
      gitCwd,
      projectHistory = [],
      openSessions = [],
      loadedProjectPaths = new Set(),
      failedProjectPaths = new Set(),
      onLoadProject,
      onNewInProject,
      onSelectProject,
      onPinSession,
      onSelectSession,
      onRenameSession,
      onSelectRemoteSession,
      onRemoteSessionDeleted,
      onSessionNavigationOrder,
      onRemoveProject,
      activeSessionId,
      tab,
    }: {
      navigation?: { primary: ReactNode; scrollable: ReactNode };
      footer?: import("react").ReactNode;
      modeToggle?: import("react").ReactNode;
      headerNavigation?: import("react").ReactNode;
      open?: boolean;
      onOpenFile: (
        path: string,
        navigation?: { line: number; column?: number },
      ) => void;
      cwd: string;
      gitCwd: string;
      projectHistory?: { id: string; cwd: string; title: string }[];
      openSessions?: { id: string; cwd?: string }[];
      loadedProjectPaths?: ReadonlySet<string>;
      failedProjectPaths?: ReadonlySet<string>;
      onLoadProject: (cwd: string) => Promise<void>;
      onNewInProject: (cwd: string) => void;
      onSelectProject: (cwd: string) => void;
      onPinSession: (id: string, pinned: boolean) => void;
      onSelectSession: (id: string, cwd?: string) => void;
      onRenameSession: (id: string, title: string) => void;
      onSelectRemoteSession: (cwd: string, id: string) => void;
      onRemoteSessionDeleted: (id: string, cwd?: string) => void;
      onSessionNavigationOrder: (ids: readonly string[]) => void;
      onRemoveProject: (cwd: string, options: { purgeData: boolean }) => void;
      activeSessionId?: string;
      tab?: string;
    }) =>
      el(
        "aside",
        {
          "data-sidebar": cwd,
          "data-git-cwd": gitCwd,
          "data-loaded-projects": [...loadedProjectPaths].join("|"),
          "data-failed-projects": [...failedProjectPaths].join("|"),
          "data-active-session": activeSessionId,
          "data-sidebar-tab": tab,
          "data-open-sessions": openSessions.map((session) => session.id).join("|"),
        },
        open ? (headerNavigation ?? modeToggle) : null,
        navigation?.primary,
        el(SurfaceVisibilityContext.Provider, { value: open ?? true }, navigation?.scrollable),
        footer,
        ...["first", "recent", "replacement"].map((id) =>
          el(
            "button",
            {
              key: `select-${id}`,
              "data-select-session": id,
              onClick: () => onSelectSession(id, openSessions.find(session => session.id === id)?.cwd ?? "/repo"),
            },
            id,
          ),
        ),
        el(
          "button",
          {
            "data-publish-navigation": true,
            onClick: () => onSessionNavigationOrder(["first", "recent"]),
          },
          "Publish navigation",
        ),
        el("button", {
          "data-pin-first": true,
          onClick: () => onPinSession("first", true),
        }, "Pin first"),
        ...["/project-a", "/project-b"].flatMap((path) => [
          el("button", {
            key: `select-project-${path}`,
            "data-select-project": path,
            onClick: () => onSelectProject(path),
          }, "Select project"),
          el(
            "button",
            {
              key: `load-${path}`,
              "data-load-project": path,
              onClick: () => void onLoadProject(path),
            },
            "Load",
          ),
          el(
            "button",
            {
              key: `new-${path}`,
              "data-new-project-session": path,
              onClick: () => onNewInProject(path),
            },
            "New",
          ),
          el(
            "button",
            {
              key: `remove-${path}`,
              "data-remove-project": path,
              onClick: () => onRemoveProject(path, { purgeData: true }),
            },
            "Remove",
          ),
        ]),
        ...["remote://host/project-a", "remote://host/project-b"].flatMap(
          (path) => [
            el(
              "button",
              {
                key: `remote-${path}`,
                "data-open-remote-project": path,
                onClick: () => onSelectRemoteSession(path, "shared-id"),
              },
              "Open remote",
            ),
            el(
              "button",
              {
                key: `delete-${path}`,
                "data-delete-remote-project": path,
                onClick: () => onRemoteSessionDeleted("shared-id", path),
              },
              "Delete remote",
            ),
          ],
        ),
        ...projectHistory.map((row) =>
          el(
            "div",
            {
              key: row.id,
              "data-history-project": row.cwd,
              "data-history-title": row.title,
            },
            el(
              "button",
              {
                "data-open-history": row.id,
                onClick: () => onSelectSession(row.id, row.cwd),
              },
              row.title,
            ),
            el(
              "button",
              {
                "data-rename-history": row.id,
                onClick: () => onRenameSession(row.id, "Renamed"),
              },
              "Rename",
            ),
          ),
        ),
        el(
          "button",
          {
            "data-open-file": true,
            onClick: () => onOpenFile("/repo/file.ts"),
          },
          "Open file",
        ),
        ...[10, 20].map((line) =>
          el(
            "button",
            {
              key: `file-line-${line}`,
              "data-open-file-line": line,
              onClick: () => onOpenFile("/repo/file.ts", { line, column: 2 }),
            },
            `Open file at line ${line}`,
          ),
        ),
      ),
  };
});
vi.mock("./shell/ProjectToolsPanel", async () => {
  const { createElement: el } = await import("react");
  return {
    ProjectToolsPanel: ({ tab, cwd }: { tab: string; cwd: string }) => el("div", { "data-tools-panel": tab, "data-tools-cwd": cwd }),
  };
});
vi.mock("./shell/ActivityBar", async () => {
  const { createElement: el } = await import("react");
  return {
    ActivityBar: ({
      layout,
      onOpenSettings,
      onOpenNotes,
    }: {
      layout?: string;
      onOpenSettings: () => void;
      onOpenNotes?: () => void;
    }) =>
      el(
        "div",
        { "data-activity-bar": layout },
        el(
          "button",
          { "data-open-settings": true, onClick: onOpenSettings },
          "Settings",
        ),
        el(
          "button",
          { "data-open-notes": true, onClick: onOpenNotes },
          "Notes",
        ),
      ),
  };
});
vi.mock("../features/terminal/ui/ProjectTerminalDock", async () => {
  const { createElement: el } = await import("react");
  const { useSurfaceVisibility } =
    await import("../shared/ui/SurfaceVisibility");
  return {
    ProjectTerminalDock: ({
      onHide,
      onSizePaint,
      onSizeCommit,
    }: {
      onHide: () => void;
      onSizePaint: (size: number) => void;
      onSizeCommit: (size: number) => void;
    }) =>
      el(
        "div",
        {
          "data-terminal-dock": true,
          "data-visible": useSurfaceVisibility(),
        },
        "Terminal",
        el("button", { "data-terminal-hide": true, onClick: onHide }, "Hide"),
        el(
          "button",
          { "data-terminal-paint": true, onClick: () => onSizePaint(280) },
          "Resize",
        ),
        el(
          "button",
          { "data-terminal-commit": true, onClick: () => onSizeCommit(280) },
          "Commit",
        ),
      ),
  };
});
vi.mock("../features/sessions/ui/SessionPane", async () => {
  const { createElement: el } = await import("react");
  const { useSurfaceVisibility } = await import("../shared/ui/SurfaceVisibility");
  return {
    SessionPane: ({
      session,
      composerFocused,
      visible,
      onClose,
      onOpenDiff,
      onOpenBot,
      renderHeader,
      onModelChange,
      onModelSettingsChange,
      onRuntimeModeChange,
      onForkSession,
      onCwdChange,
      onSubmit,
    }: {
      session: Session;
      composerFocused: boolean;
      visible: boolean;
      onClose: (sessionId: string) => void;
      onOpenDiff: (path: string, session: { sessionId: string; cwd: string }) => void;
      onOpenBot: SessionPaneProps["onOpenBot"];
      renderHeader?: (session: Session) => ReactNode;
      onModelChange: SessionPaneProps["onModelChange"];
      onModelSettingsChange: SessionPaneProps["onModelSettingsChange"];
      onRuntimeModeChange: SessionPaneProps["onRuntimeModeChange"];
      onForkSession: SessionPaneProps["onForkSession"];
      onCwdChange: SessionPaneProps["onCwdChange"];
      onSubmit: SessionPaneProps["onSubmit"];
    }) => {
      mocks.paneRendered({ session, onModelChange, onModelSettingsChange, onRuntimeModeChange, onForkSession, onCwdChange, onSubmit, onOpenBot });
      return el(
        "div",
        {
          "data-session": session.id,
          "data-visible": visible,
          "data-surface-visible": useSurfaceVisibility(),
          "data-session-cwd": session.cwd,
          "data-session-block-count": session.blocks.length,
          "data-session-worktree": session.executionCwd,
          "data-session-branch": session.branch,
          "data-composer-focused": composerFocused,
        },
        renderHeader?.(session),
        el(
          "button",
          {
            "data-open-session-diff": session.id,
            onClick: () => onOpenDiff("file.ts", { sessionId: session.id, cwd: session.cwd }),
          },
          "Open session diff",
        ),
        el(
          "button",
          {
            "data-close-session": session.id,
            onClick: () => onClose(session.id),
          },
          "Close chat",
        ),
      );
    },
  };
});
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("../features/connections/files/ui/FileEditor", async () => {
  const { createElement: el } = await import("react");
  return {
    FileEditor: ({
      path,
      cwd,
      showDiff,
      active,
      navigation,
    }: {
      path: string;
      cwd: string;
      showDiff: boolean;
      active: boolean;
      navigation?: { line: number; column?: number } | null;
    }) =>
      el("div", {
        "data-file-editor": path,
        "data-file-cwd": cwd,
        "data-file-diff": showDiff,
        "data-file-active": active,
        "data-file-navigation-line": navigation?.line,
        "data-file-navigation-column": navigation?.column,
      }),
  };
});
vi.mock("../features/source-control/ui/WorkingTreeDiff", async () => {
  const { createElement: el } = await import("react");
  return {
    WorkingTreeDiff: ({ cwd, sessionId, focusPath }: { cwd: string; sessionId?: string; focusPath?: string }) =>
      el("div", sessionId ? { "data-session-diff-path": focusPath } : { "data-diff-cwd": cwd }),
  };
});
vi.mock("../features/bots/ui/DesktopBots", async () => {
  const { createElement: el } = await import("react");
  return {
    DesktopBots: ({ selectedMachineId }: { selectedMachineId?: string }) =>
      el(
        "section",
        { "data-app-view": "assistant", "data-bots-machine": selectedMachineId },
        el("textarea", { "aria-label": "Assistant draft" }),
      ),
  };
});

vi.mock("../features/workflows/ui/WorkflowsView", async () => {
  const { createElement: el } = await import("react");
  const { AppPageHeader } = await import("../features/workspace/ui/AppPageHeader");
  const { Workflow } = await import("../shared/ui/icons");
  const { useWorkflowApp } = await import("../features/workflows/ui/workflowAppContext");
  return {
    WorkflowsView: () => {
      const app = useWorkflowApp();
      return el("section", { "data-app-view": "workflows" },
        el(AppPageHeader, { title: "Workflows", icon: Workflow }),
        ...["/repo", "/project-b"].map((cwd) => el("button", {
          key: cwd,
          "data-create-workflow": cwd,
          onClick: () => app?.createViaChat(cwd, "Help me design a workflow"),
        }, "Create in chat")),
      );
    },
  };
});

vi.mock("../features/workflows/kit/app-shell/WorkflowRunSidePane", async () => {
  const { createElement: el } = await import("react");
  return {
    WorkflowRunSidePane: ({ tab, onOpenWorkflowActorSession }: {
      tab: WorkflowRunSidePaneTab;
      onOpenWorkflowActorSession?: (request: OpenScopedWorkflowActorSessionSideTabRequest) => void;
    }) => el("div", {}, ...["worker-a", "worker-b"].map((sessionId) =>
      el("button", {
        key: sessionId,
        "data-open-workflow-agent": sessionId,
        onClick: () => onOpenWorkflowActorSession?.({
          workspacePath: tab.workspacePath,
          parentSessionId: tab.parentSessionId,
          runId: tab.runId,
          siteId: sessionId,
          ordinal: 0,
          actorSessionId: sessionId,
          actorName: sessionId,
        }),
      }, sessionId),
    )),
  };
});
vi.mock("../features/workflows/model/workflowSessionWatch", () => ({
  watchHostSession: () => ({
    subscribe: () => () => {},
    getSnapshot: () => undefined,
    release: () => {},
  }),
}));

vi.mock("../features/settings/ui/SettingsView", async () => {
  const { createElement: el, useEffect, useState } = await import("react");
  return {
    SettingsView: ({
      active,
      onClose,
    }: {
      active: boolean;
      onClose: () => void;
    }) => {
      const [count, setCount] = useState(0);
      useEffect(() => {
        mocks.viewMounted("settings");
      }, []);
      return el(
        "section",
        { "data-app-view": "settings", "data-focused": active },
        el(
          "button",
          {
            "data-view-state": true,
            onClick: () => setCount((value) => value + 1),
          },
          String(count),
        ),
        el("button", { "data-leave-view": true, onClick: onClose }, "Leave"),
      );
    },
  };
});
vi.mock("../features/inbox/ui/InboxView", async () => {
  const { createElement: el, useEffect, useRef } = await import("react");
  const { AppPageHeader } = await import("../features/workspace/ui/AppPageHeader");
  const { Inbox } = await import("../shared/ui/icons");
  return {
    InboxView: ({
      active,
      onClose,
      onOpenSession,
      onAsk,
      onAskMount,
    }: {
      active: boolean;
      onClose: () => void;
      onOpenSession: (id: string) => void;
      onAsk: (
        item: import("../features/inbox/model/githubTasks").InboxItem,
      ) => Promise<string>;
      onAskMount: (portal: { sessionId: string; host: HTMLElement }) => void;
    }) => {
      const host = useRef<HTMLDivElement>(null);
      useEffect(() => {
        mocks.viewMounted("inbox");
      }, []);
      return el(
        "section",
        { "data-app-view": "inbox", "data-focused": active },
        el(AppPageHeader, { title: "Inbox", icon: Inbox }),
        el("button", { "data-leave-view": true, onClick: onClose }),
        el("button", {
          "data-inbox-open-session": true,
          onClick: () => onOpenSession("recent"),
        }),
        el("div", { ref: host, "data-inbox-discussion-host": true }),
        el("button", {
          "data-inbox-ask": true,
          onClick: async () => {
            const sessionId = await onAsk({
              kind: "issue",
              provider: "github",
              repo: "acme/web",
              number: 1,
              title: "Test issue",
              url: "https://github.com/acme/web/issues/1",
              state: "open",
              updatedAt: "2026-01-01",
              labels: [],
              assignees: [],
              draft: false,
              projectPath: "/repo",
            });
            onAskMount({ sessionId, host: host.current! });
          },
        }),
      );
    },
  };
});
vi.mock("../features/inbox/ui/LinkedWorkItemPanel", () => ({
  LinkedWorkItemPanel: () => null,
}));
vi.mock("../features/notes/ui/NotesView", async () => {
  const { createElement: el, useEffect, useState } = await import("react");
  const { AppPageHeader } = await import("../features/workspace/ui/AppPageHeader");
  const { File } = await import("../shared/ui/icons");
  const { useTranslation } = await import("../shared/i18n/useTranslation");
  return {
    NotesView: ({ active, onClose }: { active: boolean; onClose: () => void }) => {
      const { t } = useTranslation();
      const [count, setCount] = useState(0);
      useEffect(() => {
        mocks.viewMounted("notes");
      }, []);
      return el(
        "section",
        { "data-app-view": "notes", "data-focused": active },
        el(AppPageHeader, { title: t("Notes"), icon: File, onBack: onClose }),
        el(
          "button",
          {
            "data-view-state": true,
            onClick: () => setCount((value) => value + 1),
          },
          String(count),
        ),
      );
    },
  };
});

let container: HTMLDivElement;
let root: Root;
let firstId: string;
let recentId: string;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  startMotionClock();
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  localStorage.clear();
  setUiLanguage("en");
  localStorage.setItem("omnicode.fileTabMode", "pane");
  mocks.invoke.mockReset().mockImplementation(async (command) => {
    if (command === "default_cwd") return "/repo";
    if (command === "git_branches") return { branches: [], current: "main" };
    return [];
  });
  mocks.viewMounted.mockReset();
  mocks.projectBranches.mockReset().mockReturnValue(null);
  mocks.paneRendered.mockReset();
  mocks.fileOpen.mockReset().mockImplementation(async (_cwd, path) => path);
  mocks.diffOpen.mockReset().mockImplementation(async (_cwd, path) => path);
  mocks.windowMinimize.mockClear();
  mocks.windowMaximize.mockClear();
  mocks.windowClose.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  for (const pane of container.querySelectorAll<HTMLElement>("[data-session]")) {
    clearComposerDraft(pane.dataset.session!);
  }
  await act(async () => root.unmount());
  activatePreferenceStore(undefined);
  container.remove();
  stopMotionClock();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setUiLanguage("en");
  localStorage.clear();
});

async function mount(onlyApp = false, side: DockSide = "bottom", seed?: Partial<Session>, strict = false, recentSeed?: Partial<Session>, surfaceMode?: "split" | "unified") {
  const first = { ...newSession("codex", "/repo"), id: "first", ...seed };
  const recent = { ...newSession("codex", "/repo"), id: "recent", ...recentSeed };
  const firstTab = { ...newTab(first.id), surfaceMode };
  const recentTab = newTab(recent.id);
  firstId = firstTab.id;
  recentId = recentTab.id;
  await act(async () =>
    root.render(
      createElement(strict ? StrictMode : Fragment, null, createElement(App, {
        resumed: {
          sessions: onlyApp ? [] : [first, recent],
          tabs: onlyApp
            ? [{ ...newAppViewWorkspaceTab("settings"), id: "sole-app" }]
            : [firstTab, recentTab],
          activeTabId: onlyApp ? "sole-app" : firstTab.id,
          projectCwd: "/repo",
          projectReturnMemory: new Map(),
          projectTerminals: [
            createProjectTerminal("/repo", newTerminalFile("/repo"), side),
          ],
        },
      })),
    ),
  );
  await act(async () => vi.dynamicImportSettled());
  await act(async () => finishMotion());
}

async function click(selector: string) {
  const button = container.querySelector<HTMLButtonElement>(selector);
  expect(button, selector).not.toBeNull();
  await act(async () => button!.click());
  await act(async () => vi.dynamicImportSettled());
}

async function clickDesktopNavigation(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('[data-ui="navigation-item"]')]
    .find(item => item.textContent === label);
  expect(button, label).not.toBeUndefined();
  await act(async () => button!.click());
  await act(async () => vi.dynamicImportSettled());
}

async function sidebarPreferences() {
  const key = "omnicode.sessionSidebarOpen";
  let snapshot: PreferenceSnapshot = { revision: 0, imported: true, values: { [key]: "0" } };
  const state = { online: true, failWrites: false };
  const patches: Record<string, string | null>[] = [];
  const request: PreferenceRequest = async <T>(method: string, params: Record<string, unknown>) => {
    if (!state.online) throw new Error("offline");
    if (method === "preferences.patch") {
      const changes = params.changes as Record<string, string | null>;
      patches.push(changes);
      const values = { ...snapshot.values };
      for (const [field, value] of Object.entries(changes)) {
        if (value === null) delete values[field]; else values[field] = value;
      }
      snapshot = { ...snapshot, revision: snapshot.revision + 1, values };
    }
    return snapshot as T;
  };
  const data = new Map<string, string>();
  const disk = {
    get length() { return data.size; },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (field: string) => data.get(field) ?? null,
    removeItem: (field: string) => { data.delete(field); },
    setItem: (field: string, value: string) => {
      if (state.failWrites) throw new Error("quota exceeded");
      data.set(field, value);
    },
  };
  // The open state is per device; the Host copy only shows it is never uploaded.
  localStorage.setItem(key, "0");
  const store = new SharedPreferenceStore("synthetic-sidebar", disk, request);
  await store.sync();
  activatePreferenceStore(store);
  return {
    store, state,
    writes: () => patches.filter((change) => key in change).map((change) => change[key]),
    remote: (open: boolean) => { snapshot = { ...snapshot, revision: snapshot.revision + 1, values: { ...snapshot.values, [key]: open ? "1" : "0" } }; },
  };
}

describe("sidebar preference actions in StrictMode", () => {
  const toggle = () => container.querySelector<HTMLButtonElement>(
    '[data-window-navigation] button[aria-label^="Toggle Sidebar"]',
  )!;
  const isOpen = () => toggle().getAttribute("aria-pressed") === "true";

  it.each([
    ["independent clicks", [1, 1, 1]],
    ["rapid reversal before the animation finishes", [1, 1]],
    ["two toggles in one batch", [2]],
    ["three toggles in one batch", [3]],
  ] as const)("persists one local action per click for %s", async (_name, batches) => {
    const preferences = await sidebarPreferences();
    await mount(false, "bottom", undefined, true);
    expect(isOpen()).toBe(false);
    const saved = vi.spyOn(localStorage, "setItem");
    let clicks = 0;
    for (const count of batches) {
      await act(async () => {
        for (let index = 0; index < count; index++) toggle().click();
        await preferences.store.sync();
      });
      clicks += count;
      expect(isOpen()).toBe(clicks % 2 === 1);
      expect(loadSessionSidebarOpen()).toBe(isOpen());
    }
    expect(saved.mock.calls.filter(([key]) => key === "omnicode.sessionSidebarOpen").map(([, value]) => value))
      .toEqual(Array.from({ length: clicks }, (_, index) => index % 2 === 0 ? "1" : "0"));
    expect(preferences.writes()).toEqual([]);
  });

  it("keeps the sidebar per device while a Host is connected", async () => {
    const preferences = await sidebarPreferences();
    await mount(false, "bottom", undefined, true);
    preferences.remote(true);
    await act(async () => preferences.store.sync());
    expect(isOpen()).toBe(false);
    preferences.state.online = false;
    await act(async () => { toggle().click(); await preferences.store.sync(); });
    expect(isOpen()).toBe(true);
    expect(loadSessionSidebarOpen()).toBe(true);
    expect(preferences.store.pendingCount).toBe(0);
    expect(preferences.writes()).toEqual([]);
  });
});

const workspace = (id?: string) =>
  container.querySelector<HTMLElement>(
    id
      ? `[data-workspace-tab="${id}"]`
      : '[data-workspace-tab][data-active="true"]',
  )!;

const activeTabId = () => workspace().dataset.workspaceTab;

const promotedHeader = (id = activeTabId()) =>
  container.querySelector<HTMLElement>(`[data-window-session-header="${id}"]`);

const ownedTabs = (id?: string) =>
  (workspace(id).querySelector<HTMLElement>("[data-session-surface-tabs]") ??
    promotedHeader(id)?.querySelector<HTMLElement>("[data-session-surface-tabs]"))!;

const ownedFileTabs = (id?: string) => [
  ...workspace(id).querySelectorAll<HTMLElement>("[data-file-tab-id]"),
];

async function clickInWorkspace(selector: string, id?: string) {
  const button = workspace(id).querySelector<HTMLButtonElement>(selector) ??
    promotedHeader(id)?.querySelector<HTMLButtonElement>(selector);
  expect(button, selector).not.toBeNull();
  await act(async () => button!.click());
  await act(async () => vi.dynamicImportSettled());
}

async function selectSession(id: "first" | "recent") {
  await click(`[data-select-session="${id}"]`);
}

async function pressKey(key: string, ctrlKey = false) {
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        code: key === "w" ? "KeyW" : key,
        ctrlKey,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
}

describe("desktop mode navigation", () => {
  const chatCwd = "/home/me/Documents/omnicode/2026-10-13/chat-120000-abcdef";
  const switchMode = (mode: "Chat" | "Code") => click(`.desktop-mode-toggle button[aria-label="${mode}"]`);
  it.each([false, true])("launches in saved Chat mode without a snapshot even with a recent project: %s", async (hasRecentProject) => {
    localStorage.setItem("omnicode.desktopMode", "chat");
    if (hasRecentProject) localStorage.setItem("omnicode.recentProjects", JSON.stringify([{ path: "/repo", openedAt: 1 }]));
    await act(async () => root.render(createElement(App)));
    await act(async () => vi.dynamicImportSettled());
    expect(document.documentElement.dataset.desktopMode).toBe("chat");
    expect(container.querySelector('[data-app-page="projects"]')).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalledWith("default_cwd");
    expect(localStorage.getItem("omnicode.desktopMode")).toBe("chat");
  });

  it("prioritizes the restored conversation over the saved mode", async () => {
    localStorage.setItem("omnicode.desktopMode", "chat");
    await mount(false, "bottom", { cwd: "/repo", blocks: [{ id: "restored", role: "user", text: "Restored Code" }] });
    expect(document.documentElement.dataset.desktopMode).toBe("code");
    expect(activeTabId()).toBe(firstId);
  });

  it("remembers each mode's conversation, file focus and independent unsent draft", async () => {
    await mount(false, "bottom", { cwd: chatCwd, blocks: [{ id: "chat-user", role: "user", text: "Keep Chat" }] });
    setComposerDraft("first", "Unsent Chat draft");
    setComposerDraft("recent", "Unsent Code draft");
    expect(document.documentElement.dataset.desktopMode).toBe("chat");
    await switchMode("Code");
    expect(activeTabId()).toBe(recentId);
    await click("[data-open-file]");
    expect(workspace(recentId).querySelector('[data-file-editor="/repo/file.ts"]')?.getAttribute("data-file-active")).toBe("true");

    await switchMode("Chat");
    expect(activeTabId()).toBe(firstId);
    expect(getComposerDraft("first")).toBe("Unsent Chat draft");
    await switchMode("Code");
    expect(activeTabId()).toBe(recentId);
    expect(getComposerDraft("recent")).toBe("Unsent Code draft");
    expect(ownedFileTabs(recentId)).toHaveLength(1);
    expect(workspace(recentId).querySelector('[data-file-editor="/repo/file.ts"]')?.getAttribute("data-file-active")).toBe("true");
  });

  it("follows a selected conversation into its actual mode and returns to the retained other mode", async () => {
    await mount(false, "bottom", { cwd: chatCwd, blocks: [{ id: "chat-user", role: "user", text: "Keep Chat" }] });
    setComposerDraft("recent", "Keep Code");
    await selectSession("recent");
    expect(document.documentElement.dataset.desktopMode).toBe("code");
    expect(activeTabId()).toBe(recentId);
    await selectSession("first");
    expect(document.documentElement.dataset.desktopMode).toBe("chat");
    expect(activeTabId()).toBe(firstId);
    await switchMode("Code");
    expect(activeTabId()).toBe(recentId);
    await pressKey("[", true);
    expect(document.documentElement.dataset.desktopMode).toBe("chat");
    expect(activeTabId()).toBe(firstId);
    await pressKey("]", true);
    expect(document.documentElement.dataset.desktopMode).toBe("code");
    expect(activeTabId()).toBe(recentId);
  });

  it("launches Code directly in the workspace without a Projects page", async () => {
    localStorage.setItem("omnicode.desktopMode", "code");
    await act(async () => root.render(createElement(App)));
    await act(async () => vi.dynamicImportSettled());
    expect(document.documentElement.dataset.desktopMode).toBe("code");
    expect(container.querySelector('[data-app-page="projects"]')).toBeNull();
    expect([...container.querySelectorAll('[data-ui="navigation-item"]')].some(item => item.textContent === "Projects")).toBe(false);
    expect(mocks.invoke).toHaveBeenCalledWith("default_cwd");
  });

  it("opens the project picker for a missing Code target while retaining the Chat workspace", async () => {
    saveMenuBarVisible(false);
    localStorage.setItem("omnicode.desktopLocations.v1", JSON.stringify({ code: { tabId: "closed", sessionId: "gone", cwd: "/removed" } }));
    await mount(false, "bottom", { cwd: chatCwd, blocks: [{ id: "chat-user", role: "user", text: "Keep Chat" }] }, false,
      { cwd: "~", blocks: [{ id: "other-chat-user", role: "user", text: "Another Chat" }] });
    setComposerDraft("first", "Keep fallback draft");
    await switchMode("Code");
    expect(document.documentElement.dataset.desktopMode).toBe("chat");
    expect(document.querySelector('[data-quick-open-mode="projects"]')).not.toBeNull();
    await switchMode("Chat");
    expect(activeTabId()).toBe(firstId);
    expect(getComposerDraft("first")).toBe("Keep fallback draft");
  });

  it("opens the project picker when a remembered closed Code conversation can no longer be loaded", async () => {
    const remembered = { ...newSession("codex", "/project-b"), id: "unavailable-code", title: "Unavailable", createdAt: 1, updatedAt: 2 };
    const invoke = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === "session_list_by_project" && args.cwd === "/project-b") return [remembered];
      if (command === "session_get" && args.sessionId === remembered.id) return null;
      return invoke(command, args);
    });
    localStorage.setItem("omnicode.desktopLocations.v1", JSON.stringify({ code: { tabId: "closed", sessionId: remembered.id, cwd: remembered.cwd } }));
    await mount(false, "bottom", { cwd: chatCwd, blocks: [{ id: "chat-user", role: "user", text: "Keep Chat" }] }, false,
      { cwd: "~", blocks: [{ id: "other-chat-user", role: "user", text: "Another Chat" }] });
    setComposerDraft("first", "Keep failed-restore draft");
    await click('[data-load-project="/project-b"]');
    await switchMode("Code");
    expect(mocks.invoke).toHaveBeenCalledWith("session_get", { sessionId: remembered.id });
    expect(document.documentElement.dataset.desktopMode).toBe("chat");
    expect(document.querySelector('[data-quick-open-mode="projects"]')).not.toBeNull();
    await switchMode("Chat");
    expect(activeTabId()).toBe(firstId);
    expect(getComposerDraft("first")).toBe("Keep failed-restore draft");
  });

  it("ignores a late Code restoration after switching back to Chat", async () => {
    const remembered = { ...newSession("codex", "/project-b"), id: "delayed-code", title: "Delayed", createdAt: 1, updatedAt: 2 };
    let finishRestore!: (session: Session) => void;
    const invoke = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === "session_list_by_project" && args.cwd === "/project-b") return [remembered];
      if (command === "session_get" && args.sessionId === remembered.id) return await new Promise<Session>(resolve => { finishRestore = resolve; });
      return invoke(command, args);
    });
    localStorage.setItem("omnicode.desktopLocations.v1", JSON.stringify({ code: { tabId: "closed", sessionId: remembered.id, cwd: remembered.cwd } }));
    await mount(false, "bottom", { cwd: chatCwd, blocks: [{ id: "chat-user", role: "user", text: "Keep Chat" }] }, false,
      { cwd: "~", blocks: [{ id: "other-chat-user", role: "user", text: "Another Chat" }] });
    setComposerDraft("first", "Keep rapid reversal draft");
    await click('[data-load-project="/project-b"]');
    await switchMode("Code");
    expect(finishRestore).toBeDefined();
    await switchMode("Chat");
    await act(async () => finishRestore(remembered));
    await act(async () => vi.dynamicImportSettled());
    expect(document.documentElement.dataset.desktopMode).toBe("chat");
    expect(activeTabId()).toBe(firstId);
    expect(getComposerDraft("first")).toBe("Keep rapid reversal draft");
  });
});

describe("window page navigation", () => {
  const navButton = (direction: "Back" | "Forward") =>
    container.querySelector<HTMLButtonElement>(
      `[data-window-navigation] button[aria-label^="${direction}"]`,
    )!;
  const pageVisible = (kind: string) =>
    container.querySelector(`[data-app-page="${kind}"]`)?.getAttribute("aria-hidden") === "false";
  const mouse = async (button: number) => {
    await act(async () => {
      for (const type of ["mousedown", "mouseup", "auxclick"]) {
        const event = new MouseEvent(type, { button, bubbles: true, cancelable: true });
        container.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
      }
    });
    await act(async () => vi.dynamicImportSettled());
  };

  beforeEach(() => saveMenuBarVisible(false));

  it("shares visits between the arrows and side buttons, including pages and new branches", async () => {
    await mount(false, "bottom", { blocks: [{ id: "prompt", role: "user", text: "Keep chat" }] });
    setComposerDraft("recent", "Keep this chat too");
    expect(navButton("Back").getAttribute("aria-disabled")).toBe("true");
    await mouse(3);
    expect(activeTabId()).toBe(firstId);
    await selectSession("recent");
    await click('[data-command="View: Notes"]');
    await click('[data-command="View: Inbox"]');
    await mouse(3);
    expect(pageVisible("notes")).toBe(true);
    await act(async () => navButton("Back").click());
    expect(pageVisible("notes")).toBe(false);
    expect(activeTabId()).toBe(recentId);
    await mouse(3);
    expect(activeTabId()).toBe(firstId);
    expect(navButton("Back").getAttribute("aria-disabled")).toBe("true");
    await mouse(4);
    expect(activeTabId()).toBe(recentId);
    await act(async () => navButton("Forward").click());
    expect(pageVisible("notes")).toBe(true);
    await click('[data-command="View: Automations"]');
    expect(navButton("Forward").getAttribute("aria-disabled")).toBe("true");
    await mouse(4);
    expect(pageVisible("automations")).toBe(true);
    await mouse(3);
    expect(pageVisible("notes")).toBe(true);
  });

  it("restores a settings dialog together with the page beneath it", async () => {
    await mount();
    await click('[data-command="View: Notes"]');
    await click('[data-command="App: Settings"]');
    await click('[data-command="View: Inbox"]');
    expect(document.querySelector("[data-app-view-dialog]")).toBeNull();
    await mouse(3);
    expect(document.querySelector('[data-app-view-dialog] [data-app-view="settings"]')).not.toBeNull();
    // Closing the restored dialog reveals the original Notes page.
    await mouse(3);
    expect(document.querySelector("[data-app-view-dialog]")).toBeNull();
    expect(pageVisible("notes")).toBe(true);
    await mouse(4);
    expect(document.querySelector('[data-app-view-dialog] [data-app-view="settings"]')).not.toBeNull();
    await mouse(4);
    expect(pageVisible("inbox")).toBe(true);
  });

  it("returns to the focused Assistant document and skips it once closed", async () => {
    await mount(false, "bottom", { blocks: [{ id: "prompt", role: "user", text: "Keep chat" }] });
    setComposerDraft("recent", "Keep the fallback chat");
    await clickDesktopNavigation("Bots");
    const assistantTab = activeTabId();
    const assistant = () => container.querySelector(`[data-workspace-tab="${assistantTab}"] [data-app-view="assistant"]`);
    await click('[data-command="View: Notes"]');
    await mouse(3);
    expect(pageVisible("notes")).toBe(false);
    expect(assistant()).not.toBeNull();
    await pressKey("w", true);
    expect(assistant()).toBeNull();
    expect(activeTabId()).toBe(recentId);
    await mouse(3);
    expect(activeTabId()).toBe(firstId);
    expect(navButton("Back").getAttribute("aria-disabled")).toBe("true");
    await mouse(4);
    expect(activeTabId()).toBe(recentId);
    expect(assistant()).toBeNull();
  });

  it("uses the same history for keyboard navigation and restores document focus", async () => {
    await mount();
    await click("[data-open-file]");
    const editor = () => workspace().querySelector('[data-file-editor="/repo/file.ts"]')!;
    expect(editor().getAttribute("data-file-active")).toBe("true");
    await click('[data-command="View: Notes"]');
    await pressKey("[", true);
    expect(pageVisible("notes")).toBe(false);
    expect(editor().getAttribute("data-file-active")).toBe("true");
    await mouse(3);
    expect(workspace().querySelector('[data-session="first"]')?.getAttribute("data-composer-focused")).toBe("true");
    await mouse(4);
    expect(editor().getAttribute("data-file-active")).toBe("true");
    expect(workspace().querySelector('[data-session="first"]')?.getAttribute("data-composer-focused")).toBe("false");
  });

  it("skips disabled Notes entries on both sides of the current page", async () => {
    await mount();
    await click('[data-command="View: Notes"]');
    await click('[data-command="View: Inbox"]');
    await click('[data-command="View: Notes"]');
    await mouse(3);
    await act(async () => saveNotesEnabled(false));
    expect(navButton("Forward").getAttribute("aria-disabled")).toBe("true");
    await mouse(3);
    expect(pageVisible("inbox")).toBe(false);
    expect(activeTabId()).toBe(firstId);
    expect(navButton("Back").getAttribute("aria-disabled")).toBe("true");
  });
});

describe("local composer agent selection", () => {
  beforeEach(() => {
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === "resolve_project_location") return { path: args.path, identity: "repo" };
      if (command === "session_upsert") return { ...args.session, archived: false, createdAt: 1, updatedAt: 2 };
      return original(command, args);
    });
  });
  const pane = () => mocks.paneRendered.mock.calls.map(([props]) => props as SessionPaneProps)
    .filter(props => props.session.id === "first").at(-1)!;

  it("opens a fork from the displayed snapshot without changing the occupied source", async () => {
    await mount(false, "bottom", { providerSessionId: "occupied-thread", title: "Existing work",
      blocks: [{ id: "old-user", role: "user", text: "Earlier work" }] });
    const before = pane().session;
    const displayed = { ...before, blocks: [
      ...before.blocks, { id: "new-reply", role: "assistant" as const, text: "Latest Host history" },
    ] };
    await act(async () => pane().onForkSession!(displayed));
    const fork = mocks.paneRendered.mock.calls.map(([props]) => props as SessionPaneProps)
      .find(props => props.session.id !== "first" && props.session.handoffCard)?.session;
    expect(fork?.handoffCard?.brief).toContain("Latest Host history");
    expect(fork?.providerSessionId).toBeUndefined();
    expect(fork?.nativeSession).toBeUndefined();
    expect(pane().session).toEqual(before);
  });

  it("keeps the existing agent until a non-empty message is submitted", async () => {
    await mount(false, "bottom", { providerSessionId: "original-thread", title: "Existing work",
      blocks: [{ id: "old-user", role: "user", text: "Earlier work" }] });
    const before = pane().session;
    await act(async () => pane().onModelChange("first", "claude", "claude:sonnet"));
    expect(pane().session).toMatchObject({ harness: "codex", title: "Existing work", providerSessionId: "original-thread" });
    expect(pane().session.blocks).toEqual(before.blocks);
    expect(sessionComposerConfiguration(pane().session).harness).toBe("claude");
    await act(async () => pane().onModelSettingsChange("first", { effort: "high" }));
    await act(async () => pane().onRuntimeModeChange("first", "full-access"));
    expect(pane().session.modelSettings).toEqual(before.modelSettings);
    expect(pane().session.runtimeMode).toEqual(before.runtimeMode);
    await act(async () => { expect(pane().onSubmit("first", " ", [])).toBe(false); });
    expect(pane().session.harness).toBe("codex");
    await act(async () => { pane().onSubmit("first", "Continue with Claude", []); });
    await act(async () => vi.dynamicImportSettled());
    expect(pane().session.harness).toBe("claude");
    expect(pane().session.runtimeMode).toBe("full-access");
    expect(pane().session.pendingConfiguration).toBeUndefined();
    expect(pane().session.blocks.some(block => block.role === "user" && block.text === "Continue with Claude")).toBe(true);
  });

  it("cancels an unsent switch when the original agent is selected again", async () => {
    await mount(false, "bottom", { providerSessionId: "original-thread",
      blocks: [{ id: "old-user", role: "user", text: "Earlier work" }] });
    const before = pane().session;
    await act(async () => pane().onModelChange("first", "claude", "claude:sonnet"));
    await act(async () => pane().onModelChange("first", "codex", before.model));
    expect(pane().session.harness).toBe("codex");
    expect(pane().session.providerSessionId).toBe("original-thread");
    expect(pane().session.blocks).toEqual(before.blocks);
    expect(pane().session.pendingConfiguration).toBeUndefined();
    expect(pane().session.pendingSwitch).toBeUndefined();
  });
});

describe("terminal dock disclosure motion", () => {
  const grid = () =>
    container.querySelector<HTMLElement>("[data-terminal-dock-layout]")!;
  const terminal = () =>
    container.querySelector<HTMLElement>("[data-terminal-dock]")!;
  const finish = () => act(async () => finishMotion());

  it("keeps dock animation completion from rendering App again", async () => {
    await mount();
    for (const open of [false, true]) {
      mocks.notificationFocus.mockClear();
      await click(open
        ? '[data-command="Terminal: Toggle Dock"]'
        : "[data-terminal-hide]");
      // Business visibility/focus changes may render App; settling must not.
      const renders = mocks.notificationFocus.mock.calls.length;
      expect(renders).toBeGreaterThan(0);
      expect(grid().dataset.foldState).toBe(open ? "opening" : "closing");
      await finish();
      expect(grid().dataset.foldState).toBe(open ? "open" : "closed");
      expect(mocks.notificationFocus).toHaveBeenCalledTimes(renders);
    }
  });

  it.each(["bottom", "top", "left", "right"] as const)(
    "animates the %s dock with stable tracks while retaining its terminal instance",
    async (side) => {
      await mount(false, side);
      const node = terminal();
      const areas = grid().style.gridTemplateAreas;
      expect(grid().dataset.foldState).toBe("open");
      expect(grid().classList.contains("animated-collapse-size")).toBe(true);
      await click("[data-terminal-hide]");
      expect(grid().dataset.foldState).toBe("closing");
      expect(grid().style.gridTemplateAreas).toBe(areas);
      expect(node.parentElement?.inert).toBe(true);
      expect(node.dataset.visible).toBe("false");
      expect(node.closest(".hidden")).toBeNull();
      await finish();
      expect(
        side === "bottom" || side === "top"
          ? grid().style.gridTemplateRows
          : grid().style.gridTemplateColumns,
      ).toContain("0px");
      expect(grid().dataset.foldState).toBe("closed");
      expect(node.closest(".hidden")).not.toBeNull();
      await click('[data-command="Terminal: Toggle Dock"]');
      expect(grid().dataset.foldState).toBe("opening");
      expect(terminal()).toBe(node);
      expect(node.dataset.visible).toBe("true");
      expect(node.closest(".hidden")).toBeNull();
      await finish();
      expect(grid().dataset.foldState).toBe("open");
    },
  );

  it("disables motion while resizing and preserves the committed height through rapid reversal", async () => {
    await mount();
    await click("[data-terminal-paint]");
    expect(grid().style.transitionProperty).toBe("none");
    expect(grid().style.gridTemplateRows).toContain("280px");
    await click("[data-terminal-commit]");
    expect(grid().style.transitionProperty).toBe("");
    await click("[data-terminal-hide]");
    expect(grid().dataset.foldState).toBe("closing");
    await act(async () => finishMotion(8));
    await click('[data-command="Terminal: Toggle Dock"]');
    expect(grid().dataset.foldState).toBe("opening");
    await finish();
    expect(grid().style.gridTemplateRows).toContain("280px");
    expect(grid().dataset.foldState).toBe("open");
  });

  it("settles dock visibility immediately with reduced motion without destroying the terminal", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query === "(prefers-reduced-motion: reduce)",
        }) as MediaQueryList,
    );
    await mount();
    const node = terminal();
    await click("[data-terminal-hide]");
    expect(grid().dataset.foldState).toBe("closed");
    expect(node.closest(".hidden")).not.toBeNull();
    await click('[data-command="Terminal: Toggle Dock"]');
    expect(grid().dataset.foldState).toBe("open");
    expect(terminal()).toBe(node);
  });
});

describe("App workspace app views", () => {
  it.each([
    { pinned: false, surfaceMode: "split" },
    { pinned: false, surfaceMode: "unified" },
    { pinned: true, surfaceMode: "split" },
    { pinned: true, surfaceMode: "unified" },
  ] as const)("keeps a lone Code conversation header in window chrome: pinned=$pinned, mode=$surfaceMode", async ({ pinned, surfaceMode }) => {
    saveMenuBarVisible(pinned);
    await mount(false, "bottom", { blocks: [{ id: "message", role: "user", text: "Single Code conversation" }] }, false, undefined, surfaceMode);
    expect(document.documentElement.dataset.desktopMode).toBe("code");
    const conversation = workspace().querySelector('[data-pane-id="first"]');
    expect(conversation).not.toBeNull();
    await click("[data-terminal-hide]");
    await act(async () => finishMotion());
    const inChrome = container.querySelectorAll('[data-window-session-header] [data-session-surface-tabs="first"]');
    const inWorkspace = workspace().querySelectorAll('[data-session-surface-tabs="first"]');
    expect(inChrome).toHaveLength(pinned ? 0 : 1);
    expect(inWorkspace).toHaveLength(pinned ? 1 : 0);
    expect(workspace().querySelector('[data-pane-id="first"]')).toBe(conversation);
  });

  it.each([false, true])("opens the owning project's files from the session header with a pinned menu: %s", async (pinned) => {
    saveMenuBarVisible(pinned);
    await mount(false, "bottom", undefined, false, { cwd: "/project-b" });
    expect(!!container.querySelector('[data-window-session-header] button[aria-label="Files"]')).toBe(!pinned);
    expect(container.querySelector('[data-window-chrome] button[aria-label="Changes"]')).toBeNull();
    expect(container.querySelector('[data-session-tool-toggle="changes"]')).toBeNull();
    const fileButton = (id: string) => `[data-session-surface-tabs="${id}"] [data-session-tool-toggle="files"]`;
    await click(fileButton("first"));
    expect(container.querySelector('.desktop-file-explorer')?.getAttribute('data-file-explorer-cwd')).toBe('/repo');
    expect(container.querySelector(fileButton("first"))?.getAttribute('aria-pressed')).toBe('true');
    await click(fileButton("first"));
    await selectSession("recent");
    await click(fileButton("recent"));
    expect(workspace(recentId).querySelector('.desktop-file-explorer')?.getAttribute('data-file-explorer-cwd')).toBe('/project-b');
    expect(container.querySelector(fileButton("recent"))?.getAttribute('aria-pressed')).toBe('true');
  });

  it.each([
    null,
    { current: null, detached: false, branches: [] },
  ] satisfies (GitBranches | null)[])("ignores a saved changes choice and the changes command without a repository: %j", async (branches) => {
    mocks.projectBranches.mockReturnValue(branches);
    saveProjectSidebarTab("/repo", "changes");
    await mount();
    expect(workspace().querySelector('[data-diff-cwd]')).toBeNull();
    await click('[data-command="View: Toggle Changes"]');
    expect(workspace().querySelector('[data-diff-cwd]')).toBeNull();
    expect(workspace().querySelector('[data-pane-id="first"]')).not.toBeNull();
  });

  it.each([
    { current: "main", detached: false, branches: [] },
    { current: "a1b2c3d", detached: true, branches: [] },
  ])("opens changes as the working-tree review beside the independent file explorer: %j", async (branches) => {
    mocks.projectBranches.mockReturnValue(branches);
    await mount();
    await click('[data-command="View: Toggle Changes"]');
    expect(workspace().querySelector('[data-diff-cwd="/repo"]')).not.toBeNull();
    await click('[data-session-tool-toggle="files"]');
    expect(workspace().querySelector('.desktop-file-explorer')).not.toBeNull();
    await click('[data-open-file]');
    expect(workspace().querySelector('[data-file-editor="/repo/file.ts"]')).not.toBeNull();
    await click('.desktop-file-explorer [aria-label="Close file.ts"]');
    expect(workspace().querySelector('.desktop-file-explorer')).not.toBeNull();
    expect(workspace().querySelector('[data-file-editor]')).toBeNull();
    await click('.desktop-file-explorer [aria-label="Close panel"]');
    expect(workspace().querySelector('.desktop-file-explorer')).toBeNull();
  });

  it.each([false, true])("opens a message's originating Bot on its own Host (remote=%s)", async remote => {
    const projects = await import("../features/connections/model/remoteProjects");
    const connections = await import("../features/connections/model/connections");
    const { readBotSelection } = await import("../features/bots/model/botSelection");
    const environmentId = remote ? "origin-remote" : "origin-local";
    const machineId = remote ? "remote-machine" : "local-machine";
    projects.configureSharedHost("origin-local", [], "local-machine");
    const cwd = remote ? projects.rememberRemoteProject(environmentId, { id: "origin-project", cwd: "/repo" }).key : "/repo";
    vi.spyOn(connections, "remoteMachineFor").mockResolvedValue({ id: machineId, environmentId, name: "Origin Host", endpoint: "https://host.test" });
    const request = vi.spyOn(connections, "remoteRequest").mockImplementation(async <T,>(_: string, method: string) => {
      if (method === "environment.describe") return { capabilities: ["bots.v1"] } as T;
      if (method === "bots.list") return { bots: [{ id: "bot", name: "Helper", defaultThreadId: "default" }], threads: [{ id: "source-thread", botId: "bot" }] } as T;
      if (method === "sessions.activity") return { sessions: [] } as T;
      return [] as T;
    });
    try {
      await mount(false, "bottom", { cwd });
      const pane = mocks.paneRendered.mock.calls.map(([props]) => props as SessionPaneProps).findLast(props => props.session.id === "first")!;
      expect(pane.onOpenBot).toBeTypeOf("function");
      await act(async () => pane.onOpenBot!("first", { kind: "assistant", assistantId: "bot", botId: "bot", threadId: "source-thread", actionId: "send", wakeupId: "wake" }));
      expect(request).toHaveBeenCalledWith(machineId, "bots.list", undefined);
      expect(readBotSelection(environmentId)).toEqual({ botId: "bot", threadId: "source-thread" });
      expect(workspace().querySelector('[data-app-view="assistant"]')?.getAttribute("data-bots-machine")).toBe(machineId);
    } finally {
      projects.configureSharedHost(undefined, []);
    }
  });

  it("opens Assistant as a reusable workspace page and retains its draft across chat switches", async () => {
    await mount();
    expect(container.querySelector('[data-sidebar] .desktop-navigation')).not.toBeNull();
    expect(container.querySelector('[data-window-leading] .desktop-navigation')).toBeNull();
    await clickDesktopNavigation("Bots");
    const assistantTab = activeTabId();
    expect(assistantTab).not.toBe(firstId);
    expect(
      workspace().querySelector('[data-app-view="assistant"]'),
    ).not.toBeNull();
    expect(container.querySelector(".assistant-overlay")).toBeNull();
    expect(workspace().querySelector('[role="tablist"]')).toBeNull();
    const draft = container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Assistant draft"]',
    )!;
    draft.value = "Keep this draft";
    await selectSession("recent");
    await clickDesktopNavigation("Bots");
    expect(activeTabId()).toBe(assistantTab);
    expect(
      container.querySelectorAll('[data-app-view="assistant"]'),
    ).toHaveLength(1);
    expect(container.querySelector('[aria-label="Assistant draft"]')).toBe(
      draft,
    );
    expect(draft.value).toBe("Keep this draft");
    await pressKey("w", true);
    expect(container.querySelector('[data-app-view="assistant"]')).toBeNull();
    expect(workspace(recentId)).not.toBeNull();
  });

  it.each([false, true])(
    "keeps shared top chrome across pages with a restored app-only workspace: %s",
    async (onlyApp) => {
      const visibleControls = () =>
        [
          ...container.querySelectorAll('[aria-label="Window controls"]'),
        ].filter((controls) => !controls.closest('[aria-hidden="true"]'));
      saveMenuBarVisible(false);
      await mount(onlyApp);
      expect(container.querySelector("[data-title-bar]")).toBeNull();
      const chrome = container.querySelector<HTMLElement>(
        "[data-window-chrome]",
      )!;
      const dragBar = chrome.querySelector<HTMLElement>(
        "[data-window-drag-bar]",
      )!;
      expect(dragBar.getAttribute("data-window-drag-region")).toBe("deep");
      expect(dragBar.closest("[data-workspace-tab]")).toBeNull();
      expect(
        chrome.querySelector('[aria-label="Window controls"]'),
      ).not.toBeNull();
      const sidebarToggle = container.querySelector<HTMLButtonElement>(
        '[data-window-navigation] button[aria-label^="Toggle Sidebar"]',
      )!;
      expect(sidebarToggle.closest("[data-sidebar]")).toBeNull();
      expect(chrome.closest("[data-sidebar-main]")).toBeNull();
      expect(dragBar.contains(sidebarToggle)).toBe(true);
      expect(sidebarToggle.closest("[data-window-navigation]")?.querySelector('[aria-label="Main menu"]')).not.toBeNull();
      expect(sidebarToggle.getAttribute("aria-pressed")).toBe("true");
      await act(async () => sidebarToggle.click());
      expect(dragBar.querySelector(".desktop-mode-toggle")).not.toBeNull();
      expect(dragBar.querySelector('[aria-label^="Toggle Sidebar"]')).toBe(sidebarToggle);
      expect(dragBar.querySelector('[aria-label^="Toggle Sidebar"]')?.getAttribute("aria-pressed")).not.toBe("true");
      await clickDesktopNavigation("Bots");
      expect(container.querySelector("[data-window-drag-bar]")).toBe(dragBar);
      for (const command of [
        "View: Inbox",
        "View: Notes",
        "View: Search Everywhere",
        "App: Settings",
      ]) {
        await click(`[data-command="${command}"]`);
        expect(container.querySelector("[data-window-drag-bar]")).toBe(dragBar);
        expect(visibleControls()).toHaveLength(1);
      }
      const dialog = document.querySelector<HTMLElement>(
        "[data-app-view-dialog]",
      )!;
      expect(dialog.style.top).toBe("42px");
      expect(Number(chrome.style.zIndex)).toBeGreaterThan(
        Number(dialog.style.zIndex),
      );
      expect(visibleControls()).toHaveLength(1);
      await click('[aria-label="Minimize window"]');
      await click('[aria-label="Maximize window"]');
      await click('[aria-label="Close window"]');
      expect(mocks.windowMinimize).toHaveBeenCalledOnce();
      expect(mocks.windowMaximize).toHaveBeenCalledOnce();
      expect(mocks.windowClose).toHaveBeenCalledOnce();
      await act(async () => saveMenuBarVisible(true));
      expect(visibleControls()).toHaveLength(1);
      expect(container.querySelector("[data-window-drag-bar]")).toBeNull();
      expect(dialog.style.top).toBe("36px");
    },
  );

  it.each([false, true])("keeps window navigation mounted through sidebar animation with pinned menu: %s", async (pinned) => {
    saveMenuBarVisible(pinned);
    await mount();
    const toggle = () => container.querySelector<HTMLButtonElement>(
      '[data-window-navigation] button[aria-label^="Toggle Sidebar"]',
    )!;
    const button = toggle();
    const navigation = button.closest("[data-window-navigation]");
    const modeSwitch = navigation!.querySelector(".desktop-mode-toggle");
    const modeCollapse = modeSwitch!.closest<HTMLElement>(".zen-fold-item")!;
    for (const open of [false, true]) {
      mocks.notificationFocus.mockClear();
      await act(async () => toggle().click());
      // This hook runs on each App render; only the actual toggle needs one.
      expect(mocks.notificationFocus).toHaveBeenCalledTimes(1);
      expect(toggle()).toBe(button);
      expect(toggle().closest("[data-window-navigation]")).toBe(navigation);
      expect(toggle().getAttribute("aria-pressed") === "true").toBe(open);
      expect(navigation!.querySelector(".desktop-mode-toggle")).toBe(modeSwitch);
      expect(modeCollapse.inert).toBe(!open);
      expect(modeCollapse.getAttribute("aria-hidden") === "true").toBe(!open);
      expect(container.querySelector("[data-sidebar-rail]")).toBeNull();
      await act(async () => finishMotion());
      expect(container.querySelector('[data-activity-bar="rail"]')).toBeNull();
      expect(modeCollapse.hidden).toBe(!open);
      expect(mocks.notificationFocus).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps sidebar destinations direct and opens Automations from the More menu", async () => {
    saveMenuBarVisible(false);
    await mount();
    const navigation = container.querySelector('nav[aria-label="Main navigation"]')!;
    const items = () => [...navigation.querySelectorAll<HTMLButtonElement>('[data-ui="navigation-item"]')];
    expect(items().map(item => item.textContent)).toEqual(["Bots", "Inbox", "Notes", "Workflows", "More"]);
    expect(items().every(item => item.parentElement === navigation)).toBe(true);
    const more = items().find(item => item.textContent === "More")!;
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[role="menu"][aria-label="More"]')).toBeNull();
    await clickDesktopNavigation("Notes");
    expect(items().find(item => item.textContent === "Notes")?.getAttribute("aria-current")).toBe("page");
    await act(async () => saveNotesEnabled(false));
    expect(items().map(item => item.textContent)).toEqual(["Bots", "Inbox", "Workflows", "More"]);
    await act(async () => more.click());
    const menu = document.querySelector<HTMLElement>('[role="menu"][aria-label="More"]')!;
    expect(menu).not.toBeNull();
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(menu.querySelector('[role="menuitem"]')?.textContent).toBe("Automations");
    expect(menu.querySelector('[data-highlighted="true"]')).toBeNull();
    expect(menu.hasAttribute("aria-activedescendant")).toBe(false);
    await act(async () => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(async () => finishMotion());
    expect(document.querySelector('[role="menu"][aria-label="More"]')).toBeNull();
    await act(async () => more.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    const reopened = document.querySelector<HTMLElement>('[role="menu"][aria-label="More"]')!;
    expect(reopened.querySelector('[data-highlighted="true"]')?.textContent).toBe("Automations");
    await act(async () => reopened.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await act(async () => finishMotion());
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(more.getAttribute("aria-current")).toBe("page");
    expect(document.querySelector('[role="menu"][aria-label="More"]')).toBeNull();
    await act(async () => more.click());
    await click('[data-window-navigation] button[aria-label^="Toggle Sidebar"]');
    await act(async () => finishMotion());
    expect(document.querySelector('[role="menu"][aria-label="More"]')).toBeNull();
    await click('[data-window-navigation] button[aria-label^="Toggle Sidebar"]');
    await act(async () => finishMotion());
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes and unmounts Notes when it is disabled, without disturbing Settings", async () => {
    await mount();
    await click('[data-command="View: Notes"]');
    expect(ownedFileTabs()).toHaveLength(0);
    await click('[data-command="App: Settings"]');
    await act(async () => saveNotesEnabled(false));
    expect(container.querySelector('[data-app-view="notes"]')).toBeNull();
    expect(container.querySelector('[data-workspace-content]')?.getAttribute("aria-hidden")).toBe("false");
    expect(document.querySelector('[data-app-view-dialog] [data-app-view="settings"]')).not.toBeNull();
  });

  it.each([false, true])("updates the page header in zh-CN without losing view state (menu pinned=%s)", async (pinned) => {
    saveMenuBarVisible(pinned);
    await mount();
    await click('[data-command="View: Notes"]');
    await click('[data-app-page="notes"] [data-view-state]');
    await act(async () => setUiLanguage("zh-CN"));
    const header = container.querySelector(pinned
      ? '[data-app-page="notes"] [data-app-page-header]'
      : '[data-window-page-header] [data-app-page-header]');
    expect(header?.textContent).toContain("笔记");
    expect(container.querySelector('[aria-label="返回会话"]')).not.toBeNull();
    expect(ownedFileTabs()).toHaveLength(0);
    expect(activeTabId()).toBe(firstId);
    expect(container.querySelector("[data-view-state]")?.textContent).toBe("1");
    expect(mocks.viewMounted.mock.calls.filter(([kind]) => kind === "notes")).toHaveLength(1);
  });

  it("opens Settings as a dialog over the chat and closes it without a tool tab", async () => {
    await mount();
    await click('[data-command="App: Settings"]');
    const dialog = document.querySelector("[data-app-view-dialog]");
    expect(dialog?.querySelector('[data-app-view="settings"]')).not.toBeNull();
    expect(ownedFileTabs()).toHaveLength(0);
    expect(activeTabId()).toBe(firstId);
    await act(async () =>
      document.querySelector<HTMLButtonElement>("[data-leave-view]")!.click(),
    );
    expect(document.querySelector("[data-app-view-dialog]")).toBeNull();
    expect(
      workspace(firstId).querySelector('[data-session="first"]'),
    ).not.toBeNull();
  });

  it.each(["Inbox", "Notes", "Automations", "Workflows"].flatMap(title => [false, true].map(pinned => ({ title, pinned }))))("places the $title title in available window chrome (menu pinned=$pinned)", async ({ title, pinned }) => {
    saveMenuBarVisible(pinned);
    await mount();
    const kind = title.toLowerCase();
    await click(`[data-command="View: ${title}"]`);
    const page = container.querySelector(`[data-app-page="${kind}"]`)!;
    const host = container.querySelector(`[data-window-page-header="${kind}"]`);
    expect(!!host).toBe(!pinned);
    expect(!!page.querySelector('[data-app-page-header]')).toBe(pinned);
    expect((host ?? page).querySelector('[data-app-page-header]')?.textContent).toBe(title);
    const other = title === "Notes" ? "Inbox" : "Notes";
    await click(`[data-command="View: ${other}"]`);
    expect(container.querySelector('[data-window-page-header]')?.getAttribute('data-window-page-header') ?? null).toBe(pinned ? null : other.toLowerCase());
    await click(`[data-command="View: ${title}"]`);
    expect((pinned ? page : container.querySelector('[data-window-page-header]'))?.querySelector('[data-app-page-header]')?.textContent).toBe(title);
    if (title === "Inbox") {
      expect((pinned ? page : container.querySelector('[data-window-page-header]'))?.querySelector('[aria-label="Back to chat"]')).toBeNull();
    }
    if (title === "Workflows" || title === "Inbox") await click('[data-command="View: Notes"]');
    const back = container.querySelector<HTMLButtonElement>(pinned
      ? `[data-app-page="${title === "Workflows" || title === "Inbox" ? "notes" : kind}"] [aria-label="Back to chat"]`
      : '[data-window-page-header] [aria-label="Back to chat"]')!;
    await act(async () => back.click());
    expect(page.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector('[data-window-page-header]')).toBeNull();
    if (kind === "inbox" || kind === "notes") {
      expect(mocks.viewMounted.mock.calls.filter(([view]) => view === kind)).toHaveLength(1);
    }
  });

  it.each(["Notes", "Inbox", "Automations"])("opens %s as a full-area page and preserves the hidden workspace", async (title) => {
    await mount();
    const chat = workspace(firstId);
    const terminal = container.querySelector('[data-terminal-dock]');
    await click(`[data-command="View: ${title}"]`);
    const kind = title.toLowerCase();
    const page = container.querySelector(`[data-app-page="${kind}"]`)!;
    expect(page.getAttribute("aria-hidden")).toBe("false");
    expect(document.querySelector("[data-app-view-dialog]")).toBeNull();
    expect(document.querySelector("[data-window-chrome-backdrop]")).toBeNull();
    expect(ownedFileTabs()).toHaveLength(0);
    expect(activeTabId()).toBe(firstId);
    expect(mocks.notificationFocus).toHaveBeenLastCalledWith(undefined);
    expect(workspace(firstId)).toBe(chat);
    expect(container.querySelector('[data-terminal-dock]')).toBe(terminal);
    expect(terminal?.getAttribute("data-visible")).toBe("false");
    expect(chat.closest('[data-workspace-content]')?.getAttribute("aria-hidden")).toBe("true");
    expect(chat.closest('[data-workspace-content]')?.hasAttribute("inert")).toBe(true);
    const back = container.querySelector<HTMLButtonElement>('[data-window-page-header] [aria-label="Back to chat"]')
      ?? page.querySelector<HTMLButtonElement>('[aria-label="Back to chat"], [data-leave-view]')!;
    await act(async () => back.click());
    expect(page.getAttribute("aria-hidden")).toBe("true");
    expect(chat.closest('[data-workspace-content]')?.getAttribute("aria-hidden")).toBe("false");
    expect(container.querySelector('[data-terminal-dock]')).toBe(terminal);
  });

  it.each(["pane", "workspace"])(
    "opens files inside the owning chat with the legacy %s file preference",
    async (legacyMode) => {
      localStorage.setItem("omnicode.fileTabMode", legacyMode);
      await mount();
      await selectSession("recent");
      await click('[data-command="View: Notes"]');
      await click("[data-open-file]");
      expect(activeTabId()).toBe(recentId);
      expect(ownedFileTabs().map((tab) => tab.textContent)).toEqual(["file.ts"]);
      expect(container.querySelector('[data-app-page="notes"]')?.getAttribute("aria-hidden")).toBe("true");
      const editor = workspace(recentId).querySelector(
        '[data-file-editor="/repo/file.ts"]',
      );
      expect(editor).not.toBeNull();
      expect(editor?.getAttribute("data-file-cwd")).toBe("/repo");
      expect(mocks.fileOpen).toHaveBeenCalledWith("/repo", "/repo/file.ts");
      expect(workspace(firstId)).toBeNull();
    },
  );

  it("opens the same file independently in two chats without moving their pages", async () => {
    await mount();
    await click("[data-open-file]");
    const firstEditor = workspace(firstId).querySelector(
      '[data-file-editor="/repo/file.ts"]',
    );
    const firstFileId = ownedFileTabs()[0].dataset.fileTabId;
    await selectSession("recent");
    expect(ownedFileTabs()).toHaveLength(0);
    await click("[data-open-file]");
    expect(activeTabId()).toBe(recentId);
    expect(ownedFileTabs()[0].dataset.fileTabId).not.toBe(firstFileId);
    expect(workspace(firstId).querySelector("[data-file-editor]")).toBe(
      firstEditor,
    );
    expect(workspace(recentId).querySelector("[data-file-editor]")).not.toBe(
      firstEditor,
    );
    await selectSession("first");
    expect(ownedFileTabs()[0].dataset.fileTabId).toBe(firstFileId);
    expect(activeTabId()).toBe(firstId);
  });

  it("retains each chat's source location when both open the same file", async () => {
    const editor = (tabId: string) =>
      workspace(tabId).querySelector<HTMLElement>(
        '[data-file-editor="/repo/file.ts"]',
      )!;
    await mount();
    await click('[data-open-file-line="10"]');
    expect(editor(firstId).dataset.fileNavigationLine).toBe("10");
    expect(editor(firstId).dataset.fileNavigationColumn).toBe("2");
    await selectSession("recent");
    await click('[data-open-file-line="20"]');
    expect(editor(recentId).dataset.fileNavigationLine).toBe("20");
    await selectSession("first");
    expect(editor(firstId).dataset.fileNavigationLine).toBe("10");
    await selectSession("recent");
    expect(editor(recentId).dataset.fileNavigationLine).toBe("20");
    await selectSession("first");
    await clickInWorkspace('[data-close-session="first"]');
    expect(activeTabId()).toBe(recentId);
    await clickInWorkspace('[data-close-session="recent"]');
    expect(activeTabId()).toBe(recentId);
    expect(
      workspace(recentId).querySelector('[data-session="recent"]'),
    ).toBeNull();
    await click("[data-open-file]");
    expect(editor(recentId).dataset.fileNavigationLine).toBeUndefined();
  });

  it("retains a delayed source location in its owning chat while another chat uses the same file", async () => {
    let finishOpen!: (path: string) => void;
    mocks.fileOpen.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishOpen = resolve;
        }),
    );
    const editor = (tabId: string) =>
      workspace(tabId).querySelector<HTMLElement>(
        '[data-file-editor="/repo/file.ts"]',
      )!;
    await mount();
    await click('[data-open-file-line="10"]');
    await selectSession("recent");
    await click('[data-open-file-line="20"]');
    expect(editor(recentId).dataset.fileNavigationLine).toBe("20");
    await act(async () => finishOpen("/repo/file.ts"));
    await act(async () => vi.dynamicImportSettled());
    expect(activeTabId()).toBe(recentId);
    expect(editor(recentId).dataset.fileNavigationLine).toBe("20");
    await selectSession("first");
    expect(editor(firstId).dataset.fileNavigationLine).toBe("10");
    await selectSession("recent");
    expect(editor(recentId).dataset.fileNavigationLine).toBe("20");
  });

  it.each(["file", "diff"])(
    "finishes a pending %s open in its originating chat after switching chats",
    async (surface) => {
      localStorage.setItem("omnicode.diffViewer", "editor");
      let finishOpen!: (path: string) => void;
      const resolver = surface === "file" ? mocks.fileOpen : mocks.diffOpen;
      resolver.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            finishOpen = resolve;
          }),
      );
      await mount();
      await click(
        surface === "file" ? '[data-open-file-line="10"]' : '[data-open-session-diff="first"]',
      );
      await selectSession("recent");
      await act(async () => finishOpen("/repo/file.ts"));
      await act(async () => vi.dynamicImportSettled());
      expect(activeTabId()).toBe(recentId);
      expect(
        workspace(recentId).querySelector("[data-file-editor], [data-session-diff-path]"),
      ).toBeNull();
      await selectSession("first");
      expect(
        workspace(firstId).querySelector(surface === "file"
          ? '[data-file-editor="/repo/file.ts"]'
          : '[data-session-diff-path="/repo/file.ts"]'),
      ).not.toBeNull();
      expect(ownedFileTabs()).toHaveLength(1);
    },
  );

  it.each(["file", "diff"])(
    "preserves a pending %s open instead of replacing its blank chat",
    async (surface) => {
      let finishOpen!: (path: string) => void;
      const resolver = surface === "file" ? mocks.fileOpen : mocks.diffOpen;
      resolver.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            finishOpen = resolve;
          }),
      );
      const replacement = {
        ...newSession("codex", "/repo"),
        id: "replacement",
        blocks: [
          { id: "prompt", role: "user" as const, text: "Existing chat" },
        ],
      };
      const invoke = mocks.invoke.getMockImplementation()!;
      mocks.invoke.mockImplementation((command, args) =>
        command === "session_get" && args.sessionId === replacement.id
          ? Promise.resolve(replacement)
          : invoke(command, args),
      );
      await mount();
      await click(
        surface === "file" ? '[data-open-file-line="10"]' : '[data-open-session-diff="first"]',
      );
      await click('[data-select-session="replacement"]');
      const replacementTab = activeTabId();
      expect(replacementTab).not.toBe(firstId);
      expect(workspace(firstId)).not.toBeNull();
      const composer = workspace().querySelector(
        '[data-session="replacement"]',
      );
      expect(composer).not.toBeNull();
      expect(composer?.getAttribute("data-composer-focused")).toBe("true");
      await act(async () => finishOpen("/repo/file.ts"));
      await act(async () => vi.dynamicImportSettled());
      expect(activeTabId()).toBe(replacementTab);
      expect(ownedFileTabs()).toHaveLength(0);
      expect(
        workspace().querySelector("[data-file-editor], [data-diff-cwd], [data-session-diff-path]"),
      ).toBeNull();
      expect(composer?.getAttribute("data-composer-focused")).toBe("true");
      expect(
        container
          .querySelector("[data-sidebar]")
          ?.getAttribute("data-sidebar-tab"),
      ).toBe("sessions");
      if (surface === "file") {
        await click("[data-open-file]");
        expect(
          workspace().querySelector<HTMLElement>("[data-file-editor]")?.dataset
            .fileNavigationLine,
        ).toBeUndefined();
      }
      await selectSession("first");
      expect(activeTabId()).toBe(firstId);
      expect(ownedFileTabs()).toHaveLength(1);
    },
  );

  it.each(["editor", "unified"])(
    "opens changes inside the current chat beside its Settings tool under the %s diff view",
    async (viewer) => {
      localStorage.setItem("omnicode.diffViewer", viewer);
      mocks.projectBranches.mockReturnValue({ current: "main", detached: false, branches: [] });
      await mount();
      await selectSession("recent");
      await click('[data-command="App: Settings"]');
      await click('[data-command="View: Toggle Changes"]');
      expect(mocks.diffOpen).not.toHaveBeenCalled();
      expect(activeTabId()).toBe(recentId);
      expect(workspace(recentId).querySelector('[data-diff-cwd="/repo"]')).not.toBeNull();
      expect(workspace(firstId)).toBeNull();
    },
  );

  it("retains one Notes page across feature and chat switches, including selecting the current chat", async () => {
    await mount();
    await click("[data-open-notes]");
    await click('[data-app-page="notes"] [data-view-state]');
    await click('[data-command="View: Inbox"]');
    expect(container.querySelector('[data-app-view="notes"]')?.getAttribute("data-focused")).toBe("false");
    await click("[data-open-notes]");
    await selectSession("first");
    expect(container.querySelector('[data-app-page="notes"]')?.getAttribute("aria-hidden")).toBe("true");
    await selectSession("recent");
    await click("[data-open-notes]");
    expect(activeTabId()).toBe(recentId);
    expect(ownedFileTabs()).toHaveLength(0);
    expect(container.querySelector('[data-app-page="notes"] [data-view-state]')?.textContent).toBe("1");
    expect(mocks.viewMounted.mock.calls.filter(([kind]) => kind === "notes")).toHaveLength(1);
    await click('[aria-label="Back to chat"]');
    expect(activeTabId()).toBe(recentId);
  });

  it("keeps Inbox discussions mounted and updates their visibility across page switches", async () => {
    await mount();
    await click('[data-command="View: Inbox"]');
    await click('[data-inbox-ask]');
    const discussion = container.querySelector<HTMLElement>('[data-inbox-discussion-host] [data-session]')!;
    expect(discussion).not.toBeNull();
    expect(discussion.dataset.visible).toBe("true");
    expect(mocks.notificationFocus).toHaveBeenLastCalledWith(discussion.dataset.session);
    await click('[data-command="View: Notes"]');
    expect(container.contains(discussion)).toBe(true);
    expect(discussion.dataset.visible).toBe("false");
    expect(discussion.dataset.surfaceVisible).toBe("false");
    expect(discussion.dataset.composerFocused).toBe("false");
    expect(mocks.notificationFocus).toHaveBeenLastCalledWith(undefined);
    await click('[data-command="View: Inbox"]');
    expect(container.querySelector('[data-inbox-discussion-host] [data-session]')).toBe(discussion);
    expect(discussion.dataset.surfaceVisible).toBe("true");
    await click('[data-inbox-open-session]');
    expect(activeTabId()).toBe(recentId);
    expect(container.querySelector('[data-app-page="inbox"]')?.getAttribute("aria-hidden")).toBe("true");
    expect(mocks.notificationFocus).toHaveBeenLastCalledWith("recent");
  });

  it("Ctrl+W returns from a page without closing its underlying chat", async () => {
    await mount();
    await click('[data-command="View: Notes"]');
    await pressKey("w", true);
    expect(container.querySelector('[data-app-page="notes"]')?.getAttribute("aria-hidden")).toBe("true");
    expect(activeTabId()).toBe(firstId);
    expect(ownedFileTabs()).toHaveLength(0);
    expect(workspace(firstId).querySelector('[data-session="first"]')).not.toBeNull();
  });

  it("Escape closes the real Search dialog and returns to the owning chat", async () => {
    await mount();
    await selectSession("recent");
    await click('[data-command="View: Search Everywhere"]');
    expect(
      document.querySelector("[data-app-view-dialog] [data-app-search]"),
    ).not.toBeNull();
    expect(ownedFileTabs()).toHaveLength(0);
    await pressKey("Escape");
    expect(document.querySelector("[data-app-view-dialog]")).toBeNull();
    expect(activeTabId()).toBe(recentId);
    expect(
      ownedTabs()
        .querySelector('[data-session-chat-tab="recent"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("restores each chat's view mode and selected tool when switching chats", async () => {
    const activeEditorPath = () => workspace()
      .querySelector('[data-file-editor][data-file-active="true"]')
      ?.getAttribute("data-file-editor");
    await mount();
    await click("[data-open-file]");
    expect(
      container
        .querySelector("[data-window-chrome] [data-surface-mode-toggle]")
        ?.getAttribute("aria-label"),
    ).toBe("Enter full view");
    await click("[data-window-chrome] [data-surface-mode-toggle]");
    expect(
      container
        .querySelector("[data-window-chrome] [data-surface-mode-toggle]")
        ?.getAttribute("aria-label"),
    ).toBe("Use split view");
    await selectSession("recent");
    await click("[data-open-file]");
    expect(activeEditorPath()).toBe("/repo/file.ts");
    expect(
      container
        .querySelector("[data-window-chrome] [data-surface-mode-toggle]")
        ?.getAttribute("aria-label"),
    ).toBe("Enter full view");
    await selectSession("first");
    expect(
      container
        .querySelector("[data-window-chrome] [data-surface-mode-toggle]")
        ?.getAttribute("aria-label"),
    ).toBe("Use split view");
    expect(
      workspace().querySelector('[data-file-tab-id] [aria-selected="true"]')
        ?.textContent,
    ).toBe("file.ts");
    await selectSession("recent");
    expect(
      container
        .querySelector("[data-window-chrome] [data-surface-mode-toggle]")
        ?.getAttribute("aria-label"),
    ).toBe("Enter full view");
    expect(activeEditorPath()).toBe("/repo/file.ts");
  });

  it("closes a conversation together with its owned tool pages", async () => {
    await mount();
    await click("[data-open-file]");
    expect(ownedFileTabs()).toHaveLength(1);
    await clickInWorkspace('[data-session-chat-tab="first"]');
    await pressKey("w", true);
    expect(workspace(firstId)).toBeNull();
    expect(activeTabId()).toBe(recentId);
    expect(ownedFileTabs()).toHaveLength(0);
    expect(container.querySelector('[data-app-view="notes"]')).toBeNull();
    expect(container.querySelector("[data-file-editor]")).toBeNull();
    expect(
      workspace(recentId).querySelector('[data-session="recent"]'),
    ).not.toBeNull();
  });

  it.each(["close-pane", "close-all"])(
    "keeps the current project after %s closes the sole app tab",
    async (action) => {
      await mount(true);
      expect(
        container.querySelector('[data-app-view="settings"]'),
      ).not.toBeNull();
      if (action === "close-pane") {
        await act(async () =>
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "w",
              code: "KeyW",
              ctrlKey: true,
              bubbles: true,
              cancelable: true,
            }),
          ),
        );
      } else {
        await click('[data-command="Tab: Close All"]');
      }
      expect(container.querySelector('[data-app-view="settings"]')).toBeNull();
      expect(
        container.querySelector('[data-session-cwd="/repo"]'),
      ).not.toBeNull();
      expect(ownedFileTabs()).toHaveLength(0);
      expect(container.querySelector('[data-sidebar="/repo"]')).not.toBeNull();
    },
  );
});

describe("Workflow agent navigation", () => {
  it.each([false, true])("opens beside the run and reuses agents (detached run: %s)", async (detached) => {
    const parent = { ...newSession("codex", "/repo"), id: "parent" };
    const parentTab = newTab(parent.id);
    const run = newWorkflowRunTab("Network probe", "/repo", {
      parentSessionId: parent.id,
      runId: "run",
    });
    const trailing = newFileTab("/repo/trailing.ts", "/repo");
    let sourceTab = detached
      ? newEditorWorkspaceTab(run)
      : openEditorTab(parentTab, run);
    sourceTab = openEditorTab(sourceTab, trailing, { pin: true });
    sourceTab = openEditorTab(sourceTab, run);
    // Reproduce tabs created before workflows stopped being previews.
    sourceTab.editorPanes[0].files[0] = { ...run, preview: true };
    await act(async () => root.render(createElement(App, {
      resumed: {
        sessions: [parent],
        tabs: detached ? [parentTab, sourceTab] : [sourceTab],
        activeTabId: sourceTab.id,
        projectCwd: "/repo",
        projectReturnMemory: new Map(),
        projectTerminals: [],
      },
    })));
    await act(async () => vi.dynamicImportSettled());

    await click('[data-open-workflow-agent="worker-a"]');
    expect(activeTabId()).toBe(sourceTab.id);
    let files = ownedFileTabs();
    expect(files).toHaveLength(3);
    expect(files[0].dataset.fileTabId).toBe(run.id);
    expect(files[1].textContent).toContain("worker-a");
    expect(files[1].querySelector('[role="tab"]')?.getAttribute("aria-selected")).toBe("true");
    expect(files[2].dataset.fileTabId).toBe(trailing.id);
    const firstWorkerId = files[1].dataset.fileTabId;

    await click(`[data-file-tab-id="${run.id}"] [role="tab"]`);
    await click('[data-open-workflow-agent="worker-b"]');
    files = ownedFileTabs();
    expect(files.map((file) => file.dataset.fileTabId)).toEqual([
      run.id, expect.any(String), firstWorkerId, trailing.id,
    ]);
    expect(files[1].textContent).toContain("worker-b");
    const order = files.map((file) => file.dataset.fileTabId);

    await click(`[data-file-tab-id="${run.id}"] [role="tab"]`);
    await click('[data-open-workflow-agent="worker-a"]');
    expect(ownedFileTabs().map((file) => file.dataset.fileTabId)).toEqual(order);
    expect(ownedFileTabs()[2].querySelector('[role="tab"]')?.getAttribute("aria-selected")).toBe("true");
    expect(workspace().querySelectorAll('[data-workflow-run-tab]')).toHaveLength(1);
  });
});

describe("Workflow create in chat", () => {
  it.each(["/repo", "/project-b"])(
    "inserts into the focused composer in %s without saving a draft message",
    async (cwd) => {
      await mount();
      await click('[data-command="View: Workflows"]');
      const inserts: { request: AddToChatRequest; cwd?: string; focused?: string }[] = [];
      const onInsert = (event: Event) => {
        const pane = workspace().querySelector<HTMLElement>('[data-session][data-visible="true"]');
        inserts.push({
          request: (event as CustomEvent<AddToChatRequest>).detail,
          cwd: pane?.dataset.sessionCwd,
          focused: pane?.dataset.composerFocused,
        });
      };
      window.addEventListener(ADD_TO_CHAT_EVENT, onInsert);
      try {
        await click(`[data-create-workflow="${cwd}"]`);
        expect(inserts).toEqual([{
          request: { text: "Help me design a workflow", mode: "plain" },
          cwd,
          focused: "true",
        }]);
        expect(container.querySelector('[data-app-page="workflows"]')?.getAttribute("aria-hidden")).toBe("true");
        expect(workspace().querySelector('[data-session]')?.getAttribute("data-session-block-count")).toBe("0");
        expect(container.querySelectorAll('[data-session]')).toHaveLength(2);
        if (cwd === "/repo") expect(activeTabId()).toBe(firstId);
      } finally {
        window.removeEventListener(ADD_TO_CHAT_EVENT, onInsert);
      }
    },
  );
});

describe("App multi-project history", () => {
  it("discards a removed project's pending history and starts a fresh read when re-added", async () => {
    let finishOld!: (rows: unknown[]) => void;
    const oldRead = new Promise<unknown[]>((resolve) => {
      finishOld = resolve;
    });
    let reads = 0;
    const summary = (id: string) => ({
      ...newSession("codex", "/project-a"),
      id,
      title: id,
      createdAt: 1,
      updatedAt: 2,
    });
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === "session_list_by_project" && args.cwd === "/project-a") {
        reads++;
        return reads === 1 ? oldRead : [summary("fresh-chat")];
      }
      return [];
    });
    await mount();
    await click('[data-load-project="/project-a"]');
    await click('[data-remove-project="/project-a"]');
    await click('[data-load-project="/project-a"]');
    await act(async () => finishOld([summary("stale-chat")]));
    // Purging also lists stored chats; the reopened branch makes its own read.
    expect(reads).toBe(3);
    expect(
      container.querySelector('[data-open-history="fresh-chat"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-open-history="stale-chat"]'),
    ).toBeNull();
    await click('[data-remove-project="/project-a"]');
    expect(
      container.querySelector('[data-history-project="/project-a"]'),
    ).toBeNull();
    expect(
      container
        .querySelector("[data-sidebar]")
        ?.getAttribute("data-loaded-projects"),
    ).not.toContain("/project-a");
  });

  it("loads inactive projects independently and retains both after out-of-order responses", async () => {
    let finishA!: (rows: unknown[]) => void;
    let finishB!: (rows: unknown[]) => void;
    const a = new Promise<unknown[]>((resolve) => {
      finishA = resolve;
    });
    const b = new Promise<unknown[]>((resolve) => {
      finishB = resolve;
    });
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === "session_list_by_project") {
        if (args.cwd === "/project-a") return a;
        if (args.cwd === "/project-b") return b;
      }
      return [];
    });
    await mount();
    await click('[data-load-project="/project-a"]');
    await click('[data-load-project="/project-a"]');
    await click('[data-load-project="/project-b"]');
    const summary = (id: string, cwd: string) => ({
      ...newSession("codex", cwd),
      id,
      title: id,
      createdAt: 1,
      updatedAt: 2,
    });
    await act(async () => finishB([summary("b", "/project-b")]));
    await act(async () => finishA([summary("a", "/project-a")]));
    expect(
      container.querySelector('[data-history-project="/project-a"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-history-project="/project-b"]'),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-sidebar]")?.getAttribute("data-sidebar"),
    ).toBe("/repo");
    expect(
      mocks.invoke.mock.calls.filter(
        ([command, args]) =>
          command === "session_list_by_project" && args.cwd === "/project-a",
      ),
    ).toHaveLength(1);
  });

  it("keeps a failed project isolated and clears its error after retry", async () => {
    let fail = true;
    mocks.invoke.mockImplementation(async (command, args) => {
      if (
        command === "session_list_by_project" &&
        args.cwd === "/project-a" &&
        fail
      )
        throw new Error("unavailable");
      return [];
    });
    await mount();
    await click('[data-load-project="/project-a"]');
    await click('[data-load-project="/project-b"]');
    expect(
      container
        .querySelector("[data-sidebar]")
        ?.getAttribute("data-failed-projects"),
    ).toBe("/project-a");
    expect(
      container
        .querySelector("[data-sidebar]")
        ?.getAttribute("data-loaded-projects"),
    ).toContain("/project-b");
    fail = false;
    await click('[data-load-project="/project-a"]');
    expect(
      container
        .querySelector("[data-sidebar]")
        ?.getAttribute("data-failed-projects"),
    ).toBe("");
    expect(
      container
        .querySelector("[data-sidebar]")
        ?.getAttribute("data-loaded-projects"),
    ).toContain("/project-a");
  });

  it("renames and refreshes an inactive project's summary", async () => {
    let row = {
      ...newSession("codex", "/project-b"),
      id: "inactive-chat",
      blocks: [
        { id: "prompt", role: "user" as const, text: "Work on this project" },
      ],
      title: "Original",
      createdAt: 1,
      updatedAt: 2,
    };
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === "session_list_by_project")
        return args.cwd === "/project-b" ? [row] : [];
      if (command === "session_get") return row;
      if (command === "session_upsert") {
        row = { ...row, ...args.session };
        return row;
      }
      return [];
    });
    await mount();
    await click('[data-load-project="/project-b"]');
    await click('[data-rename-history="inactive-chat"]');
    expect(
      container
        .querySelector('[data-history-project="/project-b"]')
        ?.getAttribute("data-history-title"),
    ).toContain("Renamed");
    expect(container.querySelector('[data-sidebar="/repo"]')).not.toBeNull();
    expect(
      mocks.invoke.mock.calls.filter(
        ([command, args]) =>
          command === "session_list_by_project" && args.cwd === "/project-b",
      ),
    ).toHaveLength(2);
    expect(
      mocks.invoke.mock.calls.filter(
        ([command, args]) =>
          command === "session_list_by_project" && args.cwd === "/repo",
      ),
    ).toHaveLength(1);
  });

  it("preserves a newer canonical rename when an alias history read finishes", async () => {
    let finishAlias!: (rows: unknown[]) => void;
    const aliasRead = new Promise<unknown[]>((resolve) => {
      finishAlias = resolve;
    });
    let row = {
      ...newSession("codex", "/project-b"),
      id: "inactive-chat",
      blocks: [
        { id: "prompt", role: "user" as const, text: "Work on this project" },
      ],
      title: "Original",
      createdAt: 1,
      updatedAt: 2,
    };
    const staleRow = { ...row };
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === "session_list_by_project") {
        if (args.cwd === "/project-a") return aliasRead;
        if (args.cwd === "/project-b") return [row];
      }
      if (command === "session_get") return row;
      if (command === "session_upsert") {
        row = { ...row, ...args.session, updatedAt: Date.now() };
        return row;
      }
      return [];
    });
    await mount();
    await click('[data-load-project="/project-b"]');
    await click('[data-load-project="/project-a"]');
    await click('[data-rename-history="inactive-chat"]');
    expect(row.title).toContain("Renamed");
    expect(
      mocks.invoke.mock.calls.filter(
        ([command, args]) =>
          command === "session_list_by_project" && args.cwd === "/project-b",
      ),
    ).toHaveLength(2);

    await act(async () => finishAlias([staleRow]));
    const historyRows = container.querySelectorAll(
      '[data-open-history="inactive-chat"]',
    );
    expect(historyRows).toHaveLength(1);
    expect(historyRows[0].textContent).toBe(row.title);
  });

  it("creates and focuses a distinct chat on every project new-session click", async () => {
    await mount();
    await click('[data-new-project-session="/project-b"]');
    const firstDraftTab = activeTabId();
    const firstDraftId = workspace().querySelector<HTMLElement>(
      '[data-session-cwd="/project-b"]',
    )!.dataset.session;
    expect(container.querySelector('[data-sidebar]')?.getAttribute("data-open-sessions"))
      .not.toContain(firstDraftId);
    expect(container.querySelector(`[data-open-history="${firstDraftId}"]`)).toBeNull();
    expect(mocks.invoke.mock.calls.some(([command, args]) =>
      command === "session_upsert" && args.session.id === firstDraftId,
    )).toBe(false);

    // An untouched draft must not turn the explicit create action into a no-op.
    await click('[data-new-project-session="/project-b"]');
    expect(activeTabId()).not.toBe(firstDraftTab);
    const secondDraftId = workspace().querySelector<HTMLElement>(
      '[data-session-cwd="/project-b"]',
    )!.dataset.session;
    expect(secondDraftId).not.toBe(firstDraftId);
    expect(container.querySelector('[data-sidebar]')?.getAttribute("data-open-sessions"))
      .not.toContain(secondDraftId);
    expect(workspace(firstDraftTab)).toBeNull();
    expect(
      container.querySelector('[data-sidebar]')?.getAttribute("data-active-session"),
    ).toBe(secondDraftId);

    // Creating from another project must not reactivate either old draft.
    await selectSession("recent");
    await click('[data-new-project-session="/project-b"]');
    const thirdDraftId = workspace().querySelector<HTMLElement>(
      '[data-session-cwd="/project-b"]',
    )!.dataset.session;
    expect([firstDraftId, secondDraftId]).not.toContain(thirdDraftId);
  });

  it("creates a chat in an inactive project's remembered worktree", async () => {
    const { setWorktreeFocus } =
      await import("../features/source-control/model/worktreeFocus");
    setWorktreeFocus("/project-b", {
      path: "/project-b-worktree",
      branch: "feature",
    });
    await mount();
    await click('[data-new-project-session="/project-b"]');
    expect(
      container.querySelector('[data-sidebar="/project-b"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-session-cwd="/project-b"][data-session-worktree="/project-b-worktree"][data-session-branch="feature"]',
      ),
    ).not.toBeNull();
    await act(async () => setWorktreeFocus("/project-b", undefined));
  });

  it.each(["text", "whitespace", "attachment", "reading"])(
    "keeps an unsent %s draft on navigation and cleans it only after clearing and leaving again",
    async (kind) => {
      await mount();
      let finishRead: (() => void) | undefined;
      if (kind === "text") setComposerDraft("first", "Keep my prompt");
      if (kind === "whitespace") setComposerDraft("first", "  \n");
      if (kind === "attachment") setComposerAttachmentCount("first", 1);
      if (kind === "reading") finishRead = beginComposerAttachmentRead("first");
      await selectSession("recent");
      expect(workspace(firstId)).not.toBeNull();
      await selectSession("first");
      expect(activeTabId()).toBe(firstId);
      if (kind === "text") expect(getComposerDraft("first")).toBe("Keep my prompt");
      if (kind === "whitespace") expect(getComposerDraft("first")).toBe("  \n");
      finishRead?.();
      clearComposerDraft("first");
      await click('[data-new-project-session="/project-b"]');
      expect(workspace(firstId)).toBeNull();
      expect(container.querySelector('[data-sidebar]')?.getAttribute("data-sidebar")).toBe("/project-b");
    },
  );

  it.each(["/project-b", "wsl://Ubuntu/home/dev/project"])(
    "keeps the same unsent composer and its content when its folder changes to %s",
    async (cwd) => {
      await mount(false, "bottom", {
        branch: "old-branch", executionCwd: "/repo-old-worktree",
        workspaceMode: "worktree", worktreeBase: "old-base",
      });
      setComposerDraft("first", "Keep my prompt");
      setComposerAttachmentCount("first", 1);
      const finishRead = beginComposerAttachmentRead("first");
      try {
        const { rememberRemotePendingExecutionCwd, remotePendingExecutionCwd } =
          await import("../features/connections/model/connections");
        rememberRemotePendingExecutionCwd("first", "/repo-old-worktree");
        const pane = mocks.paneRendered.mock.calls.map(([props]) => props as SessionPaneProps)
          .filter((props) => props.session.id === "first").at(-1)!;
        await act(async () => pane.onCwdChange("first", cwd));
        expect(activeTabId()).toBe(firstId);
        expect(workspace(firstId).querySelector('[data-session="first"]')?.getAttribute("data-session-cwd")).toBe(cwd);
        expect(getComposerDraft("first")).toBe("Keep my prompt");
        const moved = mocks.paneRendered.mock.calls.map(([props]) => props as SessionPaneProps)
          .filter((props) => props.session.id === "first").at(-1)!.session;
        expect(moved.branch).toBeUndefined();
        expect(moved.executionCwd).toBeUndefined();
        expect(remotePendingExecutionCwd("first")).toBeUndefined();
        expect(moved.workspaceMode).toBeUndefined();
        expect(moved.worktreeBase).toBeUndefined();
      } finally {
        finishRead();
        clearComposerDraft("first");
      }
    },
  );

  it("keeps a started conversation bound to its project when its composer selects a folder", async () => {
    await mount(false, "bottom", { blocks: [{ id: "sent", role: "user", text: "Earlier work" }] });
    const pane = mocks.paneRendered.mock.calls.map(([props]) => props as SessionPaneProps)
      .filter((props) => props.session.id === "first").at(-1)!;
    await act(async () => pane.onCwdChange("first", "/project-b"));
    expect(activeTabId()).not.toBe(firstId);
    expect(workspace(firstId).querySelector('[data-session="first"]')?.getAttribute("data-session-cwd")).toBe("/repo");
    expect(workspace().querySelector('[data-session]')?.getAttribute("data-session-cwd")).toBe("/project-b");
  });

  it("keeps an unsent draft in its original project when selecting a different project", async () => {
    await mount();
    setComposerDraft("first", "Keep this in repo");
    await click('[data-select-project="/project-b"]');
    expect(activeTabId()).not.toBe(firstId);
    expect(workspace(firstId).querySelector('[data-session="first"]')?.getAttribute("data-session-cwd")).toBe("/repo");
    expect(workspace().querySelector('[data-session]')?.getAttribute("data-session-cwd")).toBe("/project-b");
    expect(getComposerDraft("first")).toBe("Keep this in repo");
  });

  it("focuses a newly created project selected again in a folder batch and leaves the page", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    await mount();
    setComposerDraft("first", "Keep this in repo");
    await click('[data-command="View: Notes"]');
    vi.mocked(open).mockResolvedValueOnce(["/project-a", "/project-b", "/project-a"]);
    await click('[data-command="App: Open Project"]');
    expect(container.querySelector('[data-app-page="notes"]')?.getAttribute("aria-hidden")).toBe("true");
    expect(workspace().querySelector('[data-session]')?.getAttribute("data-session-cwd")).toBe("/project-a");
    expect(container.querySelectorAll('[data-session-cwd="/project-a"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-session-cwd="/project-b"]')).toHaveLength(1);
    expect(getComposerDraft("first")).toBe("Keep this in repo");
    expect(workspace(firstId).querySelector('[data-session="first"]')?.getAttribute("data-session-cwd")).toBe("/repo");
  });

  it("keeps the current page and draft when the folder picker is dismissed", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    await mount();
    setComposerDraft("first", "Keep my prompt");
    await click('[data-command="View: Notes"]');
    vi.mocked(open).mockResolvedValueOnce(null);
    await click('[data-command="App: Open Project"]');
    expect(container.querySelector('[data-app-page="notes"]')?.getAttribute("aria-hidden")).toBe("false");
    expect(activeTabId()).toBe(firstId);
    expect(getComposerDraft("first")).toBe("Keep my prompt");
    expect(container.querySelectorAll('[data-workspace-tab]')).toHaveLength(2);
  });

  it("protects a pinned blank before its persistence finishes", async () => {
    let finishPin!: () => void;
    const invoke = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args) =>
      command === "session_set_pinned"
        ? new Promise<void>((resolve) => { finishPin = resolve; })
        : invoke(command, args),
    );
    await mount();
    await click("[data-pin-first]");
    await selectSession("recent");
    expect(workspace(firstId)).not.toBeNull();
    await act(async () => finishPin());
  });

  it("does not replace an unsent prompt when opening a stored conversation", async () => {
    const replacement = {
      ...newSession("codex", "/repo"),
      id: "replacement",
      blocks: [{ id: "prompt", role: "user" as const, text: "Existing chat" }],
    };
    const invoke = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args) =>
      command === "session_get" && args.sessionId === replacement.id
        ? Promise.resolve(replacement)
        : invoke(command, args),
    );
    await mount();
    setComposerDraft("first", "Unsent prompt");
    await click('[data-select-session="replacement"]');
    expect(activeTabId()).not.toBe(firstId);
    expect(workspace(firstId)).not.toBeNull();
    expect(getComposerDraft("first")).toBe("Unsent prompt");
  });

  it("keeps a blank conversation behind tools, then removes it when another chat is opened", async () => {
    await mount();
    await clickDesktopNavigation("Bots");
    expect(workspace(firstId)).not.toBeNull();
    await click('[data-new-project-session="/project-b"]');
    expect(workspace(firstId)).toBeNull();
    // A restored background blank was never visited and is not swept away.
    expect(workspace(recentId)).not.toBeNull();
  });

  it("does not reuse the previous project's keyboard order when the new branch is collapsed", async () => {
    await mount();
    await click("[data-publish-navigation]");
    await click('[data-new-project-session="/project-b"]');
    const activeTab = activeTabId();
    await click('[data-command="Session: Next"]');
    expect(activeTabId()).toBe(activeTab);
    expect(
      container.querySelector('[data-sidebar="/project-b"]'),
    ).not.toBeNull();
  });

  it("keeps equal remote session ids in different projects in separate tabs", async () => {
    await mount();
    await click('[data-open-remote-project="remote://host/project-a"]');
    const aTab = activeTabId();
    await click('[data-open-remote-project="remote://host/project-b"]');
    expect(activeTabId()).not.toBe(aTab);
    expect(
      container.querySelector('[data-session-cwd="remote://host/project-a"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-session-cwd="remote://host/project-b"]'),
    ).not.toBeNull();
    await click('[data-delete-remote-project="remote://host/project-b"]');
    expect(
      container.querySelector('[data-session-cwd="remote://host/project-a"]'),
    ).not.toBeNull();
    await click('[data-open-remote-project="remote://host/project-a"]');
    expect(activeTabId()).toBe(aTab);
  });
});
