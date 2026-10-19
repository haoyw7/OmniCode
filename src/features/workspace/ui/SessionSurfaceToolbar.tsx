import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import {
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  Folder,
  IconArtworkContext,
  Maximize2,
  MessageSquare,
  PanelRight,
  SquareMenu,
  Terminal,
  X,
} from "../../../shared/ui/icons";
import {
  saveStatusCardsVisible,
  useStatusCardsVisible,
} from "../../sessions/model/statusCardOrder";
import {
  sessionDisplayTitle,
  type Session,
} from "../../sessions/model/session";
import { useShortcutLabel } from "../../../app/commands/useCommandShortcut";
import type { EditorPane, FilePaneTab } from "../model/layout";
import { SurfaceTabs } from "./SurfaceTabs";
import { windowDragRegion } from "../../../app/shell/startWindowDrag";
import { WindowNavigationSpace } from "../../../app/shell/WindowChrome";
import { SessionRenamePopover } from "./SessionTitleMenu";
import { SessionOverflowMenu } from "./SessionOverflowMenu";
import { useSessionHeaderActions } from "./SessionHeaderActions";
import { SessionWorktreeIcon } from "../../sessions/ui/SessionWorktreeIcon";
import { hasSessionUsage, usageSessionFor } from "../../providers/model/sessionUsage";

export type SessionSurfaceMode = "split" | "unified";

/** Match the window toolbar's square silhouettes without resizing tool buttons. */
const sessionToolIconArtwork = {
  SquareMenu: (
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" strokeWidth="1.5" />
      <path d="M8 8h8M8 12h8M8 16h8" strokeWidth="1.5" />
    </g>
  ),
  Terminal: (
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" strokeWidth="1.5" />
      <path d="m8 9 3 3-3 3m5 0h3" strokeWidth="1.5" />
    </g>
  ),
  Folder: (
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h5l2 3h5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" strokeWidth="1.5" />
    </g>
  ),
};

export function SessionSurfaceActions({
  mode,
  onModeChange,
  windowControls,
}: {
  mode: SessionSurfaceMode;
  onModeChange?: (mode: SessionSurfaceMode) => void;
  windowControls?: ReactNode;
}) {
  const { t } = useTranslation();
  const modeLabel =
    mode === "split" ? t("Enter full view") : t("Use split view");
  return (
    <div className="flex shrink-0 items-stretch">
      {onModeChange ? (
        <button
          type="button"
          data-surface-mode-toggle
          data-tauri-drag-region="false"
          aria-label={modeLabel}
          title={modeLabel}
          onClick={() => onModeChange(mode === "split" ? "unified" : "split")}
          className="mr-1 grid size-7.5 shrink-0 self-center place-items-center rounded-md text-content/60 hover:bg-content/3 hover:text-content"
        >
          {mode === "split" ? (
            <Maximize2 className="size-4" />
          ) : (
            <PanelRight className="size-4" />
          )}
        </button>
      ) : null}
      {windowControls}
    </div>
  );
}

