import { AppSurface, AppHeader } from "../../shared/ui/messaging/AppSurface";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useCollapseMotion } from "../../shared/ui/AnimatedCollapse";
import { useDragResize } from "../../shared/hooks/useDragResize";
import { useTranslation } from "../../shared/i18n/useTranslation";
import { SurfaceVisibilityContext } from "../../shared/ui/SurfaceVisibility";
import { ResizeHandle } from "../../shared/ui/ResizeHandle";
import { beginPaneResize } from "../../shared/lib/paneResize";
import { duration } from "../../shared/motion/tokens";
import { GitCompare, X } from "../../shared/ui/icons";
import { ProjectToolsPanel } from "./ProjectToolsPanel";
import type { SidebarProps } from "./Sidebar.types";
import { useWorkspaceToolsMove } from "./useWorkspaceToolsMove";
import type { PaneEdge } from "../../features/workspace/model/layout";

const RetainedProjectToolsPanel = memo(ProjectToolsPanel);

const DROP_LABELS = {
  left: "Dock Left",
  right: "Dock Right",
  top: "Dock Top",
  bottom: "Dock Bottom",
} as const;
const MOVE_KEYS: Partial<Record<string, PaneEdge>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "top",
  ArrowDown: "bottom",
};
const DROP_RECTS: Record<PaneEdge, CSSProperties> = {
  left: { left: 0, top: 0, width: "30%", height: "100%" },
  right: { left: "70%", top: 0, width: "30%", height: "100%" },
  top: { left: 0, top: 0, width: "100%", height: "30%" },
  bottom: { left: 0, top: "70%", width: "100%", height: "30%" },
};

