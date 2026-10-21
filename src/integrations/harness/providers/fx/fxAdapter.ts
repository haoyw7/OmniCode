import { PROVIDER_INTERACTION_CAPABILITIES } from "../interactionCapabilities";
import { readFxSessionTitle } from "./fx";
import {
  bindFxSession,
  cancelFxTurn,
  forgetFxSession,
  respondFxApproval,
  sendFxTurn,
  steerFxTurn,
  stopFxSession,
} from "./fx";
import { refreshFxCatalog } from "./fxCatalog";
import { registerHarness, type HarnessAdapter } from "../../core/registry";

export const fxAdapter: HarnessAdapter = {
  id: "fx",
  interactionCapabilities: PROVIDER_INTERACTION_CAPABILITIES.fx,
  readSessionTitle: readFxSessionTitle,
  sendTurn: sendFxTurn,
  steerTurn: steerFxTurn,
  cancelTurn: cancelFxTurn,
  respondApproval: respondFxApproval,
  stopSession: stopFxSession,
  forgetSession: forgetFxSession,
  bindSession: bindFxSession,
  refreshCatalog: refreshFxCatalog,
};

let registered = false;

export function ensureFxRegistered(): void {
  if (registered) return;
  registerHarness(fxAdapter);
  registered = true;
}
