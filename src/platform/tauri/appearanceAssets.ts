import { convertFileSrc, invoke } from "@tauri-apps/api/core";

/** Images here live under the application's data directory, not the project. */
export function saveChatBackground(sourcePath: string): Promise<string> {
  return invoke("save_chat_background", { sourcePath });
}

export function removeChatBackgroundAsset(): Promise<void> {
  return invoke("remove_chat_background");
}

export function saveProjectBackground(project: string, sourcePath: string): Promise<string> {
  return invoke("save_project_chat_background", { project, sourcePath });
}

export function removeProjectBackground(project: string): Promise<void> {
  return invoke("remove_project_chat_background", { project });
}

export function saveProjectLogoAsset(project: string, sourcePath: string): Promise<string> {
  return invoke("save_project_logo", { project, sourcePath });
}

export function removeProjectLogoAsset(project: string): Promise<void> {
  return invoke("remove_project_logo", { project });
}

export function forgetLogoAsset(path: string): Promise<void> {
  return invoke("forget_logo_file", { path });
}

export function nativeAssetUrl(path: string): string {
  return convertFileSrc(path);
}

export function listNativeFonts(): Promise<{ all: string[]; monospace: string[] }> {
  return invoke("list_system_fonts");
}

export function setNativeWindowGlass(enabled: boolean, background: { r: number; g: number; b: number }): Promise<void> {
  return invoke("set_window_glass_enabled", { enabled, background });
}

export function setNativeWindowBackgroundBlur(radius: number): Promise<void> {
  return invoke("set_window_background_blur", { radius });
}
