import { readGrokSessionTitle } from "./grok";
import {
  bindGrokSession,
  cancelGrokTurn,
  compactGrokContext,
  forgetGrokSession,
  respondGrokApproval,
  respondGrokQuestion,
  sendGrokTurn,
  steerGrokTurn,
  stopGrokSession,
} from "./grok";
import { refreshGrokCatalog } from "./grokCatalog";
import {
  generateGrokBranchName,
  generateGrokCommitMessage,
  generateGrokPrContent,
} from "./grokGit";
import {
  runGrokTextPrompt,
  stopGrokTextPrompt,
  warmupGrokText,
} from "./grokText";
import { registerHarness, type HarnessAdapter } from "../../core/registry";

export const grokAdapter: HarnessAdapter = {
  id: "grok",
  live: true,
  readSessionTitle: readGrokSessionTitle,
  canSteer: false,
  sendTurn: sendGrokTurn,
  compactContext: compactGrokContext,
  steerTurn: steerGrokTurn,
  cancelTurn: cancelGrokTurn,
  respondApproval: respondGrokApproval,
  respondQuestion: respondGrokQuestion,
  stopSession: stopGrokSession,
  forgetSession: forgetGrokSession,
  bindSession: bindGrokSession,
  refreshCatalog: refreshGrokCatalog,
  generateCommitMessage: generateGrokCommitMessage,
  generatePrContent: generateGrokPrContent,
  generateBranchName: generateGrokBranchName,
  warmupText: warmupGrokText,
  runTextPrompt: runGrokTextPrompt,
  stopTextPrompt: stopGrokTextPrompt,
};

let registered = false;

export function ensureGrokRegistered(): void {
  if (registered) return;
  registerHarness(grokAdapter);
  registered = true;
}
