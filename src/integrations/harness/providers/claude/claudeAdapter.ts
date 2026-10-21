import { PROVIDER_INTERACTION_CAPABILITIES } from "../interactionCapabilities";
import { readClaudeSessionTitle } from "./claude";
import {
  bindClaudeSession,
  cancelClaudeTurn,
  compactClaudeContext,
  forgetClaudeSession,
  respondClaudeApproval,
  respondClaudeQuestion,
  restoreClaudeTaskLists,
  sendClaudeTurn,
  steerClaudeTurn,
  stopClaudeSession,
  stopClaudeBackgroundTask,
} from "./claude";
import { refreshClaudeCatalog } from "./claudeCatalog";
import {
  generateClaudeBranchName,
  generateClaudeCommitMessage,
  generateClaudePrContent,
} from "./claudeGit";
import {
  runClaudeTextPrompt,
  stopClaudeTextPrompt,
  warmupClaudeText,
} from "./claudeText";
import { registerHarness, type HarnessAdapter } from "../../core/registry";

export const claudeAdapter: HarnessAdapter = {
  id: "claude",
  interactionCapabilities: PROVIDER_INTERACTION_CAPABILITIES.claude,
  readSessionTitle: readClaudeSessionTitle,
  sendTurn: sendClaudeTurn,
  compactContext: compactClaudeContext,
  steerTurn: steerClaudeTurn,
  cancelTurn: cancelClaudeTurn,
  stopBackgroundTask: stopClaudeBackgroundTask,
  respondApproval: respondClaudeApproval,
  respondQuestion: respondClaudeQuestion,
  stopSession: stopClaudeSession,
  forgetSession: forgetClaudeSession,
  bindSession: bindClaudeSession,
  restoreTaskLists: restoreClaudeTaskLists,
  refreshCatalog: refreshClaudeCatalog,
  generateCommitMessage: generateClaudeCommitMessage,
  generatePrContent: generateClaudePrContent,
  generateBranchName: generateClaudeBranchName,
  warmupText: warmupClaudeText,
  runTextPrompt: runClaudeTextPrompt,
  stopTextPrompt: stopClaudeTextPrompt,
};

let registered = false;

export function ensureClaudeRegistered(): void {
  if (registered) return;
  registerHarness(claudeAdapter);
  registered = true;
}
