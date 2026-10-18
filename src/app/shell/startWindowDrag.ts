import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent } from "react";
import { IS_LINUX, IS_WIN } from "../../platform/tauri/platform";

const CONTROLS = [
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
  "[role='menuitem']",
  "[role='tab']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='option']",
  "[role='slider']",
  "[role='combobox']",
  "[role='spinbutton']",
  "[role='treeitem']",
  "[data-tauri-drag-region='false']",
].join(",");

/** Declare one owner for title-bar gestures on each platform. */
export function windowDragRegion() {
  return {
    "data-window-drag-region": "deep",
    "data-tauri-drag-region": IS_LINUX || IS_WIN ? "false" : "deep",
    onMouseDownCapture: startWindowDrag,
  };
}

/** Linux/Windows delegate one gesture to Tauri; macOS uses its injected handler. */
export function startWindowDrag(event: MouseEvent<HTMLElement>): boolean {
  if (
    !(IS_LINUX || IS_WIN) ||
    !isTauri() ||
    event.button !== 0 ||
    (event.detail !== 1 && event.detail !== 2) ||
    event.defaultPrevented ||
    event.currentTarget.getAttribute("data-window-drag-region") !== "deep"
  )
    return false;
  const target =
    event.target instanceof Element
      ? event.target
      : event.target instanceof Node
        ? event.target.parentElement
        : null;
  if (!target || !event.currentTarget.contains(target)) return false;
  const control = target.closest(CONTROLS);
  if (control && control !== event.currentTarget && event.currentTarget.contains(control)) return false;

  // Leave the native GTK resize rim to its button-press handler. A deep title
  // region must not also start a move (including Tauri's document fallback).
  if (IS_LINUX && (
    event.clientX < 10 || event.clientY < 10 ||
    event.clientX >= window.innerWidth - 10 || event.clientY >= window.innerHeight - 10
  )) {
    event.stopPropagation();
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  const win = getCurrentWindow();
  void (event.detail === 2 ? win.toggleMaximize() : win.startDragging()).catch(() => {});
  return true;
}
