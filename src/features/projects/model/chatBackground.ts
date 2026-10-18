import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { activePreferenceStore } from "../../settings/model/sharedPreferences";
import { parsePreferenceAsset, preferenceAssetUrl, uploadPreferenceBackground } from "../../settings/model/preferenceAssets";
import { remoteProjectFor, parseRemotePath } from "../../connections/model/remoteProjects";

export async function pickAndSaveChatBackground(): Promise<string | null> {
  const sourcePath = await open({
    multiple: false,
    directory: false,
    title: "Choose chat background",
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp"],
      },
    ],
  });
  if (typeof sourcePath !== "string" || !sourcePath) return null;
  return invoke<string>("save_chat_background", { sourcePath });
}

export function removeChatBackground(): Promise<void> {
  return invoke<void>("remove_chat_background");
}

export async function pickAndSaveProjectChatBackground(
  project: string,
): Promise<string | null> {
  const sourcePath = await open({
    multiple: false,
    directory: false,
    title: "Choose project chat background",
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp"],
      },
    ],
  });
  if (typeof sourcePath !== "string" || !sourcePath) return null;
  const saved = await invoke<string>("save_project_chat_background", {
    project,
    sourcePath,
  });
  return activePreferenceStore() ? uploadPreferenceBackground(saved,
    remoteProjectFor(project)?.environmentId ?? parseRemotePath(project)?.environmentId ?? activePreferenceStore()!.hostId) : saved;
}

export function clearProjectChatBackground(project: string): Promise<void> {
  return invoke<void>("remove_project_chat_background", { project });
}

export function projectChatBackgroundSrc(
  path: string,
  revision: number,
): string {
  if (parsePreferenceAsset(path)) return preferenceAssetUrl(path) ?? "";
  return `${convertFileSrc(path)}?v=${revision}`;
}
