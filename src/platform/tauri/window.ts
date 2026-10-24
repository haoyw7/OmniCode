import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type WindowResizeDirection = "North" | "East" | "South" | "West"
  | "NorthWest" | "NorthEast" | "SouthWest" | "SouthEast";

/** The shell's window surface. No process or workspace authority is exposed. */
export interface DesktopWindow {
  readonly label: string;
  minimize(): Promise<void>;
  unminimize(): Promise<void>;
  show(): Promise<void>;
  setFocus(): Promise<void>;
  close(): Promise<void>;
  toggleMaximize(): Promise<void>;
  startDragging(): Promise<void>;
  startResizeDragging(direction: WindowResizeDirection): Promise<void>;
  isResizable(): Promise<boolean>;
  isMaximized(): Promise<boolean>;
  isFullscreen(): Promise<boolean>;
  scaleFactor(): Promise<number>;
  setTheme(theme: "light" | "dark" | null): Promise<void>;
  onResized(handler: () => void): Promise<() => void>;
  onFocusChanged(handler: (event: { payload: boolean }) => void): Promise<() => void>;
  onCloseRequested(handler: (event: { preventDefault(): void }) => void): Promise<() => void>;
}

export function isDesktopShell(): boolean {
  return isTauri();
}

export function desktopWindow(): DesktopWindow {
  const win = getCurrentWindow();
  return {
    label: win.label,
    minimize: () => win.minimize(),
    unminimize: () => win.unminimize(),
    show: () => win.show(),
    setFocus: () => win.setFocus(),
    close: () => win.close(),
    toggleMaximize: () => win.toggleMaximize(),
    startDragging: () => win.startDragging(),
    startResizeDragging: (direction) => win.startResizeDragging(direction),
    isResizable: () => win.isResizable(),
    isMaximized: () => win.isMaximized(),
    isFullscreen: () => win.isFullscreen(),
    scaleFactor: () => win.scaleFactor(),
    setTheme: (theme) => win.setTheme(theme),
    onResized: (handler) => win.onResized(handler),
    onFocusChanged: (handler) => win.onFocusChanged(handler),
    onCloseRequested: (handler) => win.onCloseRequested(handler),
  };
}
