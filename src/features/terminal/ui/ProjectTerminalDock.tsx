import { cn } from "../../../shared/lib/cn";
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
  useRef,
  useState,
} from "react";
import { ActionMenu } from "../../../shared/ui/primitives/ActionMenu";
import { SurfaceTabs } from "../../workspace/ui/SurfaceTabs";
import { IconButton } from "../../../shared/ui/forms/IconButton";
import {
  defaultDockSize,
  type DockSide,
  type ProjectTerminalDock,
} from "../../projects/model/projectTerminal";
import { useShortcutLabel } from "../../../app/commands/useCommandShortcut";
import type { TerminalMetaPatch } from "../model/terminalTab";
import { lazySurface } from "../../../shared/ui/lazySurface";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { ResizableRegion } from "../../../shared/ui/primitives/Resizable";
import { DragHandleContext, useDraggableItem, useDropTarget, useActiveDragPayload } from "../../../shared/ui/primitives/Sortable";
import { DropTargetHint } from "../../workspace/ui/DropTargetHint";
import { DropInsertionLine } from "../../../shared/ui/DropInsertionLine";
import type { PaneEdge } from "../../workspace/model/layout";

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
  onSizeCancel?: () => void;
  onAddTerminal: () => void;
  onSelectTerminal: (fileId: string) => void;
  onCloseTerminal: (fileId: string) => void;
  onCloseOtherTerminals: (fileId: string) => void;
  onReorderTerminals: (ids: string[]) => void;
  onTerminalMetaChange?: (fileId: string, patch: TerminalMetaPatch) => void;
  /** Take the dock's terminals into the split layout beside `targetId`. */
  onMoveToPane?: (targetId: string, edge: PaneEdge) => void;
};


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
  onSizeCancel,
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
  const visible = useSurfaceVisibility();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const sideButton = useRef<HTMLDivElement>(null);
  const move = useDraggableItem({
    payload: { type: "terminal-dock", paneId: dock.pane.id, onPlace: onMoveToPane },
    renderOverlay: () => dock.pane.files.find(file => file.id === dock.pane.activeFileId)?.path ?? uiT("Terminal"),
    disabled: !visible || !onMoveToPane,
  });
  const payload = useActiveDragPayload();
  const dockTarget = useDropTarget({
    disabled: !visible,
    accepts: value => value.type === "workspace-pane" && typeof value.onDock === "function",
    onDrop: value => (value.onDock as () => void)(),
  });
  const SideIcon = sideIcon(dock.side);
  const insertionEdge = ({ bottom: "top", top: "bottom", left: "right", right: "left" } as const)[dock.side];
  const HideIcon = hideIcon(dock.side);

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
      ref={move.ref}
      data-project-terminal-dock={dock.side}
      className="project-terminal-card-gutter pane-card-gutter relative flex h-full min-h-0 min-w-0 flex-col pb-1 pr-1"
      onMouseDown={visible ? onFocus : undefined}
    >
      <ResizableRegion edge={resizeEdge} size={dock.size} min={dock.side === "left" || dock.side === "right" ? 240 : 120}
        max={() => (dock.side === "left" || dock.side === "right" ? window.innerWidth : window.innerHeight) * 0.75}
        defaultSize={defaultDockSize(dock.side)} label={uiT("Resize terminal")} disabled={!visible}
        onPreview={onSizePaint} onCommit={onSizeCommit} onCancel={onSizeCancel} />
      <div
        data-focused={focused}
        data-dock-side={dock.side}
        className={cn("project-terminal-card pane-card", move.dragging ? "opacity-40" : "")}
      >
        <DragHandleContext.Provider value={onMoveToPane ? move.handleProps : undefined}>
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
        </DragHandleContext.Provider>
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
        {visible && payload?.type === "workspace-pane" && typeof payload.onDock === "function" && <div ref={dockTarget.ref} className="absolute inset-0 z-40">{dockTarget.isOver && <>
          <DropTargetHint label={uiT("Move to terminal panel")} />
          <DropInsertionLine edge={insertionEdge} rect={dockTarget.rect.current}
            data-pane-insertion={insertionEdge} data-pane-insertion-target="terminal-dock" />
        </>}</div>}
      </div>
      <PresenceBoundary propagate>{menu ? (
        <ActionMenu
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
