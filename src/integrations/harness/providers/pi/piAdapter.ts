import { readFamilySessionTitle } from "../pi/piFamily";
import { PI_FLAVOR } from "../pi/piFlavor";
import {
  bindPiSession,
  cancelPiTurn,
  compactPiContext,
  forgetPiSession,
  respondPiApproval,
  respondPiQuestion,
  rewindPiLastTurn,
  sendPiTurn,
  steerPiTurn,
  stopPiSession,
} from "./pi";
import { refreshPiCatalog } from "./piCatalog";
import { runPiTextPrompt, stopPiTextPrompt, warmupPiText } from "./piText";
import { registerHarness, type HarnessAdapter } from "../../core/registry";
import { discoverPiCommands } from "./piSkills";

export const piAdapter: HarnessAdapter = {
  id: "pi",
  live: true,
  readSessionTitle: (input) => readFamilySessionTitle(PI_FLAVOR, input),
  commands: { rawSlashCommands: true, discover: ({ cwd }) => discoverPiCommands(cwd) },
  sendTurn: sendPiTurn,
  compactContext: compactPiContext,
  rewindLastTurn: rewindPiLastTurn,
  steerTurn: steerPiTurn,
  cancelTurn: cancelPiTurn,
  respondApproval: respondPiApproval,
  respondQuestion: respondPiQuestion,
  stopSession: stopPiSession,
  forgetSession: forgetPiSession,
  bindSession: bindPiSession,
  refreshCatalog: refreshPiCatalog,
  warmupText: warmupPiText,
  runTextPrompt: runPiTextPrompt,
  stopTextPrompt: stopPiTextPrompt,
};

let registered = false;

export function ensurePiRegistered(): void {
  if (registered) return;
  registerHarness(piAdapter);
  registered = true;
}
