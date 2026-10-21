/** Optional startup detail; older clients can continue using executionState.phase. */
export type StartupStage = "connecting-wsl" | "copying-runtime" | "checking-runtime" |
  "checking-provider" | "resolving-dependencies" | "downloading" | "installing" |
  "installing-dependencies" | "verifying" | "packing" | "copying" | "configuring" |
  "initializing" | "preparing-workspace" | "loading-skills" | "stopping-previous";

export interface StartupProgress {
  stage: StartupStage;
  completed?: number;
  total?: number;
  unit?: "bytes" | "files" | "packages";
  downloaded?: number;
}

const stages: StartupStage[] = ["connecting-wsl", "copying-runtime", "checking-runtime",
  "checking-provider", "resolving-dependencies", "downloading", "installing",
  "installing-dependencies", "verifying", "packing", "copying", "configuring",
  "initializing", "preparing-workspace", "loading-skills", "stopping-previous"];

export function parseStartupProgress(value: unknown): StartupProgress | undefined {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (!stages.includes(record.stage as StartupStage)) return;
  const result: StartupProgress = { stage: record.stage as StartupStage };
  for (const key of ["completed", "total", "downloaded"] as const) {
    if (record[key] === undefined) continue;
    if (typeof record[key] !== "number" || !Number.isSafeInteger(record[key]) || record[key] < 0) return;
    result[key] = record[key];
  }
  if (record.unit !== undefined) {
    if (!["bytes", "files", "packages"].includes(String(record.unit))) return;
    result.unit = record.unit as StartupProgress["unit"];
  }
  if (result.total !== undefined && (result.total === 0 || (result.completed ?? 0) > result.total)) return;
  return result;
}
