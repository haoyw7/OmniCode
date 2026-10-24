import type { TextPromptInput } from "../src/integrations/harness/core/registry";
import { runClaudeTextPrompt } from "../src/integrations/harness/providers/claude/claudeText";
import { runCodexTextPrompt } from "../src/integrations/harness/providers/codex/codexText";
import { runCursorTextPrompt } from "../src/integrations/harness/providers/cursor/cursorText";
import { runGrokTextPrompt } from "../src/integrations/harness/providers/grok/grokText";
import { runOpenCodeTextPrompt } from "../src/integrations/harness/providers/opencode/opencodeText";
import { runPiTextPrompt, runOmpTextPrompt } from "../src/integrations/harness/providers/pi/piText";

/** Host composition root for isolated, read-only provider calls. */
const runners: Record<string, (input: TextPromptInput) => Promise<string>> = {
  claude: runClaudeTextPrompt,
  codex: runCodexTextPrompt,
  cursor: runCursorTextPrompt,
  grok: runGrokTextPrompt,
  opencode: runOpenCodeTextPrompt,
  pi: runPiTextPrompt,
  omp: runOmpTextPrompt,
};

export function supportsHostTextPrompt(harness: string): boolean {
  return Object.hasOwn(runners, harness);
}

export function runHostTextPrompt(input: TextPromptInput & { harness: string }): Promise<string> {
  if (!supportsHostTextPrompt(input.harness))
    return Promise.reject(new Error(`${input.harness} does not support isolated text prompts`));
  input.signal?.throwIfAborted();
  return runners[input.harness](input);
}
