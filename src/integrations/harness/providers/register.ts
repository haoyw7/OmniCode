import { ensureClaudeRegistered } from "./claude/claudeAdapter";
import { ensureCodexRegistered } from "./codex/codexAdapter";
import { ensureCursorRegistered } from "./cursor/cursorAdapter";
import { ensureFxRegistered } from "./fx/fxAdapter";
import { ensureGrokRegistered } from "./grok/grokAdapter";
import { ensureHermesRegistered } from "./hermes/hermesAdapter";
import { ensureOpenCodeRegistered } from "./opencode/opencodeAdapter";
import { ensureOmpRegistered } from "./omp/ompAdapter";
import { ensurePiRegistered } from "./pi/piAdapter";
import { ensureAntigravityRegistered } from "./antigravity/antigravityAdapter";
import { ensureKimiCodeRegistered } from "./kimicode/kimiCodeAdapter";

/** Register all known live harness adapters. Idempotent. */
export function registerBuiltinHarnesses(): void {
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
  ensureKimiCodeRegistered();
}
