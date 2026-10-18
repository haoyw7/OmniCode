import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  Plus,
} from "../../../shared/ui/icons";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ExplorerMenu } from "../../connections/files/ui/ExplorerMenu";
import { SurfaceTabs } from "../../workspace/ui/SurfaceTabs";
import { IconButton } from "../../../shared/ui/forms/IconButton";
import {
  clampDockSize,
  defaultDockSize,
  isVerticalDock,
  type DockSide,
  type ProjectTerminalDock,
} from "../../projects/model/projectTerminal";
import { useShortcutLabel } from "../../../app/commands/useCommandShortcut";
import type { TerminalMetaPatch } from "../model/terminalTab";
import { lazySurface } from "../../../shared/ui/lazySurface";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { ResizeHandle } from "../../../shared/ui/ResizeHandle";
import { beginPaneResize } from "../../../shared/lib/paneResize";
import {
  createDragLabel,
  suppressTextSelection,
} from "../../../shared/lib/drag";
import {
  paneDropFromPoint,
  setExternalPaneDrop,
  useTerminalDockDrop,
} from "../../workspace/model/paneDrop";
import type { PaneEdge } from "../../workspace/model/layout";
import { DropTargetHint } from "../../workspace/ui/DropTargetHint";

const TerminalView = lazySurface(async () => {
  const module = await import("./TerminalView");
  return { default: module.TerminalView };
});

type Props = {
  dock: ProjectTerminalDock;
  focused: boolean;
  onFocus: () => void;
  onHide: () => void;
  onSideChange: (side: DockSide) => void;
  onSizePaint: (size: number) => void;
  onSizeCommit: (size: number) => void;
  onAddTerminal: () => void;
  onSelectTerminal: (fileId: string) => void;
  onCloseTerminal: (fileId: string) => void;
  onCloseOtherTerminals: (fileId: string) => void;
  onReorderTerminals: (ids: string[]) => void;
  onTerminalMetaChange?: (fileId: string, patch: TerminalMetaPatch) => void;
  /** Take the dock's terminals into the split layout beside `targetId`. */
  onMoveToPane?: (targetId: string, edge: PaneEdge) => void;
};

const DRAG_THRESHOLD = 5;

const SIDE_ITEMS: { id: DockSide; label: string }[] = [
  { id: "bottom", label: "Dock Bottom" },
  { id: "top", label: "Dock Top" },
  { id: "left", label: "Dock Left" },
  { id: "right", label: "Dock Right" },
];

function sideIcon(side: DockSide) {
  if (side === "top") return PanelTop;
  if (side === "left") return PanelLeft;
  if (side === "right") return PanelRight;
  return PanelBottom;
}

function hideIcon(side: DockSide) {
  if (side === "top") return ChevronUp;
  if (side === "left") return ChevronLeft;
  if (side === "right") return ChevronRight;
  return ChevronDown;
}

