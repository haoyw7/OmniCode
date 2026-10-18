import { piImageMaterializer } from "../pi/piImages";
import {
  bindSession,
  cancelTurn,
  compactContext,
  forgetSession,
  respondApproval,
  rewindLastTurn,
  sendTurn,
  steerTurn,
  stopSession,
} from "../pi/piFamily";
import { OMP_FLAVOR } from "../pi/piFlavor";
import type {
  ApprovalDecision,
  CompactContextInput,
  RewindLastTurnInput,
  RewindLastTurnResult,
  SendTurnInput,
  SteerTurnInput,
} from "../../core/types";

/**
 * Live omp (oh-my-pi) adapter. Spawns `omp --mode rpc` with the user's config
 * and extensions loaded (no `--no-extensions`), so plugins in `~/.omp/agent`
 * keep working; TUI-only widgets do not appear in MonoCode. omp is a fork of
 * Pi and speaks the same RPC protocol, so both run on the `piFamily` core.
 */
export function sendOmpTurn(input: SendTurnInput): Promise<void> {
  return sendTurn(OMP_FLAVOR, input, piImageMaterializer());
}

export function compactOmpContext(input: CompactContextInput): Promise<void> {
  return compactContext(OMP_FLAVOR, input);
}

export function rewindOmpLastTurn(
  input: RewindLastTurnInput,
): Promise<RewindLastTurnResult> {
  return rewindLastTurn(OMP_FLAVOR, input);
}

export function steerOmpTurn(input: SteerTurnInput): Promise<void> {
  return steerTurn(OMP_FLAVOR, input);
}

export function respondOmpApproval(
  sessionId: string,
  requestId: number,
  decision: ApprovalDecision,
): void {
  respondApproval(OMP_FLAVOR, sessionId, requestId, decision);
}

export function cancelOmpTurn(sessionId: string): Promise<void> {
  return cancelTurn(OMP_FLAVOR, sessionId);
}

export function stopOmpSession(sessionId: string): Promise<void> {
  return stopSession(OMP_FLAVOR, sessionId);
}

export function forgetOmpSession(sessionId: string): Promise<void> {
  return forgetSession(OMP_FLAVOR, sessionId);
}

export function bindOmpSession(
  threadId: string,
  providerSessionId: string,
  cwd: string,
  _providerAccountId?: string,
  nativeSession?: import("../../../../features/sessions/model/session").NativeSessionLink,
): void {
  // An imported omp session resumes by file path and must report the same id.
  bindSession(OMP_FLAVOR, threadId, providerSessionId, cwd, nativeSession?.path);
}

