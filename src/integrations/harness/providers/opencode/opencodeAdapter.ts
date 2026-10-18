import { readOpenCodeSessionTitle } from "./opencode";
import {
  bindOpenCodeSession,
  cancelOpenCodeTurn,
  compactOpenCodeContext,
  forgetOpenCodeSession,
  respondOpenCodeApproval,
  respondOpenCodeQuestion,
  rewindOpenCodeLastTurn,
  sendOpenCodeTurn,
  steerOpenCodeTurn,
  stopOpenCodeSession,
} from "./opencode";
import { refreshOpenCodeCatalog } from "./opencodeCatalog";
import {
  generateOpenCodeBranchName,
  generateOpenCodeCommitMessage,
  generateOpenCodePrContent,
} from "./opencodeGit";
import {
  runOpenCodeTextPrompt,
  stopOpenCodeTextPrompt,
  warmupOpenCodeText,
} from "./opencodeText";
import { registerHarness, type HarnessAdapter } from "../../core/registry";

export const openCodeAdapter: HarnessAdapter = {
  id: "opencode",
  live: true,
  readSessionTitle: readOpenCodeSessionTitle,
  rewindLastTurn: rewindOpenCodeLastTurn,
  sendTurn: sendOpenCodeTurn,
  compactContext: compactOpenCodeContext,
  steerTurn: steerOpenCodeTurn,
  cancelTurn: cancelOpenCodeTurn,
  respondApproval: respondOpenCodeApproval,
  respondQuestion: respondOpenCodeQuestion,
  stopSession: stopOpenCodeSession,
  forgetSession: forgetOpenCodeSession,
  bindSession: bindOpenCodeSession,
  refreshCatalog: refreshOpenCodeCatalog,
  generateCommitMessage: generateOpenCodeCommitMessage,
  generatePrContent: generateOpenCodePrContent,
  generateBranchName: generateOpenCodeBranchName,
  warmupText: warmupOpenCodeText,
  runTextPrompt: runOpenCodeTextPrompt,
  stopTextPrompt: stopOpenCodeTextPrompt,
};

let registered = false;

export function ensureOpenCodeRegistered(): void {
  if (registered) return;
  registerHarness(openCodeAdapter);
  registered = true;
}
