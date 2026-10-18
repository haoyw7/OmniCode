import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { HarnessId } from "../../sessions/model/session";
import { inspectHarnessBinary } from "../../../integrations/harness/core/child";
import { runtimeProviderBinaryPath } from "./providerBinaryPaths";
import {
  compareSemver,
  parseOpenCodeVersion,
} from "../../../integrations/harness/providers/opencode/opencodeProtocol";

/**
 * Harnesses with an npm version feed and a self-updater MonoCode can run.
 */
export const UPDATABLE_HARNESSES: ReadonlySet<HarnessId> = new Set([
  "claude",
  "codex",
  "opencode",
  "pi",
]);

export type HarnessUpdate = {
  harness: HarnessId;
  installed: string;
  latest: string;
};

export type HarnessUpdateDeps = {
  /** Installed harnesses the user has not hidden. */
  harnesses: HarnessId[];
  installedVersion: (harness: HarnessId) => Promise<string | undefined>;
  latestVersion: (harness: HarnessId) => Promise<string>;
};

/** Every window keeps its own model catalog, so each has to hear about it. */
const HARNESS_UPDATED_EVENT = "harness-updated";
const updateEventSource = crypto.randomUUID();

type HarnessUpdatedEvent = {
  harness: HarnessId;
  source: string;
};

export function announceHarnessUpdated(harness: HarnessId): Promise<void> {
  return emit(HARNESS_UPDATED_EVENT, { harness, source: updateEventSource });
}

export function onHarnessUpdated(
  handler: (harness: HarnessId) => void,
): Promise<UnlistenFn> {
  return listen<HarnessUpdatedEvent>(HARNESS_UPDATED_EVENT, (event) => {
    // The sender awaited its local refresh before announcing the update.
    if (event.payload.source === updateEventSource) return;
    handler(event.payload.harness);
  });
}

/** A manual re-detect of installed CLIs, e.g. Settings' Refresh button. */
const HARNESSES_REFRESHED_EVENT = "harnesses-refreshed";

type HarnessesRefreshedEvent = {
  harnesses: HarnessId[];
  source: string;
};

export function announceHarnessesRefreshed(
  harnesses: HarnessId[],
): Promise<void> {
  return emit(HARNESSES_REFRESHED_EVENT, {
    harnesses,
    source: updateEventSource,
  });
}

export function onHarnessesRefreshed(
  handler: (harnesses: HarnessId[]) => void,
): Promise<UnlistenFn> {
  return listen<HarnessesRefreshedEvent>(HARNESSES_REFRESHED_EVENT, (event) => {
    // The sender already refreshed its own stores.
    if (event.payload.source === updateEventSource) return;
    handler(event.payload.harnesses);
  });
}

export function claimLaunchHarnessUpdateCheck(): Promise<boolean> {
  return invoke<boolean>("harness_update_check_claim");
}

export function fetchLatestHarnessVersion(harness: HarnessId): Promise<string> {
  return invoke<string>("harness_latest_version", { provider: harness });
}

/**
 * A failed lookup, offline or otherwise, drops that harness silently: this
 * runs unprompted at launch and must never surface an error of its own.
 * Nothing is remembered between launches: a harness still behind is offered
 * again, at whatever release is newest by then.
 */
export async function findHarnessUpdates({
  harnesses,
  installedVersion,
  latestVersion,
}: HarnessUpdateDeps): Promise<HarnessUpdate[]> {
  const results = await Promise.all(
    harnesses.map(async (harness): Promise<HarnessUpdate | null> => {
      if (!UPDATABLE_HARNESSES.has(harness)) return null;
      try {
        const [installedOutput, latestOutput] = await Promise.all([
          installedVersion(harness),
          latestVersion(harness),
        ]);
        const installed = parseOpenCodeVersion(installedOutput ?? "");
        const latest = parseOpenCodeVersion(latestOutput);
        if (!installed || !latest) return null;
        if (compareSemver(latest, installed) <= 0) return null;
        return { harness, installed, latest };
      } catch {
        return null;
      }
    }),
  );
  return results.filter((update): update is HarnessUpdate => update !== null);
}

export type HarnessInstall = {
  path: string;
  realPath: string;
  source: "npm" | "homebrew" | "bundled" | "other";
  /** The app a bundled copy ships inside, e.g. ChatGPT. */
  bundledBy: string | null;
  /** Other installed, non-bundled copies on the search path. */
  alternatives: { path: string; version: string }[];
};

/** How the binary MonoCode runs for `harness` was installed. */
export function fetchHarnessInstall(harness: HarnessId): Promise<HarnessInstall> {
  return invoke<HarnessInstall>("harness_install_info", {
    provider: harness,
    binaryPath: runtimeProviderBinaryPath(harness),
  });
}

export type HarnessVersionInfo = {
  installed?: string;
  /** Only for `UPDATABLE_HARNESSES`; the rest have no feed to compare with. */
  latest?: string;
  /** Set when the running copy ships inside another app and cannot self-update. */
  bundledBy?: string;
  /** The newest other installed copy, when it is ahead of the running one. */
  newerCopy?: { path: string; version: string };
};

/**
 * Settings reads versions each time it opens, so the npm lookup is reused for
 * a while; the manual refresh passes `force` to ask the registry again.
 */
const LATEST_TTL_MS = 10 * 60_000;
const latestCache = new Map<HarnessId, { version: string; at: number }>();

async function cachedLatestVersion(
  harness: HarnessId,
  force: boolean,
): Promise<string> {
  const cached = latestCache.get(harness);
  if (!force && cached && Date.now() - cached.at < LATEST_TTL_MS) {
    return cached.version;
  }
  const version = await fetchLatestHarnessVersion(harness);
  latestCache.set(harness, { version, at: Date.now() });
  return version;
}

/** Either side is left out when it cannot be read, offline or otherwise. */
export async function readHarnessVersions(
  harness: HarnessId,
  options?: { force?: boolean },
): Promise<HarnessVersionInfo> {
  const updatable = UPDATABLE_HARNESSES.has(harness);
  const [installed, latest, install] = await Promise.all([
    inspectHarnessBinary(harness)
      .then((result) => parseOpenCodeVersion(result.version ?? "") ?? undefined)
      .catch(() => undefined),
    updatable
      ? cachedLatestVersion(harness, options?.force ?? false)
          .then((version) => parseOpenCodeVersion(version) ?? undefined)
          .catch(() => undefined)
      : undefined,
    updatable ? fetchHarnessInstall(harness).catch(() => undefined) : undefined,
  ]);
  return {
    installed,
    latest,
    bundledBy:
      install?.source === "bundled"
        ? (install.bundledBy ?? "another app")
        : undefined,
    newerCopy: installed ? newestCopyAbove(install, installed) : undefined,
  };
}

function newestCopyAbove(
  install: HarnessInstall | undefined,
  installed: string,
): HarnessVersionInfo["newerCopy"] {
  let best: HarnessVersionInfo["newerCopy"];
  for (const copy of install?.alternatives ?? []) {
    const version = parseOpenCodeVersion(copy.version);
    if (!version || compareSemver(version, best?.version ?? installed) <= 0) {
      continue;
    }
    best = { path: copy.path, version };
  }
  return best;
}

export function hasHarnessUpdate(info: HarnessVersionInfo | undefined): boolean {
  return Boolean(
    info?.installed &&
      info.latest &&
      compareSemver(info.latest, info.installed) > 0,
  );
}
