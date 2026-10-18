import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Check, ChevronDown, ChevronRight, X } from "../../../shared/ui/icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { basename, pickFolders } from "../../../platform/tauri/fs";
import { prettyCwd } from "../../../shared/lib/paths";
import {
  looksLikeProject,
  projectRailItems,
  sameProjectPath,
  type RecentProject,
} from "../model/recents";
import { isChatFolder } from "../model/chatFolderPath";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { LAYER } from "../../../shared/lib/layers";
import { MenuPanel } from "../../../shared/ui/primitives/MenuPanel";
import { MenuHover } from "../../../shared/ui/MenuHover";
import { ProjectLogoIcon } from "./ProjectLogoIcon";

type Props = {
  cwd: string;
  recents: RecentProject[];
  /** Moving an item offers the full project rail in a single list. */
  mode?: "switch" | "move";
  /** Active app project, which can differ from the item's current project. */
  activeCwd?: string;
  renderProjectLabel?: (path: string) => ReactNode;
  projectLogoPath?: string | null;
  enabled?: boolean;
  placement?: "above" | "below";
  className?: string;
  buttonClassName?: string;
  /** Chevron on the trailing edge; flips when the menu is open. */
  chevron?: boolean;
  /** A compact presentation label; menus and accessible names keep the full path. */
  shortLabel?: string;
  children?: ReactNode;
  onCwdChange: (path: string) => void;
  /** Leaves the project; the next message starts a projectless chat. */
  onClear?: () => void;
  /** Offers the system folder picker below the recent projects. */
  openFolder?: boolean;
  /** Environment-specific folder selection, supplied by the owning workflow. */
  onOpenFolder?: () => void;
  /**
   * Extra rows below the project list. `close` dismisses the menu; `hold`
   * keeps it open while a submenu or dialog of those rows takes clicks.
   */
  menuFooter?: (menu: { close: () => void; hold: (held: boolean) => void }) => ReactNode;
  onClose?: () => void;
};

const MENU_WIDTH = 288;
const MENU_MAX_HEIGHT = 440;
const SUBMENU_MAX_HEIGHT = 320;
const PREVIEW = 5;
const SUBMENU_GAP = 4;
const HOVER_CLOSE_MS = 100;
/* Both menus sit outside the trigger, so neither counts as a click-away. */
const SELF = "[data-cwd-picker],[data-cwd-submenu]";

type Row =
  | { kind: "none" }
  | { kind: "recent"; path: string }
  | { kind: "more" }
  | { kind: "open-folder" };

