import { ensureClaudeRegistered } from "./providers/claude/claudeAdapter";
import { ensureCodexRegistered } from "./providers/codex/codexAdapter";
import { ensureCursorRegistered } from "./providers/cursor/cursorAdapter";
import { ensureFxRegistered } from "./providers/fx/fxAdapter";
import { ensureGrokRegistered } from "./providers/grok/grokAdapter";
import { ensureHermesRegistered } from "./providers/hermes/hermesAdapter";
import { ensureDeepseekRegistered } from "./providers/deepseek/deepseekAdapter";
import { ensureOpenCodeRegistered } from "./providers/opencode/opencodeAdapter";
import { ensureOmpRegistered } from "./providers/omp/ompAdapter";
import { ensurePiRegistered } from "./providers/pi/piAdapter";
import { ensureAntigravityRegistered } from "./providers/antigravity/antigravityAdapter";
import { ensureWorkBuddyRegistered } from "./providers/workbuddy/workbuddyAdapter";

/** Register all known live harness adapters. Idempotent. */
export function registerBuiltinHarnesses(): void {
  ensureDeepseekRegistered();
  ensureClaudeRegistered();
  ensureCursorRegistered();
  ensureCodexRegistered();
  ensureGrokRegistered();
  ensureOpenCodeRegistered();
  ensurePiRegistered();
  ensureOmpRegistered();
  ensureFxRegistered();
  ensureHermesRegistered();
  ensureAntigravityRegistered();
  ensureWorkBuddyRegistered();
}
