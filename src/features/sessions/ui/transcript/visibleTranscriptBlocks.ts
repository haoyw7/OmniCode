import {
  providerSessionAccessIssue,
} from "../../../../integrations/harness/providers/sessionAccessErrors";
import {
  isHarnessAuthError,
  supportsHarnessLogin,
} from "../../../../integrations/harness/core/authSupport";
import { type Block, type HarnessId } from "../../model/session";

/** Hides login errors the harness handles itself and marks legacy session-access notices as errors. */
export function visibleTranscriptBlocks(
  sourceBlocks: Block[],
  harness: HarnessId | undefined,
): Block[] {
  let turnHarness = harness;
  let changed = false;
  const visibleBlocks: Block[] = [];
  for (const block of sourceBlocks) {
    if (block.role === "user")
      turnHarness = block.turnModel?.harness ?? harness;
    if (
      harness &&
      supportsHarnessLogin(harness) &&
      block.role === "system" &&
      block.notice === "error" &&
      isHarnessAuthError(block.text)
    ) {
      changed = true;
      continue;
    }
    // Older Host histories did not tag startup errors; keep ownership notices outside folded work.
    if (
      turnHarness &&
      block.role === "system" &&
      !block.interjection &&
      !block.notice &&
      providerSessionAccessIssue(turnHarness, block.text)
    ) {
      visibleBlocks.push({ ...block, notice: "error" });
      changed = true;
    } else {
      visibleBlocks.push(block);
    }
  }
  return changed ? visibleBlocks : sourceBlocks;
}