export function SessionSurfaceToolbar({
  session,
  panes,
  focusedId,
  showTools,
  dirtyFileIds,
  fileErrorCounts,
  onFocus,
  onSelectFile,
  onCloseFile,
  onCloseOtherFiles,
  onPinFile,
  onReorderFiles,
  windowControls,
  reserveWindowNavigationSpace = false,
  onPaneDragStart,
  onClosePane,
  paneFocused,
  tools = true,
}: {
  session: Session;
  panes: EditorPane[];
  focusedId: string;
  showTools: boolean;
  dirtyFileIds: Set<string>;
  fileErrorCounts: Map<string, number>;
  onFocus: (paneId: string) => void;
  onSelectFile: (paneId: string, fileId: string) => void;
  onCloseFile: (paneId: string, fileId: string) => void;
  onCloseOtherFiles: (paneId: string, fileId: string) => void;
  onPinFile?: (fileId: string) => void;
  onReorderFiles: (paneId: string, ids: string[]) => void;
  windowControls?: ReactNode;
  reserveWindowNavigationSpace?: boolean;
  onPaneDragStart?: (event: ReactPointerEvent<HTMLElement>) => void;
  onClosePane?: () => void;
  paneFocused?: boolean;
  /** False when the window's top bar carries this chat's tool toggles. */
  tools?: boolean;
}) {
  const { t } = useTranslation();
  const closePaneLabel = useShortcutLabel("Close Pane", "Pane: Close");
  const actions = useSessionHeaderActions();
  const [renameAnchor, setRenameAnchor] = useState<HTMLElement | null>(null);
  const files = showTools ? panes.flatMap((pane) => pane.files.length > 1 ? pane.files.filter((file) => !file.explorer) : pane.files) : [];
  const owner = (fileId: string) =>
    panes.find((pane) => pane.files.some((file) => file.id === fileId));
  const withOwner = (
    fileId: string,
    action: (paneId: string, fileId: string) => void,
  ) => {
    const pane = owner(fileId);
    if (pane) action(pane.id, fileId);
  };
  const activeFileId =
    panes.find((pane) => pane.id === focusedId)?.activeFileId ?? "";
  const chatActive = !showTools || focusedId === session.id;
  const title = sessionDisplayTitle(session.title, session.harness).trim();

  return (
    <div
      data-session-surface-tabs={session.id}
      data-session-empty={session.blocks.length === 0 || undefined}
      {...windowDragRegion()}
      className="min-w-0 shrink-0"
    >
      <SurfaceTabs
        files={files}
        activeFileId={chatActive ? "" : activeFileId}
        dirtyFileIds={dirtyFileIds}
        fileErrorCounts={fileErrorCounts}
        label={t("Session tabs")}
        onPaneDragStart={onPaneDragStart}
        leading={
          <>
            {reserveWindowNavigationSpace ? <WindowNavigationSpace /> : null}
            {/* Shrinks before the strip scrolls: the title truncates and the
                close button stays at the visible right edge. */}
            <div className="relative flex h-full min-w-20 max-w-56 shrink items-center">
              <button
                type="button"
                role="tab"
                data-tauri-drag-region="false"
                data-session-chat-tab={session.id}
                data-closable={onClosePane ? true : undefined}
                aria-selected={chatActive}
                title={title || t("Chat")}
                onClick={() => onFocus(session.id)}
                onDoubleClick={
                  actions
                    ? (event) => setRenameAnchor(event.currentTarget)
                    : undefined
                }
                className={`surface-tab flex h-7 min-w-0 flex-1 items-center gap-1.5 self-center px-2 text-ui-caption ${onClosePane ? "pr-7" : ""}`}
              >
                {/* The focus dot badges the icon instead of taking a slot,
                    so unfocused tabs keep the title next to the icon. */}
                <span className="relative grid shrink-0 place-items-center">
                  <MessageSquare className="size-3.5" />
                  {paneFocused ? (
                    <span
                      data-pane-focus-dot
                      className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-accent"
                    />
                  ) : null}
                </span>
                <span className="truncate">{title || t("Chat")}</span>
                <SessionWorktreeIcon session={session} />
              </button>
              {onClosePane ? (
                <button
                  type="button"
                  data-no-drag
                  data-tauri-drag-region="false"
                  title={closePaneLabel}
                  aria-label={t("Close {value0}", {
                    value0: title || t("Chat"),
                  })}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClosePane();
                  }}
                  className="absolute right-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-content/50 hover:bg-content/6 hover:text-content"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
          </>
        }
        onSelectFile={(fileId) => withOwner(fileId, onSelectFile)}
        onCloseFile={(fileId) => withOwner(fileId, onCloseFile)}
        onCloseOtherFiles={(fileId) => {
          const pane = owner(fileId);
          if (!pane) return;
          onCloseOtherFiles(pane.id, fileId);
        }}
        onPinFile={onPinFile}
        onReorder={(ids) => {
          for (const pane of panes) {
            const owned = new Set(
              pane.files.map((file: FilePaneTab) => file.id),
            );
            onReorderFiles(
              pane.id,
              ids.filter((id) => owned.has(id)),
            );
          }
        }}
        trailing={
          <>
            {tools ? (
              <>
                <SessionToolToggles session={session} />
                <SessionOverflowMenu session={session} onRename={setRenameAnchor} />
              </>
            ) : null}
            {windowControls}
          </>
        }
      />
      <PresenceBoundary propagate>{renameAnchor ? (
        <SessionRenamePopover
          key={session.id}
          sessionId={session.id}
          title={title}
          anchor={renameAnchor}
          onClose={() => setRenameAnchor(null)}
        />
      ) : null}</PresenceBoundary>
    </div>
  );
}

