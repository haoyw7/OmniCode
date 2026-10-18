import { suppressTextSelection } from "./drag";
import { LAYER } from "./layers";
import { beginPaneResize } from "./paneResize";

let active = 0;
let originallyResizing = false;

/** Call after capturing the pointer and measuring the starting geometry.
 * A local hit surface keeps the cursor stable without restyling every token
 * in the document. Pointer capture still delivers events to the real handle. */
export function beginResizeInteraction(cursor: "col-resize" | "row-resize") {
  const root = document.documentElement;
  if (active++ === 0) originallyResizing = root.classList.contains("is-resizing");
  root.classList.add("is-resizing");
  const endResize = beginPaneResize();
  const restoreSelection = suppressTextSelection({ reordering: false });
  const surface = document.createElement("div");
  surface.dataset.resizeCursor = cursor;
  surface.setAttribute("aria-hidden", "true");
  surface.style.cssText = `position:fixed;inset:0;z-index:${LAYER.resizeCursor};cursor:${cursor};user-select:none;touch-action:none;`;
  document.body.append(surface);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    surface.remove();
    restoreSelection();
    if (--active === 0 && !originallyResizing) root.classList.remove("is-resizing");
    endResize();
  };
}
