import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";

/** Native workspace-window operations, without application state or policy. */
export function openNewWorkspaceWindow(): Promise<void> {
  return invoke("open_new_window");
}

export function setNativeAutosaveEnabled(enabled: boolean): Promise<void> {
  return invoke("autosave_set_enabled", { enabled });
}

export function openExternalUrl(url: string): Promise<void> {
  return openUrl(url);
}

export function onWorkspaceWindowFocusChanged(
  handler: Parameters<ReturnType<typeof getCurrentWindow>["onFocusChanged"]>[0],
) {
  return getCurrentWindow().onFocusChanged(handler);
}

export function onWorkspaceWindowCloseRequested(
  handler: Parameters<
    ReturnType<typeof getCurrentWindow>["onCloseRequested"]
  >[0],
) {
  return getCurrentWindow().onCloseRequested(handler);
}
