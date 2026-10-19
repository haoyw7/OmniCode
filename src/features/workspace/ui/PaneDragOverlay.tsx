import { createPortal } from "react-dom";
import { LAYER } from "../../../shared/lib/layers";
import type { PaneDrag } from "../hooks/usePaneDrag";

/** The same insertion marker is used above every lifted workspace card. */
export function PaneDragOverlay({ drag }: { drag: PaneDrag | null }) {
  return drag?.insertion ? createPortal(
    <div className="pane-insertion-line" data-pane-insertion={drag.edge}
      style={{ ...drag.insertion, zIndex: LAYER.dragHint }} aria-hidden="true" />,
    document.body,
  ) : null;
}
