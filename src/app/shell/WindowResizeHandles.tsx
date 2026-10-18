import { isTauri } from "@tauri-apps/api/core";
import {
  getCurrentWindow,
  type Window as TauriWindow,
} from "@tauri-apps/api/window";
import { useEffect, useState, type CSSProperties } from "react";
import { IS_LINUX, IS_WIN } from "../../platform/tauri/platform";
import { deferredWindowRefresh } from "./windowResizeWork";

type ResizeDirection = Parameters<TauriWindow["startResizeDragging"]>[0];

const DIRECTIONS: ResizeDirection[] = [
  "North",
  "East",
  "South",
  "West",
  "NorthWest",
  "NorthEast",
  "SouthWest",
  "SouthEast",
];

const INTERACTIVE_TARGETS = [
  "button",
  "input",
  "select",
  "textarea",
  "a[href]",
  "label",
  "summary",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]:not([tabindex='-1'])",
  "[role='button']",
  "[role='link']",
  "[role='slider']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='option']",
  ".resize-handle",
  "[data-resize-edge]",
  "[role='separator']",
  ".cm-editorScrollbar",
  ".xterm .scrollbar",
  "[data-ui='scrollbar']",
].join(",");

function resizeDirection(x: number, y: number, edge: number, corner: number): ResizeDirection | null {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  if (y < corner) {
    if (x < corner) return "NorthWest";
    if (x >= width - corner) return "NorthEast";
  }
  if (y >= height - corner) {
    if (x < corner) return "SouthWest";
    if (x >= width - corner) return "SouthEast";
  }
  if (y < edge) return "North";
  if (y >= height - edge) return "South";
  if (x < edge) return "West";
  if (x >= width - edge) return "East";
  return null;
}

function nativeScrollbarAt(target: Element, x: number, y: number) {
  for (
    let element: Element | null = target;
    element;
    element = element.parentElement
  ) {
    if (!(element instanceof HTMLElement)) continue;
    const { offsetWidth, offsetHeight, clientWidth, clientHeight } = element;
    if (!offsetWidth || !offsetHeight) continue;
    const rect = element.getBoundingClientRect();
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom)
      continue;
    const style = getComputedStyle(element);
    const left = parseFloat(style.borderLeftWidth) || 0;
    const right = parseFloat(style.borderRightWidth) || 0;
    const top = parseFloat(style.borderTopWidth) || 0;
    const bottom = parseFloat(style.borderBottomWidth) || 0;
    const localX = ((x - rect.left) * offsetWidth) / rect.width;
    const localY = ((y - rect.top) * offsetHeight) / rect.height;
    if (
      offsetWidth - clientWidth - left - right > 0.5 &&
      (style.overflowY === "scroll" ||
        (element.scrollHeight > clientHeight &&
          /^(auto|overlay)$/.test(style.overflowY)))
    ) {
      // clientLeft includes a left-side scrollbar in RTL layouts.
      const start =
        element.clientLeft > left + 0.5
          ? left
          : element.clientLeft + clientWidth;
      const end =
        element.clientLeft > left + 0.5
          ? element.clientLeft
          : offsetWidth - right;
      if (localX >= start && localX < end) return true;
    }
    if (
      offsetHeight - clientHeight - top - bottom > 0.5 &&
      (style.overflowX === "scroll" ||
        (element.scrollWidth > clientWidth &&
          /^(auto|overlay)$/.test(style.overflowX))) &&
      localY >= element.clientTop + clientHeight &&
      localY < offsetHeight - bottom
    )
      return true;
  }
  return false;
}

function eventElement(target: EventTarget | null) {
  return target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
}

const CURSORS: Record<ResizeDirection, string> = {
  North: "ns-resize",
  South: "ns-resize",
  East: "ew-resize",
  West: "ew-resize",
  NorthWest: "nwse-resize",
  SouthEast: "nwse-resize",
  NorthEast: "nesw-resize",
  SouthWest: "nesw-resize",
};

