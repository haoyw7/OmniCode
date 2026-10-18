import {
  buildBranchNamePrompt,
  parseBranchName,
} from "../../../features/source-control/model/gitText";
import type { TextPromptInput } from "./registry";

export async function generateTextBranchName(
  run: (input: TextPromptInput) => Promise<string>,
  cwd: string,
  message: string,
): Promise<string | null> {
  return parseBranchName(
    await run({
      cwd,
      prompt: buildBranchNamePrompt(message),
      timeoutMs: 90_000,
    }),
  );
}
