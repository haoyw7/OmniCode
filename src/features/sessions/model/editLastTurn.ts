import type { HarnessInteractionCapabilities } from "../../../integrations/harness/core/capabilities";
import type {
  Attachment,
  Block,
  EditedResendRejection,
  Session,
} from "./session";
import { isOperatorUserTurn, operatorUserPrompt } from "./operatorCommand";

/** Index of the user block that starts the latest turn. */
export function lastUserTurnStartIndex(blocks: Block[]): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.role === "user" && !block.internal && !block.draft) return index;
  }
  return -1;
}

export function lastUserTurnBlock(blocks: Block[]): Block | undefined {
  const index = lastUserTurnStartIndex(blocks);
  return index >= 0 ? blocks[index] : undefined;
}

export function truncateBeforeLastUserTurn(blocks: Block[]): Block[] {
  const start = lastUserTurnStartIndex(blocks);
  return start < 0 ? blocks : blocks.slice(0, start);
}

export function lastEditableTurnStartIndex(session: Session): number {
  const latest = lastUserTurnStartIndex(session.blocks);
  if (latest < 0) return -1;
  const providerTurnId = session.blocks[latest].providerTurnId;
  if (session.harness !== "codex" || !providerTurnId) return latest;

  let start = latest;
  for (let index = latest - 1; index >= 0; index -= 1) {
    const block = session.blocks[index];
    if (block.role === "user" && block.providerTurnId !== providerTurnId) {
      break;
    }
    if (block.role === "user" && !block.internal && !block.draft) {
      start = index;
    }
  }
  return start;
}

export function truncateBeforeLastEditableTurn(session: Session): Block[] {
  const start = lastEditableTurnStartIndex(session);
  return start < 0 ? session.blocks : session.blocks.slice(0, start);
}

export type EditedResendPreparation = {
  blocks: Block[];
  providerTurnId?: string;
};

export function prepareEditedResend(
  session: Session,
  capabilities: HarnessInteractionCapabilities,
): EditedResendPreparation | null {
  if (!canEditLastTurn(session, capabilities)) return null;
  const block = lastUserTurnBlock(session.blocks);
  if (!block) return null;
  return {
    blocks: truncateBeforeLastEditableTurn(session),
    ...(block.providerTurnId ? { providerTurnId: block.providerTurnId } : {}),
  };
}

export function replaceEditedResend(session: Session): Session {
  return {
    ...session,
    blocks: truncateBeforeLastEditableTurn(session),
  };
}

export type EditedResendAttempt = EditedResendPreparation & {
  markProviderRewound(): void;
  markAccepted(): void;
  isAccepted(): boolean;
  replace(session: Session): Session;
  recoverAfterFailure(session: Session): Session;
  reject(): void;
};

/** State for one edit-and-resend attempt, including its failure recovery. */
export function createEditedResendAttempt(
  session: Session,
  capabilities: HarnessInteractionCapabilities,
  onRejected?: (recovery: EditedResendRejection) => void,
): EditedResendAttempt | null {
  const preparation = prepareEditedResend(session, capabilities);
  if (!preparation) return null;

  let providerRewound = false;
  let accepted = false;
  let rejected = false;
  return {
    ...preparation,
    markProviderRewound() {
      providerRewound = true;
    },
    markAccepted() {
      accepted = true;
    },
    isAccepted() {
      return accepted;
    },
    replace: replaceEditedResend,
    recoverAfterFailure(current) {
      return providerRewound && !accepted
        ? replaceEditedResend(current)
        : current;
    },
    reject() {
      if (accepted || rejected) return;
      rejected = true;
      onRejected?.({ providerRewound });
    },
  };
}

export type EditedResendCoordinator = {
  isActive(sessionId: string): boolean;
  start(sessionId: string): boolean;
  finish(sessionId: string): void;
};

/** Keeps concurrent submissions out while a provider rewind is in progress. */
export function createEditedResendCoordinator(): EditedResendCoordinator {
  const active = new Set<string>();
  return {
    isActive: (sessionId) => active.has(sessionId),
    start(sessionId) {
      if (active.has(sessionId)) return false;
      active.add(sessionId);
      return true;
    },
    finish(sessionId) {
      active.delete(sessionId);
    },
  };
}

export type LastTurnRecall = {
  text: string;
  attachments: Attachment[];
};

export function lastTurnRecall(session: Session): LastTurnRecall | null {
  const block = lastUserTurnBlock(session.blocks);
  if (!block?.text.trim() && !block?.attachments?.length) return null;
  return {
    text: isOperatorUserTurn(block)
      ? `/operator ${operatorUserPrompt(block)}`
      : block.text,
    attachments: block.attachments ?? [],
  };
}

export function canEditLastTurn(session: Session, capabilities: HarnessInteractionCapabilities): boolean {
  if (session.inboxAsk || session.busy || session.pendingQuestion) return false;
  if (session.editingQueuedMessageId) return false;
  if ((session.queuedMessages?.length ?? 0) > 0) return false;
  if (!capabilities.turns.rewindLastTurn) return false;
  const block = lastUserTurnBlock(session.blocks);
  if (!block || block.draft) return false;
  if (session.harness === "codex" && !block.providerTurnId) return false;
  if (block.secondOpinion || block.noteCard || block.ciContext) return false;
  if (session.blocks.some((entry) => entry.role === "handoff")) return false;
  return true;
}
