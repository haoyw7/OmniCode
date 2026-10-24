import { windowDragRegion } from "./startWindowDrag";
import { PresenceBoundary } from "../../shared/ui/PresenceBoundary";
import { useEffect, useRef, useState } from "react";
import { ArrowDownCircle, Inbox, Loader, Search, Settings, StickyNote, Workflow, Zap, type IconComponent } from "../../shared/ui/icons";
import { useTranslation } from "../../shared/i18n/useTranslation";
import { useCommandShortcut, useShortcutLabel } from "../commands/useCommandShortcut";
import { useSurfaceVisibility } from "../../shared/ui/SurfaceVisibility";
import { Popover } from "../../shared/ui/Popover";
import { IconButton } from "../../shared/ui/forms/IconButton";
import { useHoverSummary } from "../../shared/ui/HoverSummary";
import { collectRailProjects, type RecentProject } from "../../features/projects/model/recents";
import { InboxNotificationMenu } from "../../features/inbox/ui/InboxNotificationMenu";
import type { InstalledUpdate } from "../model/updateNotice";
import { UpdateAvailableDialog } from "./UpdateAvailableDialog";
import { UpdateRailCard } from "./UpdateRailCard";
import { UpdateNotesPopover } from "./UpdateNotesPopover";
import type { UpdateStatus } from "./useUpdateStatus";

/**
 * `rail` is the compact strip shown while the sidebar is collapsed. With the
 * sidebar open, the same destinations render as ZCode-style rows: the
 * navigation block at the top and the account/updates block at the bottom.
 */
export type ActivityBarLayout =
  | "rail"
  | "sidebar-top"
  | "sidebar-footer"
  | "titlebar";

export type ActivityBarProps = {
  layout?: ActivityBarLayout;
  chromeInMenuBar?: boolean;
  cwd: string;
  recents: RecentProject[];
  onSearch?: () => void;
  onOpenInbox?: () => void;
  onOpenNotes?: () => void;
  onOpenAutomations?: () => void;
  onOpenWorkflows?: () => void;
  onOpenSettings?: () => void;
  onOpenNotificationSettings?: (projectPath?: string) => void;
  searchActive?: boolean;
  inboxActive?: boolean;
  notesActive?: boolean;
  automationsActive?: boolean;
  workflowsActive?: boolean;
  settingsActive?: boolean;
  notesEnabled?: boolean;
  inboxUnseen?: boolean;
  updateStatus?: UpdateStatus;
  updateNotice?: InstalledUpdate | null;
  onOpenWhatsNew?: (version: string) => void;
  onDismissUpdate?: () => void;
};

