import { registerHarness, type HarnessAdapter } from "../../core/registry";
import {
  bindKimiCodeSession,
  cancelKimiCodeTurn,
  discoverKimiCodeModels,
  forgetKimiCodeSession,
  readKimiCodeSessionTitle,
  respondKimiCodeApproval,
  respondKimiCodeQuestion,
  sendKimiCodeTurn,
  steerKimiCodeTurn,
  stopKimiCodeSession,
} from "./kimiCode";

export const kimiCodeAdapter: HarnessAdapter = {
  id: "kimicode",
  live: true,
  canSteer: false,
  sendTurn: sendKimiCodeTurn,
  steerTurn: steerKimiCodeTurn,
  cancelTurn: cancelKimiCodeTurn,
  respondApproval: respondKimiCodeApproval,
  respondQuestion: respondKimiCodeQuestion,
  stopSession: stopKimiCodeSession,
  forgetSession: forgetKimiCodeSession,
  bindSession: bindKimiCodeSession,
  readSessionTitle: readKimiCodeSessionTitle,
  refreshCatalog: discoverKimiCodeModels,
};

let registered = false;
export function ensureKimiCodeRegistered(): void {
  if (registered) return;
  registerHarness(kimiCodeAdapter);
  registered = true;
}
