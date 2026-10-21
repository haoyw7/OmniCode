import { type ReactNode } from "react";
import { DragHandleContext, DropTarget, useActiveDragPayload, useDraggableItem, type DragPayload } from "../../../shared/ui/primitives/Sortable";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { DropInsertionLine, type InsertionBounds } from "../../../shared/ui/DropInsertionLine";
import type { PaneEdge } from "../model/layout";
import { DropTargetHint } from "./DropTargetHint";


export function PaneHeaderDrag({ payload, label, disabled, children, previewElement }: { payload: DragPayload; label: string; disabled?: boolean; children: ReactNode; previewElement: () => HTMLElement | null }) {
  const drag = useDraggableItem({ payload, renderOverlay: () => label, disabled, previewElement });
  return <div ref={drag.ref} className="min-w-0"><DragHandleContext.Provider value={disabled ? undefined : drag.handleProps}>{children}</DragHandleContext.Provider></div>;
}

const regions: Record<PaneEdge, React.CSSProperties> = {
  left: { inset: "0 75% 0 0" }, right: { inset: "0 0 0 75%" },
  top: { inset: "0 25% 50% 25%" }, bottom: { inset: "50% 25% 0 25%" },
};

// The four hit regions already have cached, scroll-aware dnd-kit measurements.
// Recover the pane bounds without reading layout when the pointer moves.
function paneBounds(region: InsertionBounds | null, edge: PaneEdge): InsertionBounds | null {
  if (!region) return null;
  if (edge === "left" || edge === "right") return {
    left: edge === "left" ? region.left : region.left - region.width * 3,
    top: region.top, width: region.width * 4, height: region.height,
  };
  return {
    left: region.left - region.width / 2, top: edge === "top" ? region.top : region.top - region.height,
    width: region.width * 2, height: region.height * 2,
  };
}

export function PaneDropTargets({ id, enabled }: { id: string; enabled: boolean }) {
  const active = useActiveDragPayload();
  const accepts = (payload: DragPayload) => enabled && typeof payload.onPlace === "function" &&
    ["workspace-pane", "sidebar-session", "terminal-dock"].includes(payload.type) && (payload.paneId ?? payload.sessionId) !== id;
  if (!active || !accepts(active)) return null;
  return <>{(Object.keys(regions) as PaneEdge[]).map(edge => <DropTarget key={edge} accepts={accepts}
    onDrop={payload => (payload.onPlace as (id: string, edge: PaneEdge) => void)(id, edge)}>
    {target => <><div ref={target.ref} data-pane-drop-edge={edge} className="absolute z-30" style={regions[edge]} />
      {target.isOver &&
        <DropInsertionLine edge={edge} rect={paneBounds(target.rect.current, edge)} data-pane-insertion={edge} data-pane-insertion-target={id} />
      }</>}
  </DropTarget>)}</>;
}

export function TerminalDockTarget({ children, className }: { children?: ReactNode; className?: string }) {
  const { t } = useTranslation();
  const active = useActiveDragPayload();
  if (active?.type !== "workspace-pane" || typeof active.onDock !== "function") return null;
  return <DropTarget accepts={payload => payload.type === "workspace-pane" && typeof payload.onDock === "function"}
    onDrop={payload => (payload.onDock as () => void)()}>
    {target => <div ref={target.ref} data-terminal-dock-target className={className}>
      {children}{target.isOver && <><DropTargetHint label={t("Move to terminal panel")} />
        <DropInsertionLine edge="bottom" rect={target.rect.current} data-pane-insertion="bottom" data-pane-insertion-target="terminal-dock" /></>}
    </div>}
  </DropTarget>;
}