/** Window-wide destinations stay available beside every workspace pane. */
export function ActivityBar({
  layout = "rail",
  chromeInMenuBar = false,
  cwd,
  recents,
  onSearch,
  onOpenInbox,
  onOpenNotes,
  onOpenAutomations,
  onOpenWorkflows,
  onOpenSettings,
  onOpenNotificationSettings,
  searchActive = false,
  inboxActive = false,
  notesActive = false,
  automationsActive = false,
  workflowsActive = false,
  settingsActive = false,
  notesEnabled = true,
  inboxUnseen = false,
  updateStatus,
  updateNotice,
  onOpenWhatsNew,
  onDismissUpdate,
}: ActivityBarProps) {
  const { t } = useTranslation();
  const horizontal = layout === "titlebar";
  const visible = useSurfaceVisibility();
  const row = layout !== "rail";
  const showTop = layout !== "sidebar-footer";
  const showBottom = layout !== "sidebar-top" && !horizontal;
  const popoverSide = row ? "top" : "right";
  const quickOpenShortcut = useCommandShortcut("App: Go to File");
  const quickOpenLabel = useShortcutLabel("Quick Open", "App: Go to File");
  const settingsLabel = useShortcutLabel("Settings", "App: Settings");
  const [popup, setPopup] = useState<"updates" | null>(
    null,
  );
  const [inboxMenu, setInboxMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  useEffect(() => {
    if (visible) return;
    setPopup(null);
    setInboxMenu(null);
  }, [visible]);
  const inboxTrigger = useRef<HTMLElement | null>(null);
  const snapshot = updateStatus?.snapshot;
  const actionable = updateStatus?.actionable ?? false;
  const showUpdates =
    actionable || Boolean(updateNotice && onOpenWhatsNew && onDismissUpdate);
  const updateVersion =
    (actionable ? snapshot?.availableVersion : undefined) ?? updateNotice?.version;
  const updatesHover = useHoverSummary<HTMLButtonElement>({
    enabled: showUpdates && showBottom && popup === null && Boolean(updateVersion),
  });
  const updatesAnchor = updatesHover.anchorRef;
  const togglePopup = (next: typeof popup) => {
    setInboxMenu(null);
    setPopup((value) => (value === next ? null : next));
  };

  return (
    <nav
      aria-label={t("Activity bar")}
      data-activity-bar={layout}
      data-tauri-drag-region={horizontal ? "false" : undefined}
      className={
        horizontal
          ? "flex w-max shrink-0 items-center px-1"
          : row
            ? `flex shrink-0 flex-col gap-1 px-2 ${layout === "sidebar-top" ? "pb-3 pt-1" : "py-2"}`
            : "shell-chrome sidebar-glass flex h-full w-12 shrink-0 flex-col items-center pb-1.5"
      }
    >
      {!row && !chromeInMenuBar ? (
        <div className="h-10 w-full shrink-0" {...windowDragRegion()} />
      ) : null}
      {showTop ? (
        <div
          className={
            horizontal
              ? "flex shrink-0 items-center gap-0.5"
              : `flex shrink-0 flex-col ${row ? "gap-1" : "gap-1.5 pt-1.5"}`
          }
        >
          <ActivityAction
            row={row}
            horizontal={horizontal}
            label={quickOpenLabel}
            text={t("Search")}
            hint={horizontal ? undefined : quickOpenShortcut}
            icon={Search}
            active={searchActive}
            onClick={onSearch}
          />
          <ActivityAction
            row={row}
            horizontal={horizontal}
            label={inboxUnseen ? t("Inbox, new items") : t("Inbox")}
            text={t("Inbox")}
            icon={Inbox}
            active={inboxActive}
            dot={inboxUnseen}
            onClick={onOpenInbox}
            onOpenContextMenu={(x, y, trigger) => {
              setPopup(null);
              inboxTrigger.current = trigger;
              setInboxMenu({ x, y });
            }}
          />
          {notesEnabled && row ? (
            <ActivityAction
              row={row}
              horizontal={horizontal}
              label={t("Notes")}
              icon={StickyNote}
              active={notesActive}
              onClick={onOpenNotes}
            />
          ) : null}
          <ActivityAction
            row={row}
            horizontal={horizontal}
            label={t("Automations")}
            icon={Zap}
            active={automationsActive}
            onClick={onOpenAutomations}
          />
          {onOpenWorkflows ? (
            <ActivityAction
              row={row}
              horizontal={horizontal}
              label={t("Workflows")}
              icon={Workflow}
              active={workflowsActive}
              onClick={onOpenWorkflows}
            />
          ) : null}
        </div>
      ) : null}
      {!row ? <div className="min-h-0 flex-1" /> : null}
      {showBottom ? (
        <div
          className={`flex shrink-0 flex-col ${row ? "gap-1" : "gap-1.5 pt-1.5"}`}
        >
          <div className={layout === "sidebar-footer" ? "flex items-center gap-1" : undefined}>
            <div data-activity-settings className={layout === "sidebar-footer" ? "relative min-w-0 flex-1" : "relative"}>
              <ActivityAction
                row={row}
                label={settingsLabel}
                text={t("Settings")}
                icon={Settings}
                active={settingsActive}
                onClick={onOpenSettings}
              />
              {showUpdates ? (
                <UpdateBadge
                  row={row}
                  ref={updatesAnchor}
                  hover={updatesHover}
                  label={t("Updates")}
                  busy={snapshot?.phase === "downloading"}
                  expanded={popup === "updates"}
                  onClick={() => {
                    updatesHover.close();
                    togglePopup("updates");
                  }}
                />
              ) : null}
            </div>
            {layout === "sidebar-footer" ? (
              <IconButton
                size="sm"
                data-sidebar-footer-search
                label={quickOpenLabel}
                active={searchActive}
                disabled={!onSearch}
                onClick={onSearch}
              >
                <Search />
              </IconButton>
            ) : null}
          </div>
        </div>
      ) : null}
      {updateVersion ? (
        <UpdateNotesPopover
          hover={updatesHover}
          version={updateVersion}
          releaseNotes={actionable ? snapshot?.releaseNotes : undefined}
          releaseDate={actionable ? snapshot?.releaseDate : undefined}
          side={popoverSide}
        />
      ) : null}
      <PresenceBoundary>{popup === "updates" && actionable && updateStatus ? (
        <UpdateAvailableDialog
          snapshot={updateStatus.snapshot}
          onInstall={updateStatus.install}
          onSkip={() => {
            setPopup(null);
            updateStatus.skipVersion();
          }}
          onClose={() => {
            setPopup(null);
            updatesAnchor.current?.focus();
          }}
        />
      ) : null}</PresenceBoundary>
      <PresenceBoundary propagate>{popup === "updates" && showUpdates && !actionable ? (
        <Popover
          anchor={updatesAnchor}
          side={popoverSide}
          align="end"
          width={280}
          onDismiss={(reason) => {
            setPopup(null);
            if (reason === "escape") updatesAnchor.current?.focus();
          }}
          role="dialog"
          aria-label={t("Updates")}
          className="flex flex-col gap-2 p-2"
        >
          {updateNotice && onOpenWhatsNew && onDismissUpdate ? (
            <UpdateRailCard
              update={updateNotice}
              onOpen={(version) => {
                setPopup(null);
                onOpenWhatsNew(version);
              }}
              onDismiss={() => {
                setPopup(null);
                onDismissUpdate();
              }}
            />
          ) : null}
        </Popover>
      ) : null}</PresenceBoundary>
      <PresenceBoundary propagate>{visible && inboxMenu ? (
        <InboxNotificationMenu
          {...inboxMenu}
          projectPaths={[...collectRailProjects(recents, cwd).keys()]}
          onOpenSettings={onOpenNotificationSettings}
          onClose={() => {
            setInboxMenu(null);
            inboxTrigger.current?.focus();
          }}
        />
      ) : null}</PresenceBoundary>
    </nav>
  );
}

// Updates float over the Settings row instead of claiming their own slot: the
// control only exists while an update is pending, so it should not shift layout.
function UpdateBadge({
  row,
  label,
  busy,
  expanded,
  onClick,
  ref,
  hover,
}: {
  row: boolean;
  label: string;
  busy: boolean;
  expanded: boolean;
  onClick: () => void;
  ref?: React.Ref<HTMLButtonElement>;
  hover: ReturnType<typeof useHoverSummary>;
}) {
  const Icon = busy ? Loader : ArrowDownCircle;
  return (
    <button
      {...hover.triggerProps}
      ref={ref}
      type="button"
      aria-label={label}
      aria-describedby={hover.open ? hover.id : undefined}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={onClick}
      className={
        row
          ? `absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md transition-colors ${expanded ? "bg-selection text-content" : "text-accent hover:bg-surface-hover"}`
          : `absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-surface text-accent shadow-sm ring-1 ring-border transition-colors hover:bg-surface-hover`
      }
    >
      <Icon
        className={`${row ? "size-4" : "size-3"} ${busy ? "animate-spin" : ""}`}
        aria-hidden
      />
      {row ? (
        <span
          aria-hidden
          className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-sky-500"
        />
      ) : null}
    </button>
  );
}

function ActivityAction({
  row = false,
  horizontal = false,
  label,
  text = label,
  hint,
  icon: Icon,
  active = false,
  dot = false,
  expanded,
  onClick,
  onOpenContextMenu,
  ref,
}: {
  row?: boolean;
  horizontal?: boolean;
  label: string;
  /** Visible row text; the tooltip keeps `label` with its shortcut. */
  text?: string;
  hint?: string | null;
  icon: IconComponent;
  active?: boolean;
  dot?: boolean;
  expanded?: boolean;
  onClick?: () => void;
  onOpenContextMenu?: (x: number, y: number, trigger: HTMLElement) => void;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      data-ui="activity-action"
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      aria-haspopup={expanded === undefined ? undefined : "dialog"}
      aria-expanded={expanded}
      disabled={!onClick}
      onClick={onClick}
      onContextMenu={
        onOpenContextMenu
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.focus();
              onOpenContextMenu(
                event.clientX,
                event.clientY,
                event.currentTarget,
              );
            }
          : undefined
      }
      onKeyDown={
        onOpenContextMenu
          ? (event) => {
              if (
                event.key !== "ContextMenu" &&
                !(event.shiftKey && event.key === "F10")
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.focus();
              const rect = event.currentTarget.getBoundingClientRect();
              onOpenContextMenu(rect.right, rect.top, event.currentTarget);
            }
          : undefined
      }
      className={
        row
          ? `relative flex ${horizontal ? "h-7 w-auto gap-1.5 px-2 text-ui-sm" : "h-8 w-full gap-2 px-2.5 text-ui-base"} shrink-0 items-center rounded-lg text-left transition-colors ${active ? "bg-selection text-content" : "text-content hover:bg-surface-hover"} disabled:cursor-default disabled:opacity-35`
          : `relative grid size-8 shrink-0 place-items-center rounded-lg transition-colors ${active ? "bg-selection text-content" : "text-foreground-subtle hover:bg-surface-hover hover:text-content"} disabled:cursor-default disabled:opacity-35`
      }
    >
      <Icon className="size-4 shrink-0" />
      {row ? (
        <>
          <span className="min-w-0 flex-1 truncate">{text}</span>
          {hint ? (
            <span className="shrink-0 text-ui-xs text-foreground-subtlest">
              {hint}
            </span>
          ) : null}
        </>
      ) : null}
      {dot && row ? (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-sky-500"
        />
      ) : null}
      {dot && !row ? (
        <span
          aria-hidden
          className="absolute right-1 top-1 size-1.5 rounded-full bg-accent"
        />
      ) : null}
    </button>
  );
}
