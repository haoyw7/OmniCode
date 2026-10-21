import { PROVIDER_INTERACTION_CAPABILITIES } from "../interactionCapabilities";
import { readAntigravitySessionTitle } from "./antigravity";
import {
  bindAntigravitySession,
  cancelAntigravityTurn,
  forgetAntigravitySession,
  respondAntigravityApproval,
  sendAntigravityTurn,
  steerAntigravityTurn,
  stopAntigravitySession,
} from "./antigravity";
import { refreshAntigravityCatalog } from "./antigravityCatalog";
import { registerHarness, type HarnessAdapter } from "../../core/registry";

export const antigravityAdapter: HarnessAdapter = {
  id: "antigravity",
  interactionCapabilities: PROVIDER_INTERACTION_CAPABILITIES.antigravity,
  readSessionTitle: readAntigravitySessionTitle,
  sendTurn: sendAntigravityTurn,
  steerTurn: steerAntigravityTurn,
  cancelTurn: cancelAntigravityTurn,
  respondApproval: respondAntigravityApproval,
  stopSession: stopAntigravitySession,
  forgetSession: forgetAntigravitySession,
  bindSession: bindAntigravitySession,
  refreshCatalog: refreshAntigravityCatalog,
};

let registered = false;

export function ensureAntigravityRegistered(): void {
  if (registered) return;
  registerHarness(antigravityAdapter);
  registered = true;
}
