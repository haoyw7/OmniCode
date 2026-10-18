import { animate, type AnimationPlaybackControls, type Transition } from "motion/react";
import { LAYER } from "./layers";

export const EXPLORER_FILE_POINTER_DRAG_EVENT =
  "monocode:explorer-file-pointer-drag";

export type ExplorerFilePointerDragDetail =
  | { type: "move" | "drop"; path: string; x: number; y: number }
  | { type: "end"; path: string };

export function emitExplorerFilePointerDrag(
  detail: ExplorerFilePointerDragDetail,
) {
  window.dispatchEvent(
    new CustomEvent<ExplorerFilePointerDragDetail>(
      EXPLORER_FILE_POINTER_DRAG_EVENT,
      { detail },
    ),
  );
}

export function setGrabbing(on: boolean) {
  document.body.style.cursor = on ? "grabbing" : "";
}

/** Block native text selection; captured resizing uses its own local cursor surface. */
export function suppressTextSelection({ reordering = true } = {}) {
  const onSelectStart = (event: Event) => {
    event.preventDefault();
  };
  window.addEventListener("selectstart", onSelectStart);
  if (reordering) document.documentElement.classList.add("is-reordering");
  window.getSelection()?.removeAllRanges();
  return () => {
    window.removeEventListener("selectstart", onSelectStart);
    if (reordering) document.documentElement.classList.remove("is-reordering");
    window.getSelection()?.removeAllRanges();
  };
}

/**
 * A ghost that follows the pointer during a drag, outside React so moves never
 * re-render. It shows `idle` until the pointer is over a target, then `target`.
 */
export function createDragLabel(idle: string, target: string) {
  const label = document.createElement("div");
  label.className = "drag-label";
  label.style.zIndex = String(LAYER.dragLabel);
  document.body.append(label);
  let over: boolean | undefined;
  return {
    move(x: number, y: number, onTarget: boolean) {
      label.style.transform = `translate(${x + 14}px, ${y + 12}px)`;
      if (over !== onTarget) {
        over = onTarget;
        label.textContent = onTarget ? target : idle;
        label.dataset.target = String(onTarget);
      }
      label.dataset.visible = "true";
    },
    dispose() {
      label.remove();
    },
  };
}

/**
 * A lifted copy of `source` that follows the pointer from where it was
 * grabbed, outside clipping and transformed ancestors in the original list.
 */
export function createDragGhost(
  source: HTMLElement,
  startX: number,
  startY: number,
  options: { className?: string; preserveContent?: boolean } = {},
) {
  const rect = source.getBoundingClientRect();
  const offsetX = startX - rect.left;
  const offsetY = startY - rect.top;
  const ghost = document.createElement("div");
  ghost.className = `drag-ghost ${options.className ?? ""}`.trim();
  ghost.style.zIndex = String(LAYER.dragLabel);
  ghost.inert = true;
  ghost.setAttribute("aria-hidden", "true");
  const card = source.cloneNode(true) as HTMLElement;
  // The copy must not be found as the real card, or steal focus or labels.
  const copies = [card, ...card.querySelectorAll<HTMLElement>("*")];
  for (const node of copies) {
    node.removeAttribute("id");
    node.removeAttribute("tabindex");
    for (const name of node.getAttributeNames()) {
      if (
        name.startsWith("data-session-") ||
        name.startsWith("data-project-") ||
        name.startsWith("data-sidebar-") ||
        name.startsWith("aria-") ||
        (options.preserveContent && (name === "data-pane-id" || name === "data-pane-sash"))
      )
        node.removeAttribute(name);
    }
  }
  card.setAttribute("aria-hidden", "true");
  card.classList.add("drag-ghost-card");
  card.style.width = `${rect.width}px`;
  card.style.height = `${rect.height}px`;
  card.style.font = getComputedStyle(source).font;
  card.style.transition = "none";
  if (options.preserveContent) {
    card.style.left = "0";
    card.style.top = "0";
    card.style.position = "fixed";
    card.style.gridArea = "auto";
  }
  let animation: AnimationPlaybackControls | undefined;
  ghost.append(card);
  document.body.append(ghost);
  if (options.preserveContent) {
    const originals = [source, ...source.querySelectorAll<HTMLElement>("*")];
    originals.forEach((original, index) => {
      const copy = copies[index];
      copy.scrollTop = original.scrollTop;
      copy.scrollLeft = original.scrollLeft;
      if (original instanceof HTMLCanvasElement && copy instanceof HTMLCanvasElement && original.width && original.height) {
        copy.getContext("2d")?.drawImage(original, 0, 0);
      }
    });
  }
  return {
    move(x: number, y: number) {
      animation?.stop();
      card.style.transform = `translate(${x - offsetX}px, ${y - offsetY}px)`;
    },
    settle(left: number, top: number, transition: Transition) {
      animation?.stop();
      const target = `translate(${left}px, ${top}px)`;
      const previous = card.style.transform;
      card.style.transform = target;
      animation = animate(card, { transform: [previous, target] }, transition);
    },
    dispose() {
      animation?.stop();
      ghost.remove();
    },
  };
}