/** Source control keeps its own movable dock beside the workspace file browser. */
export function WorkspaceToolsDock({
  sidebar,
  visible,
  children,
}: {
  sidebar: SidebarProps;
  visible: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const open = visible && sidebar.tab === "changes";
  const { foldState, finish } = useCollapseMotion(open, duration.panel * 1000);
  const visited = useRef(false);
  if (open) visited.current = true;
  const layout = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [side, setSide] = useState<PaneEdge>("right");
  const [width, setWidth] = useState(288);
  const [height, setHeight] = useState(240);
  const vertical = side === "top" || side === "bottom";
  const size = vertical ? height : width;
  const minimum = vertical ? 120 : 200;
  const maximum = () =>
    vertical
      ? Math.max(120, Math.min(560, window.innerHeight * 0.6))
      : Math.max(200, Math.min(560, window.innerWidth * 0.45));
  const setSize = vertical ? setHeight : setWidth;
  const resize = useDragResize({
    direction:
      side === "right"
        ? "left"
        : side === "left"
          ? "right"
          : side === "top"
            ? "bottom"
            : "top",
    cssProperty: "--tools-width",
    min: minimum,
    max: maximum,
    defaultWidth: vertical ? 240 : 288,
    initial: size,
    value: size,
    onCommit: setSize,
  });
  const setLayoutRef = useCallback(
    (element: HTMLDivElement | null) => {
      layout.current = element;
      resize.setPaneRef(element);
    },
    [resize.setPaneRef],
  );
  const pendingMove = useRef(false);
  useLayoutEffect(() => {
    if (!pendingMove.current || !layout.current) return;
    pendingMove.current = false;
    // Flush the final dock geometry once, then restore normal fold animation.
    // Otherwise a side swap resizes the editor and PTY on every tween frame.
    layout.current.getBoundingClientRect();
    layout.current.style.removeProperty("transition-property");
  }, [side]);
  const moveSide = (next: PaneEdge) => {
    resize.finishDrag();
    if (next === side) return;
    if (layout.current) {
      pendingMove.current = true;
      layout.current.style.transitionProperty = "none";
      layout.current.style.setProperty("--tools-width", `${next === "top" || next === "bottom" ? height : width}px`);
    }
    setSide(next);
  };
  const move = useWorkspaceToolsMove({
    enabled: open,
    layout,
    panel,
    onMove: moveSide,
  });
  useEffect(() => {
    if (!open) resize.finishDrag();
  }, [open, resize.finishDrag]);
  useEffect(
    () =>
      foldState === "opening" || foldState === "closing"
        ? beginPaneResize()
        : undefined,
    [foldState],
  );
  return (
    <div
      ref={setLayoutRef}
      className="desktop-tools-layout animated-collapse-size"
      data-tools-open={open}
      data-tools-side={side}
      data-moving={move.moving || undefined}
      data-fold-state={foldState}
      data-resizing={resize.dragging || undefined}
      style={
        {
          "--collapse-duration": `${duration.panel}s`,
          gridTemplateAreas:
            side === "left"
              ? '"tools divider workspace"'
              : side === "right"
                ? '"workspace divider tools"'
                : side === "top"
                  ? '"tools" "divider" "workspace"'
                  : '"workspace" "divider" "tools"',
          gridTemplateColumns: vertical
            ? "minmax(0,1fr)"
            : side === "left"
              ? `${open ? "var(--tools-width) 0px" : "0px 0px"} minmax(0,1fr)`
              : `minmax(0,1fr) ${open ? "0px var(--tools-width)" : "0px 0px"}`,
          gridTemplateRows: !vertical
            ? "minmax(0,1fr)"
            : side === "top"
              ? `${open ? "var(--tools-width) 0px" : "0px 0px"} minmax(0,1fr)`
              : `minmax(0,1fr) ${open ? "0px var(--tools-width)" : "0px 0px"}`,
        } as CSSProperties
      }
      onTransitionEnd={(event) => {
        if (
          event.target === event.currentTarget &&
          event.propertyName ===
            (vertical ? "grid-template-rows" : "grid-template-columns")
        )
          finish();
      }}
    >
      <div className="desktop-tools-workspace">{children}</div>
      <div className="desktop-tools-divider">
        <ResizeHandle
          edge={vertical ? "top" : "left"}
          dragging={resize.dragging}
          disabled={!open}
          aria-label={t("Resize panel")}
          aria-valuenow={size}
          aria-valuemin={minimum}
          aria-valuemax={maximum()}
          tabIndex={open ? 0 : -1}
          onPointerDown={resize.onPointerDown}
          onDoubleClick={resize.onDoubleClick}
          onKeyDown={(event) => {
            const growKey =
              side === "right"
                ? "ArrowLeft"
                : side === "left"
                  ? "ArrowRight"
                  : side === "top"
                    ? "ArrowDown"
                    : "ArrowUp";
            const shrinkKey =
              side === "right"
                ? "ArrowRight"
                : side === "left"
                  ? "ArrowLeft"
                  : side === "top"
                    ? "ArrowUp"
                    : "ArrowDown";
            if (![growKey, shrinkKey, "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const delta = event.shiftKey ? 48 : 16;
            setSize((value) =>
              event.key === "Home"
                ? minimum
                : event.key === "End"
                  ? maximum()
                  : Math.max(
                      minimum,
                      Math.min(
                        maximum(),
                        value + (event.key === growKey ? delta : -delta),
                      ),
                    ),
            );
          }}
        />
      </div>
      <AppSurface
        as="aside"
        ref={panel}
        className="desktop-tools-panel"
        aria-hidden={!open}
        inert={!open}
        hidden={!open && foldState === "closed"}
      >
        <SurfaceVisibilityContext.Provider value={open}>
          <AppHeader className="desktop-tools-heading">
            <button
              type="button"
              className="desktop-tools-move"
              title={t("Move")}
              aria-label={t("Drag to reorder pane")}
              aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
              data-tauri-drag-region="false"
              onPointerDown={move.onPointerDown}
              onKeyDown={(event) => {
                const next = MOVE_KEYS[event.key];
                if (!next || !open) return;
                event.preventDefault();
                event.stopPropagation();
                moveSide(next);
              }}
            >
              <span aria-hidden="true" />
            </button>
            <span className="flex min-w-0 flex-1 items-center gap-2 px-2 text-ui-base"><GitCompare className="size-4" />{t("Changes")}</span>
            <button
              type="button"
              aria-label={t("Close panel")}
              onClick={() => sidebar.onTabChange("sessions")}
            >
              <X />
            </button>
          </AppHeader>
          {visited.current ? <RetainedProjectToolsPanel {...sidebar} tab="changes" open={open} /> : null}
        </SurfaceVisibilityContext.Provider>
      </AppSurface>
      {move.target ? (
        <div className="desktop-tools-drop-hint pane-drop-hint pointer-events-none absolute inset-0 z-20" aria-hidden="true">
          <div className="pane-drop-hint-target" style={DROP_RECTS[move.target]}>
            <div className="pane-drop-hint-panel">
              <span className="pane-drop-hint-label">{t(DROP_LABELS[move.target])}</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