export function CwdPicker({
  cwd,
  recents,
  mode = "switch",
  activeCwd,
  renderProjectLabel,
  projectLogoPath,
  enabled = true,
  placement = "above",
  className,
  buttonClassName,
  chevron = false,
  shortLabel,
  children,
  onCwdChange,
  onClear,
  openFolder = false,
  onOpenFolder,
  menuFooter,
  onClose,
}: Props) {
  const { t: uiT } = useTranslation();
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const closeMoreTimer = useRef<number | null>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const chat = isChatFolder(cwd);
  const inProject = looksLikeProject(cwd) && !chat;
  const label =
    cwd === "~" ? uiT("Choose project") : chat ? uiT("Projectless chat") : prettyCwd(cwd);
  const clearable = !!onClear && inProject && enabled;
  // Read the saved rail order on opening, including changes made while Notes is open.
  const projects =
    mode === "move" ? projectRailItems(recents, activeCwd ?? "") : recents;
  // Switching lists the current project too, marked with a check.
  const otherRecents =
    mode === "move"
      ? projects.filter((item) => !inProject || !sameProjectPath(item.path, cwd))
      : inProject && !projects.some((item) => sameProjectPath(item.path, cwd))
        ? [{ path: cwd }, ...projects]
        : projects;
  const previewRecents =
    mode === "move" ? otherRecents : otherRecents.slice(0, PREVIEW);
  const overflowRecents = mode === "move" ? [] : otherRecents.slice(PREVIEW);
  const hasMore = overflowRecents.length > 0;

  useEffect(() => {
    if (mode === "move")
      activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active, open, mode]);

  const offerNone = mode === "switch" && !!onClear;
  const rows = useMemo((): Row[] => {
    const out: Row[] = offerNone ? [{ kind: "none" }] : [];
    for (const item of previewRecents) out.push({ kind: "recent", path: item.path });
    if (hasMore) out.push({ kind: "more" });
    if (openFolder) out.push({ kind: "open-folder" });
    return out;
  }, [hasMore, offerNone, openFolder, previewRecents]);

  const held = useRef(false);
  const hold = useCallback((next: boolean) => {
    held.current = next;
  }, []);

  const dismiss = (restore = false) => {
    held.current = false;
    setOpen(false);
    setMoreOpen(false);
    setActive(0);
    if (closeMoreTimer.current != null) {
      window.clearTimeout(closeMoreTimer.current);
      closeMoreTimer.current = null;
    }
    if (restore) onCloseRef.current?.();
  };

  const openMore = () => {
    if (closeMoreTimer.current != null) {
      window.clearTimeout(closeMoreTimer.current);
      closeMoreTimer.current = null;
    }
    setMoreOpen(true);
  };

  const scheduleCloseMore = () => {
    if (closeMoreTimer.current != null)
      window.clearTimeout(closeMoreTimer.current);
    closeMoreTimer.current = window.setTimeout(() => {
      closeMoreTimer.current = null;
      setMoreOpen(false);
    }, HOVER_CLOSE_MS);
  };

  const pick = (row: Row) => {
    if (row.kind === "more") return;
    dismiss(true);
    if (row.kind === "none") {
      onClear?.();
      return;
    }
    if (row.kind === "open-folder") {
      if (onOpenFolder) {
        onOpenFolder();
        return;
      }
      void pickFolders(uiT("Open folder…")).then((paths) => {
        if (paths[0]) onCwdChange(paths[0]);
      });
      return;
    }
    onCwdChange(row.path);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!enabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const row = rows[active + 1];
      if (row?.kind === "more") openMore();
      setActive((i) => Math.min(rows.length - 1, i + 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    }
    if (e.key === "ArrowRight") {
      const row = rows[active];
      if (row?.kind === "more") {
        e.preventDefault();
        openMore();
      }
    }
    if (e.key === "ArrowLeft") {
      if (moreOpen) {
        e.preventDefault();
        setMoreOpen(false);
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row?.kind === "more") {
        openMore();
        return;
      }
      if (row) pick(row);
    }
  };

  const recentOffset = offerNone ? 1 : 0;
  const moreIndex = rows.findIndex((row) => row.kind === "more");
  const openFolderIndex = rows.findIndex((row) => row.kind === "open-folder");
  const rowClass = (highlighted: boolean) =>
    `flex h-8 w-full items-center justify-between gap-3 px-2.5 text-left ${
      highlighted ? "bg-selection text-content" : "text-content/80 hover:bg-content/3"
    }`;

  return (
    <div
      ref={root}
      className={`relative flex h-full min-w-0${className ? ` ${className}` : ""}`}
    >
      {clearable ? (
        <button
          type="button"
          title={uiT("Clear project")}
          aria-label={uiT("Clear project")}
          data-tauri-drag-region="false"
          data-cwd-clear
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            dismiss();
            onClear();
          }}
          className="cwd-picker-clear flex shrink-0 items-center justify-center text-content/50 hover:text-content"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
      <button
        type="button"
        title={cwd}
        data-clearable={clearable ? "" : undefined}
        aria-label={uiT("Project {value0}", { value0: String(label) })}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={!enabled}
        data-tauri-drag-region="false"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!enabled) return;
          if (open) {
            dismiss(true);
            return;
          }
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className={
          buttonClassName
            ? `${buttonClassName} ${
                open ? "bg-selection text-content" : "hover:bg-content/3"
              } disabled:opacity-40`
            : `flex min-w-0 items-center gap-1.5 ${
                open ? "text-content" : "text-content/50 hover:text-content"
              } disabled:opacity-40`
        }
      >
        {children ?? (
          <>
            {clearable && !shortLabel ? null : (
              <ProjectLogoIcon
                path={projectLogoPath}
                fallbackStrokeWidth={1.5}
                className={shortLabel ? "cwd-picker-project-icon size-3.5 shrink-0" : undefined}
              />
            )}
            <span className={`${shortLabel ? "cwd-picker-full-label " : ""}truncate font-mono text-[12px]`}>{label}</span>
            {shortLabel ? <span data-file-label className="cwd-picker-short-label hidden truncate">{shortLabel}</span> : null}
          </>
        )}
        {chevron ? (
          <ChevronDown
            className={`size-3 shrink-0 text-content/50 ${
              open ? "rotate-180" : ""
            }`}
          />
        ) : null}
      </button>
      <PresenceBoundary propagate>{open ? (
        <MenuPanel
          anchor={root}
          side={placement === "below" ? "bottom" : "top"}
          width={MENU_WIDTH}
          maxHeight={MENU_MAX_HEIGHT}
          ignore={`${SELF}, [role="dialog"]`}
          onDismiss={(reason) => {
            if (held.current && reason === "escape") return;
            dismiss(reason === "escape");
          }}
          role="menu"
          aria-label={uiT("Project picker")}
          data-cwd-picker
          className="flex flex-col overflow-hidden"
        >
          <div
            ref={lockOverscroll}
            className="min-h-0 flex-1 overflow-y-auto overscroll-none py-1"
          >
            {offerNone ? (
              <>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={!inProject}
                  data-highlighted={active === 0 || undefined}
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseEnter={() => {
                    setMoreOpen(false);
                    setActive(0);
                  }}
                  onClick={() => pick({ kind: "none" })}
                  className={rowClass(active === 0)}
                >
                  <MenuHover />
                  <span data-menu-title className="text-[13px]">{uiT("No folder")}</span>
                  {!inProject ? <Check className="size-3.5 shrink-0 text-accent" /> : null}
                </button>
                <div role="separator" className="my-1 h-px bg-stroke" />
              </>
            ) : null}
            {previewRecents.length > 0 || mode === "move" ? (
              <>
                <p className="px-2.5 pb-1 pt-1.5 text-[12px] text-content/50">
                  {mode === "move" ? uiT("Move to project") : uiT("Recent")}
                </p>
                {mode === "move" && previewRecents.length === 0 ? (
                  <p className="px-2.5 py-2 text-[13px] text-content/50">
                    {uiT("No other projects")}
                  </p>
                ) : null}
                {previewRecents.map((item, offset) => {
                  const index = offset + recentOffset;
                  const current =
                    mode === "switch" && inProject && sameProjectPath(item.path, cwd);
                  return (
                    <button
                      key={item.path}
                      ref={active === index ? activeRef : undefined}
                      type="button"
                      role={mode === "switch" ? "menuitemradio" : "menuitem"}
                      aria-checked={mode === "switch" ? current : undefined}
                      data-highlighted={active === index || undefined}
                      title={item.path}
                      onMouseDown={(e) => e.stopPropagation()}
                      onMouseEnter={() => {
                        setMoreOpen(false);
                        setActive(index);
                      }}
                      onClick={() => pick({ kind: "recent", path: item.path })}
                      className={rowClass(active === index)}
                    >
                      <MenuHover />
                      <span data-menu-title className="min-w-0 truncate text-[13px]">
                        {renderProjectLabel?.(item.path) ?? basename(item.path)}
                      </span>
                      {current ? <Check className="size-3.5 shrink-0 text-accent" /> : null}
                    </button>
                  );
                })}
              </>
            ) : null}
            {hasMore ? (
              <button
                ref={moreRef}
                type="button"
                role="menuitem"
                data-highlighted={active === moreIndex || moreOpen || undefined}
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseEnter={() => {
                  setActive(moreIndex);
                  openMore();
                }}
                onMouseLeave={scheduleCloseMore}
                onFocus={() => {
                  setActive(moreIndex);
                  openMore();
                }}
                className={rowClass(active === moreIndex || moreOpen)}
              >
                <MenuHover />
                <span data-menu-title className="text-[13px]">{uiT("More Projects")}</span>
                <ChevronRight
                  className="size-3.5 shrink-0"
                />
              </button>
            ) : null}
          </div>
          {openFolder ? (
            <div className="shrink-0 border-t border-stroke py-1">
              <button
                type="button"
                role="menuitem"
                data-highlighted={active === openFolderIndex || undefined}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseEnter={() => {
                  setMoreOpen(false);
                  setActive(openFolderIndex);
                }}
                onClick={() => pick({ kind: "open-folder" })}
                className={rowClass(active === openFolderIndex)}
              >
                <MenuHover />
                <span data-menu-title className="text-[13px]">{uiT("Open folder…")}</span>
              </button>
            </div>
          ) : null}
          {menuFooter ? (
            <div
              className="shrink-0 border-t border-stroke py-1"
              // Footer rows own their hover state; clear the list highlight.
              onMouseEnter={() => {
                setMoreOpen(false);
                setActive(-1);
              }}
            >
              {menuFooter({ close: () => dismiss(true), hold })}
            </div>
          ) : null}
        </MenuPanel>
      ) : null}</PresenceBoundary>
      <PresenceBoundary propagate>{open && moreOpen ? (
        <MenuPanel
          anchor={moreRef}
          side="right"
          gap={SUBMENU_GAP}
          width={MENU_WIDTH}
          maxHeight={SUBMENU_MAX_HEIGHT}
          layer={LAYER.submenu}
          role="menu"
          aria-label={uiT("More projects")}
          data-cwd-submenu
          className="overflow-y-auto overscroll-none py-1"
          onMouseEnter={openMore}
          onMouseLeave={scheduleCloseMore}
        >
          {overflowRecents.map((item) => (
            <button
              key={item.path}
              type="button"
              role="menuitem"
              title={item.path}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => pick({ kind: "recent", path: item.path })}
              className="flex h-8 w-full items-center justify-between gap-3 px-2.5 text-left text-content/80 hover:bg-content/3 hover:text-content"
            >
              <MenuHover />
              <span data-menu-title className="min-w-0 truncate text-[13px]">
                {renderProjectLabel?.(item.path) ?? basename(item.path)}
              </span>
            </button>
          ))}
        </MenuPanel>
      ) : null}</PresenceBoundary>
    </div>
  );
}
