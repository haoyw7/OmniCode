import { parseStartupProgress, type StartupStage } from "../../../integrations/harness/core/startupProgress";
import type { TranslationValues } from "../../../shared/i18n/language";

export const startupLabels: Record<StartupStage, string> = {
  "connecting-wsl": "Connecting to WSL…",
  "copying-runtime": "Copying WSL runtime…",
  "checking-runtime": "Checking WSL runtime…",
  "checking-provider": "Checking agent runtime…",
  "resolving-dependencies": "Resolving agent dependencies…",
  downloading: "Downloading agent runtime…",
  installing: "Extracting agent runtime…",
  "installing-dependencies": "Downloading and installing dependencies…",
  verifying: "Verifying agent files…",
  packing: "Packing agent files…",
  copying: "Copying agent to WSL…",
  configuring: "Configuring agent…",
  initializing: "Initializing agent…",
  "preparing-workspace": "Preparing workspace…",
  "loading-skills": "Loading agent skills…",
  "stopping-previous": "Stopping previous agent…",
};

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

export function startupProgressText(value: unknown, t: (key: string, values?: TranslationValues) => string): string | undefined {
  const progress = parseStartupProgress(value);
  if (!progress || progress.completed === undefined) return;
  const { completed, total, unit } = progress;
  if (unit === "packages" && progress.downloaded !== undefined)
    return t("{downloaded} packages downloaded · {completed} processed", { downloaded: progress.downloaded, completed });
  let text: string;
  if (unit === "bytes") text = total === undefined ? bytes(completed) : `${bytes(completed)} / ${bytes(total)}`;
  else if (unit === "files" || unit === "packages") {
    text = t(total === undefined ? unit === "files" ? "{completed} files" : "{completed} packages"
      : unit === "files" ? "{completed} / {total} files" : "{completed} / {total} packages", { completed, total: total ?? 0 });
  } else return;
  return total === undefined ? text : `${text} (${Math.floor(completed / total * 100)}%)`;
}
