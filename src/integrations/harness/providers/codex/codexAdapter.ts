import { readCodexSessionTitle } from "./codex";
import {
  bindCodexSession,
  cancelCodexTurn,
  compactCodexContext,
  rewindCodexLastTurn,
  forgetCodexSession,
  keepCodexQuestionOpen,
  respondCodexApproval,
  respondCodexQuestion,
  sendCodexTurn,
  steerCodexTurn,
  stopCodexSession,
} from "./codex";
import {
  generateCodexBranchName,
  generateCodexCommitMessage,
  generateCodexPrContent,
} from "./codexGit";
import { refreshCodexCatalog } from "./codexCatalog";
import {
  runCodexTextPrompt,
  stopCodexTextPrompt,
  warmupCodexText,
} from "./codexText";
import {
  getHarness,
  registerHarness,
  type HarnessAdapter,
} from "../../core/registry";

export const codexAdapter: HarnessAdapter = {
  id: "codex",
  live: true,
  readSessionTitle: readCodexSessionTitle,
  sendTurn: sendCodexTurn,
  compactContext: compactCodexContext,
  rewindLastTurn: rewindCodexLastTurn,
  steerTurn: steerCodexTurn,
  cancelTurn: cancelCodexTurn,
  respondApproval: respondCodexApproval,
  respondQuestion: respondCodexQuestion,
  keepQuestionOpen: keepCodexQuestionOpen,
  stopSession: stopCodexSession,
  forgetSession: forgetCodexSession,
  bindSession: bindCodexSession,
  refreshCatalog: refreshCodexCatalog,
  generateCommitMessage: generateCodexCommitMessage,
  generatePrContent: generateCodexPrContent,
  generateBranchName: generateCodexBranchName,
  warmupText: warmupCodexText,
  runTextPrompt: runCodexTextPrompt,
  stopTextPrompt: stopCodexTextPrompt,
};

let registered = false;

export function ensureCodexRegistered(): void {
  if (registered && getHarness("codex") === codexAdapter) return;
  registerHarness(codexAdapter);
  registered = true;
}