/** Extend the inner hit area; the OS still performs the entire resize gesture. */
export function WindowResizeHandles() {
  const [resizeWindow, setResizeWindow] = useState<TauriWindow | null>(null);
  const [nativeScale, setNativeScale] = useState(1);
  // Tauri/GTK uses 5 * scale GDK units. Convert to CSS pixels, including webview zoom.
  const nativeInset = IS_LINUX ? 5 * nativeScale * nativeScale / window.devicePixelRatio : 0;
  const edge = IS_LINUX ? Math.max(16, nativeInset + 8) : 10;
  const corner = IS_LINUX ? Math.max(24, edge) : 16;

  useEffect(() => {
    if (!(IS_LINUX || IS_WIN) || !isTauri()) return;
    const win = getCurrentWindow();
    let mounted = true;
    let revision = 0;
    let unlisten: (() => void) | undefined;
    const refresh = async () => {
      const current = ++revision;
      try {
        const [resizable, maximized, fullscreen, scale] = await Promise.all([
          win.isResizable(),
          win.isMaximized(),
          win.isFullscreen(),
          IS_LINUX ? win.scaleFactor() : 1,
        ]);
        if (mounted && current === revision) {
          setNativeScale(scale);
          setResizeWindow(resizable && !maximized && !fullscreen ? win : null);
        }
      } catch {
        if (mounted && current === revision) setResizeWindow(null);
      }
    };
    const queuedRefresh = deferredWindowRefresh(() => { void refresh(); });
    void refresh();
    void win
      .onResized(() => {
        revision++;
        queuedRefresh.schedule();
      })
      .then((stop) => {
        if (mounted) unlisten = stop;
        else stop();
      })
      .catch(() => {});
    return () => {
      mounted = false;
      queuedRefresh.dispose();
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!resizeWindow) return;
    let hover: {
      element: HTMLElement | SVGElement;
      previous: string;
      priority: string;
      applied: string;
    } | null = null;
    const restoreCursor = () => {
      if (!hover) return;
      const { element, previous, priority, applied } = hover;
      if (
        element.style.getPropertyValue("cursor") === applied &&
        element.style.getPropertyPriority("cursor") === ""
      ) {
        if (previous) element.style.setProperty("cursor", previous, priority);
        else element.style.removeProperty("cursor");
      }
      hover = null;
    };
    const allowedDirection = (event: MouseEvent | PointerEvent) => {
      // Zoom can change the DOM scale without changing the native window size.
      const nativeInset = IS_LINUX ? 5 * nativeScale * nativeScale / window.devicePixelRatio : 0;
      const edge = IS_LINUX ? Math.max(16, nativeInset + 8) : 10;
      const corner = IS_LINUX ? Math.max(24, edge) : 16;
      // The GTK handler has already seen presses in its own rim. Only handle
      // the extra inner band, so one press cannot start two native resizes.
      if (nativeInset && (
        event.clientX < nativeInset || event.clientY < nativeInset ||
        event.clientX >= window.innerWidth - nativeInset ||
        event.clientY >= window.innerHeight - nativeInset
      )) return null;
      const direction = resizeDirection(event.clientX, event.clientY, edge, corner);
      const target = eventElement(event.target);
      if (
        !direction ||
        !target ||
        target.closest(INTERACTIVE_TARGETS) ||
        nativeScrollbarAt(target, event.clientX, event.clientY)
      )
        return null;
      return { direction, target };
    };
    const move = (event: PointerEvent) => {
      if (event.buttons !== 0) return;
      const hit = allowedDirection(event);
      // Avoid invalidating the whole document's style on every pointer sample
      // while hovering the same native resize edge.
      if (hit && hover?.element === hit.target && hover.applied === CURSORS[hit.direction]
        && hover.element.style.getPropertyValue("cursor") === hover.applied) return;
      restoreCursor();
      if (
        !hit ||
        !(hit.target instanceof HTMLElement || hit.target instanceof SVGElement)
      )
        return;
      const element = hit.target;
      const applied = CURSORS[hit.direction];
      hover = {
        element,
        previous: element.style.getPropertyValue("cursor"),
        priority: element.style.getPropertyPriority("cursor"),
        applied,
      };
      element.style.setProperty("cursor", applied);
    };
    const down = (event: MouseEvent) => {
      restoreCursor();
      if (event.button !== 0) return;
      const hit = allowedDirection(event);
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      void resizeWindow.startResizeDragging(hit.direction).catch(() => {});
    };
    const leave = (event: PointerEvent) => {
      if (!event.relatedTarget) restoreCursor();
    };
    window.addEventListener("pointermove", move, {
      capture: true,
      passive: true,
    });
    window.addEventListener("mousedown", down, true);
    window.addEventListener("pointerout", leave, true);
    window.addEventListener("blur", restoreCursor);
    return () => {
      restoreCursor();
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("pointerout", leave, true);
      window.removeEventListener("blur", restoreCursor);
    };
  }, [resizeWindow, nativeScale]);

  if (!resizeWindow) return null;
  return (
    <div data-window-resize-handles aria-hidden="true" style={{
      "--window-resize-edge": `${edge}px`,
      "--window-resize-corner": `${corner}px`,
    } as CSSProperties}>
      {DIRECTIONS.map((direction) => (
        <div
          key={direction}
          data-window-resize-direction={direction}
          data-tauri-drag-region="false"
        />
      ))}
    </div>
  );
}
