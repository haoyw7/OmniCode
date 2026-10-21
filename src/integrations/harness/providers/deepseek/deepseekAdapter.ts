import { PROVIDER_INTERACTION_CAPABILITIES } from "../interactionCapabilities";
import { registerHarness, type HarnessAdapter } from "../../core/registry";
import {
  bindDeepseekSession,
  cancelDeepseekTurn,
  forgetDeepseekSession,
  keepDeepseekQuestionOpen,
  respondDeepseekApproval,
  respondDeepseekQuestion,
  sendDeepseekTurn,
  steerDeepseekTurn,
  stopDeepseekSession,
  stopDeepseekBackgroundTask,
} from "./deepseek";
import { refreshDeepseekCatalog } from "./deepseekCatalog";

export const deepseekAdapter: HarnessAdapter = {
  id: "deepseek",
  interactionCapabilities: PROVIDER_INTERACTION_CAPABILITIES.deepseek,
  sendTurn: sendDeepseekTurn,
  steerTurn: steerDeepseekTurn,
  cancelTurn: cancelDeepseekTurn,
  stopBackgroundTask: stopDeepseekBackgroundTask,
  respondApproval: respondDeepseekApproval,
  respondQuestion: respondDeepseekQuestion,
  keepQuestionOpen: keepDeepseekQuestionOpen,
  bindSession: bindDeepseekSession,
  stopSession: stopDeepseekSession,
  forgetSession: forgetDeepseekSession,
  refreshCatalog: refreshDeepseekCatalog,
};
let registered = false;
export function ensureDeepseekRegistered() {
  if (registered) return;
  registerHarness(deepseekAdapter);
  registered = true;
}
