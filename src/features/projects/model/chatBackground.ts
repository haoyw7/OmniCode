import { saveChatBackground, removeChatBackgroundAsset, saveProjectBackground, removeProjectBackground, nativeAssetUrl } from "../../../platform/tauri/appearanceAssets";
import { pickNativeFile } from "../../../platform/tauri/dialogs";
import { activePreferenceStore } from "../../settings/model/sharedPreferences";
import { parsePreferenceAsset, preferenceAssetUrl, uploadPreferenceBackground } from "../../settings/model/preferenceAssets";
import { remoteProjectFor, parseRemotePath } from "../../connections/model/remoteProjects";

export async function pickAndSaveChatBackground(): Promise<string | null> {
  const sourcePath = await pickNativeFile({
    title: "Choose chat background",
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp"],
      },
    ],
  });
  if (typeof sourcePath !== "string" || !sourcePath) return null;
  return saveChatBackground(sourcePath);
}

export function removeChatBackground(): Promise<void> {
  return removeChatBackgroundAsset();
}

export async function pickAndSaveProjectChatBackground(
  project: string,
): Promise<string | null> {
  const sourcePath = await pickNativeFile({
    title: "Choose project chat background",
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp"],
      },
    ],
  });
  if (typeof sourcePath !== "string" || !sourcePath) return null;
  const saved = await saveProjectBackground(project, sourcePath);
  return activePreferenceStore() ? uploadPreferenceBackground(saved,
    remoteProjectFor(project)?.environmentId ?? parseRemotePath(project)?.environmentId ?? activePreferenceStore()!.hostId) : saved;
}

export function clearProjectChatBackground(project: string): Promise<void> {
  return removeProjectBackground(project);
}

export function projectChatBackgroundSrc(
  path: string,
  revision: number,
): string {
  if (parsePreferenceAsset(path)) return preferenceAssetUrl(path) ?? "";
  return `${nativeAssetUrl(path)}?v=${revision}`;
}
