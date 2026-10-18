import { App } from "@capacitor/app";
import {
  Capacitor,
  CapacitorHttp,
  registerPlugin,
  type PluginListenerHandle,
} from "@capacitor/core";
import lanConfig from "../../mobile/update-config.json";
import releaseConfig from "../../mobile/update-config.release.json";

const release =
  import.meta.env.MODE === "release" ||
  import.meta.env.MONOCODE_UPDATE_CHANNEL !== "lan";
const config = release ? releaseConfig : lanConfig;
const manifestPath = release ? releaseConfig.manifestPath : "/latest.json";
const downloadPrefix = release ? releaseConfig.downloadPrefix : "/apk/";

export const updateBaseUrl = config.baseUrl;
export const updateBaseUrls = [
  ...new Set([config.baseUrl, ...config.baseUrls]),
];
export interface MobileUpdate {
  sourceUrl?: string;
  packageId: string;
  versionName: string;
  versionCode: number;
  downloadPath: string;
  sha256: string;
  size: number;
  publishedAt: string;
  notes?: string;
}
export interface InstalledBuild {
  version: string;
  build: number;
}
export const Updates = registerPlugin<{
  installPermission(options: {
    request: boolean;
  }): Promise<{ allowed: boolean }>;
  downloadAndInstall(options: {
    url: string;
    sha256: string;
    size: number;
    versionCode: number;
  }): Promise<void>;
  addListener(
    event: "downloadProgress",
    callback: (progress: { received: number; total: number }) => void,
  ): Promise<PluginListenerHandle>;
}>("MonoCodeUpdates");

export function parseMobileUpdate(value: unknown): MobileUpdate {
  const update = value as Partial<MobileUpdate> | null;
  if (
    !update ||
    update.packageId !== config.packageId ||
    !Number.isInteger(update.versionCode) ||
    update.versionCode! < 1 ||
    update.versionCode! > 2100000000 ||
    update.downloadPath !==
      `${downloadPrefix}monocode-${update.versionCode}.apk` ||
    typeof update.versionName !== "string" ||
    !update.versionName ||
    typeof update.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(update.sha256) ||
    !Number.isInteger(update.size) ||
    update.size! <= 0 ||
    update.size! > 512 * 1024 * 1024 ||
    typeof update.publishedAt !== "string" ||
    !Number.isFinite(Date.parse(update.publishedAt)) ||
    (update.notes !== undefined && typeof update.notes !== "string")
  )
    throw new Error("Invalid update information.");
  return update as MobileUpdate;
}

export const hasMobileUpdate = (
  installed: InstalledBuild,
  update: MobileUpdate,
) => update.versionCode > installed.build;

export async function getInstalledBuild(): Promise<InstalledBuild> {
  if (!Capacitor.isNativePlatform())
    return { version: "Browser preview", build: 0 };
  const info = await App.getInfo();
  const build = Number(info.build);
  if (!Number.isInteger(build) || build < 1)
    throw new Error("Unable to read installed app version.");
  return { version: info.version, build };
}

export function updateDownloadUrl(update: MobileUpdate): string {
  const source = update.sourceUrl ?? updateBaseUrl;
  if (!updateBaseUrls.includes(source))
    throw new Error("Invalid update information.");
  return `${source}${update.downloadPath}`;
}

async function checkUpdateSource(source: string): Promise<MobileUpdate> {
  const url = `${source}${manifestPath}`;
  let data: unknown;
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({
      url,
      readTimeout: 15000,
      connectTimeout: 5000,
      responseType: "json",
    });
    if (response.status !== 200)
      throw new Error("Unable to reach the update server.");
    data =
      typeof response.data === "string"
        ? JSON.parse(response.data)
        : response.data;
  } else {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Unable to reach the update server.");
    data = await response.json();
  }
  // Use our configured address, never an address supplied by the manifest.
  return { ...parseMobileUpdate(data), sourceUrl: source };
}

export async function checkMobileUpdate(): Promise<MobileUpdate> {
  let failure: unknown;
  for (const source of updateBaseUrls) {
    try {
      return await checkUpdateSource(source);
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}