/**
 * A chat's tool toggles and overflow menu on their own, for the window's top
 * bar while full view puts the chat's tabs in the pane.
 */
export function SessionHeaderTools({ session }: { session: Session }) {
  const [renameAnchor, setRenameAnchor] = useState<HTMLElement | null>(null);
  const title = sessionDisplayTitle(session.title, session.harness).trim();
  return (
    <div
      data-session-header-tools={session.id}
      {...windowDragRegion()}
      className="flex h-full min-w-0 items-center justify-end"
    >
      <SessionToolToggles session={session} />
      <SessionOverflowMenu session={session} onRename={setRenameAnchor} />
      <PresenceBoundary propagate>{renameAnchor ? (
        <SessionRenamePopover
          key={session.id}
          sessionId={session.id}
          title={title}
          anchor={renameAnchor}
          onClose={() => setRenameAnchor(null)}
        />
      ) : null}</PresenceBoundary>
    </div>
  );
}

/** Compact status-card, terminal and working-files switches beside the session title. */
function SessionToolToggles({ session }: { session: Session }) {
  const { t } = useTranslation();
  const actions = useSessionHeaderActions();
  const statusVisible = useStatusCardsVisible();
  if (!actions) return null;
  const filesOpen = !!actions.filesSessionIds?.has(session.id);
  const terminalOpen = !!actions.terminalSessionIds?.has(session.id);
  const button = (active: boolean) =>
    `mr-1 grid size-7.5 shrink-0 self-center place-items-center rounded-md hover:bg-content/3 hover:text-content ${
      active ? "bg-content/8 text-content" : "text-content/60"
    }`;
  return (
    <IconArtworkContext.Provider value={sessionToolIconArtwork}>
      <div className="flex shrink-0 items-stretch">
        {/* Account usage stays accessible before the first message. */}
        {session.blocks.length || hasSessionUsage(usageSessionFor(session)) ? (
          <>
            <button
              type="button"
              data-session-tool-toggle="status"
              data-tauri-drag-region="false"
              aria-label={t("Status")}
              aria-pressed={statusVisible}
              title={t("Status")}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => saveStatusCardsVisible(!statusVisible)}
              className={button(statusVisible)}
            >
              <SquareMenu className="size-4" />
            </button>
            <span aria-hidden="true" className="mr-1 h-4 w-px shrink-0 self-center bg-content/12" />
          </>
        ) : null}
        {actions.terminalAvailable ? (
          <button
            type="button"
            data-session-tool-toggle="terminal"
            data-tauri-drag-region="false"
            aria-label={t("Terminal")}
            aria-pressed={terminalOpen}
            title={t("Terminal")}
            onClick={() => actions.toggleTerminal(session.id)}
            className={button(terminalOpen)}
          >
            <Terminal className="size-4" />
          </button>
        ) : null}
        {actions.toggleFiles && session.cwd && session.cwd !== "~" ? (
          <button
            type="button"
            data-session-tool-toggle="files"
            data-tauri-drag-region="false"
            aria-label={t("Files")}
            aria-pressed={filesOpen}
            title={t("Files")}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => actions.toggleFiles?.(session.id)}
            className={button(filesOpen)}
          >
            <Folder className="size-4" />
          </button>
        ) : null}
      </div>
    </IconArtworkContext.Provider>
  );
}
