import type { HarnessId } from "../../../features/sessions/model/session";
import { isHarnessAvailable } from "./availability";
import type { PrContent } from "../../../features/source-control/model/gitText";
import {
  generateHarnessCommitMessage,
  generateHarnessPrContent,
} from "./registry";

const TEXT_HARNESSES: HarnessId[] = [
  "claude",
  "cursor",
  "codex",
  "grok",
  "opencode",
];

/** Pick the harness used for commit messages and PR text. */
export function pickTextHarness(preferred?: HarnessId): HarnessId {
  const ordered =
    preferred && TEXT_HARNESSES.includes(preferred)
      ? [preferred, ...TEXT_HARNESSES.filter((id) => id !== preferred)]
      : TEXT_HARNESSES;
  for (const id of ordered) {
    if (isHarnessAvailable(id)) return id;
  }
  return preferred && TEXT_HARNESSES.includes(preferred) ? preferred : "cursor";
}

export function generateCommitMessage(
  cwd: string,
  preferred?: HarnessId,
  signal?: AbortSignal,
): Promise<string> {
  return generateHarnessCommitMessage(pickTextHarness(preferred), cwd, signal);
}

export function generatePrContent(
  cwd: string,
  preferred?: HarnessId,
): Promise<(PrContent & { base: string; head: string }) | null> {
  return generateHarnessPrContent(pickTextHarness(preferred), cwd);
}