export function ProjectTerminalDock({
  dock,
  focused,
  onFocus,
  onHide,
  onSideChange,
  onSizePaint,
  onSizeCommit,
  onAddTerminal,
  onSelectTerminal,
  onCloseTerminal,
  onCloseOtherTerminals,
  onReorderTerminals,
  onTerminalMetaChange,
  onMoveToPane,
}: Props) {
  const { t: uiT } = useTranslation();
  const newTerminalLabel = useShortcutLabel("New Terminal", "Terminal: New");
  const hideTerminalLabel = useShortcutLabel(
    "Hide Terminal",
    "Terminal: Toggle Dock",
  );
  const vertical = isVerticalDock(dock.side);
  const visible = useSurfaceVisibility();
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const sideButton = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    start: number;
    size: number;
    pointerId: number;
    target: HTMLDivElement;
    endPaneResize: () => void;
    viewport: { width: number; height: number };
  } | null>(null);
  const sizeRef = useRef(dock.size);
  sizeRef.current = dock.size;
  const pending = useRef(dock.size);
  const painted = useRef(dock.size);
  const dockDrop = useTerminalDockDrop();
  const [moving, setMoving] = useState(false);
  const onMoveToPaneRef = useRef(onMoveToPane);
  onMoveToPaneRef.current = onMoveToPane;
  const SideIcon = sideIcon(dock.side);
  const HideIcon = hideIcon(dock.side);

  useEffect(() => {
    if (!dragging) return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = vertical ? "row-resize" : "col-resize";
    return () => {
      document.body.style.cursor = previous;
    };
  }, [dragging, vertical]);

  useEffect(
    () => () => {
      drag.current?.endPaneResize();
    },
    [],
  );

  const viewport = () => ({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const paint = (next: number) => {
    pending.current = next;
    if (painted.current === next) return;
    painted.current = next;
    onSizePaint(next);
  };

  const commit = () => {
    // Land the final sample before App restores the collapse transitions.
    if (visible && painted.current !== pending.current) {
      painted.current = pending.current;
      onSizePaint(pending.current);
    }
    onSizeCommit(pending.current);
  };

  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !visible || drag.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      start: vertical ? event.clientY : event.clientX,
      size: sizeRef.current,
      pointerId: event.pointerId,
      target: event.currentTarget,
      endPaneResize: beginPaneResize(),
      viewport: viewport(),
    };
    pending.current = sizeRef.current;
    painted.current = sizeRef.current;
    setDragging(true);
  };

  const onResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || event.pointerId !== drag.current.pointerId) return;
    const point = vertical ? event.clientY : event.clientX;
    const delta = point - drag.current.start;
    const signed =
      dock.side === "bottom" || dock.side === "right" ? -delta : delta;
    paint(clampDockSize(dock.side, drag.current.size + signed, drag.current.viewport));
  };

  const finishResize = () => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    commit();
    current.endPaneResize();
    setDragging(false);
    if (current.target.hasPointerCapture(current.pointerId)) {
      current.target.releasePointerCapture(current.pointerId);
    }
  };

  const onResizePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || event.pointerId !== drag.current.pointerId) return;
    onResizePointerMove(event);
    finishResize();
  };

  const onResizePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId === drag.current?.pointerId) finishResize();
  };

  useLayoutEffect(() => {
    if (!visible) finishResize();
  }, [visible]);

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener("blur", finishResize);
    return () => window.removeEventListener("blur", finishResize);
  }, [dragging]);

  /** Drag the dock by its grip onto a pane to open its terminals in the split. */
  const onDockDragStart = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !visible) return;
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const fromId = dock.pane.id;
    const active = dock.pane.files.find(
      (file) => file.id === dock.pane.activeFileId,
    );
    let dragging = false;
    let lastX = startX;
    let lastY = startY;
    let label: ReturnType<typeof createDragLabel> | undefined;
    handle.setPointerCapture(pointerId);
    const restoreSelection = suppressTextSelection();

    const onMove = (ev: PointerEvent) => {
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (!dragging) {
        if (Math.hypot(lastX - startX, lastY - startY) < DRAG_THRESHOLD) return;
        dragging = true;
        setMoving(true);
        label = createDragLabel(
          active?.path ?? uiT("Terminal"),
          uiT("Open in split view"),
        );
      }
      const over = paneDropFromPoint(lastX, lastY);
      label?.move(lastX, lastY, !!over);
      setExternalPaneDrop({
        fromId,
        overId: over?.id ?? null,
        edge: over?.edge ?? "left",
      });
    };
    const onUp = () => finish(true);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      finish(false);
    };
    function finish(commit: boolean) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
      restoreSelection();
      label?.dispose();
      setMoving(false);
      setExternalPaneDrop(null);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      if (!dragging || !commit) return;
      const over = paneDropFromPoint(lastX, lastY);
      if (over) onMoveToPaneRef.current?.(over.id, over.edge);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey);
  };

  const resizeEdge =
    dock.side === "top"
      ? "bottom"
      : dock.side === "bottom"
        ? "top"
        : dock.side === "left"
          ? "right"
          : "left";

  return (
    <section
      data-project-terminal-dock={dock.side}
      className="project-terminal-card-gutter pane-card-gutter relative flex h-full min-h-0 min-w-0 flex-col pb-1 pr-1"
      onMouseDown={visible ? onFocus : undefined}
    >
      <ResizeHandle
        edge={resizeEdge}
        dragging={dragging}
        disabled={!visible}
        aria-label={uiT("Resize terminal")}
        aria-valuenow={dock.size}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerCancel}
        onLostPointerCapture={onResizePointerCancel}
        onDoubleClick={() => {
          pending.current = defaultDockSize(dock.side);
          commit();
        }}
      />
      <div
        data-focused={focused}
        data-dock-side={dock.side}
        className={`project-terminal-card pane-card ${moving ? "opacity-40" : ""}`}
      >
        <SurfaceTabs
          files={dock.pane.files}
          activeFileId={dock.pane.activeFileId}
          dirtyFileIds={EMPTY_IDS}
          fileErrorCounts={EMPTY_ERRORS}
          label={uiT("Terminals")}
          onSelectFile={onSelectTerminal}
          onCloseFile={onCloseTerminal}
          onCloseOtherFiles={onCloseOtherTerminals}
          onReorder={onReorderTerminals}
          onPaneDragStart={onMoveToPane ? onDockDragStart : undefined}
          trailing={
            <div data-terminal-toolbar-actions className="relative z-21 flex shrink-0 items-center self-center">
              <IconButton size="sm" label={newTerminalLabel} onClick={onAddTerminal}>
                <Plus />
              </IconButton>
              <div ref={sideButton}>
                <IconButton size="sm"
                  label={uiT("Move Terminal")}
                  onClick={() => {
                    const rect = sideButton.current?.getBoundingClientRect();
                    if (!rect) return;
                    setMenu({ x: rect.left, y: rect.bottom + 4 });
                  }}
                >
                  <SideIcon />
                </IconButton>
              </div>
              <IconButton size="sm" label={hideTerminalLabel} onClick={onHide}>
                <HideIcon />
              </IconButton>
            </div>
          }
        />
        <div className="relative min-h-0 min-w-0 flex-1">
          {dock.pane.files.map((file) => (
            <div
              key={file.id}
              aria-hidden={file.id !== dock.pane.activeFileId}
              inert={file.id !== dock.pane.activeFileId}
              className={
                file.id === dock.pane.activeFileId
                  ? "absolute inset-0 h-full"
                  : "absolute inset-0 h-full invisible pointer-events-none"
              }
            >
              <TerminalView
                id={file.id}
                cwd={file.cwd}
                active={
                  visible && focused && file.id === dock.pane.activeFileId
                }
                onMetaChange={(patch) => onTerminalMetaChange?.(file.id, patch)}
              />
            </div>
          ))}
        </div>
        {dockDrop === "dock" && visible ? (
          <DropTargetHint label={uiT("Move to terminal panel")} />
        ) : null}
      </div>
      <PresenceBoundary propagate>{menu ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          ariaLabel={uiT("Move terminal")}
          items={SIDE_ITEMS.map((item) => ({
            kind: "item" as const,
            id: item.id,
            label: item.label,
            checked: item.id === dock.side,
          }))}
          onPick={(id) => {
            if (
              id === "top" ||
              id === "bottom" ||
              id === "left" ||
              id === "right"
            ) {
              onSideChange(id);
            }
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}</PresenceBoundary>
    </section>
  );
}

const EMPTY_IDS = new Set<string>();
const EMPTY_ERRORS = new Map<string, number>();
