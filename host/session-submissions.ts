import { type SubmissionMetadata, type SubmissionOutcome, type Block, type Session, HARNESSES } from "../src/contracts/session";


import { composeNoteMessage, noteCardMeta } from "../src/domain/notesText";
import { handoffTurnCard, wrapHandoffPrompt } from "../src/domain/handoff";

function string(value: unknown, label: string, max = 256_000): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    throw new Error(`Invalid ${label}`);
  return value;
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}
function opinion(value: unknown): NonNullable<SubmissionMetadata["secondOpinion"]> {
  const v = object(value, "second opinion");
  if (!HARNESSES.includes(v.from as never) || !HARNESSES.includes(v.to as never) ||
    (v.kind !== undefined && v.kind !== "handoff") ||
    (v.files !== undefined && (!Number.isSafeInteger(v.files) || Number(v.files) < 0)))
    throw new Error("Invalid second opinion");
  return { from: v.from as never, to: v.to as never,
    ...(v.kind ? { kind: "handoff" } : {}),
    ...(v.request !== undefined ? { request: string(v.request, "handoff request", 4096) } : {}),
    ...(v.files !== undefined ? { files: Number(v.files) } : {}),
  };
}

export function parseSubmissionMetadata(v: Record<string, unknown>): SubmissionMetadata {
  const result: SubmissionMetadata = {};
  for (const key of ["ciContext", "promptOverride", "displayText"] as const)
    if (v[key] !== undefined) result[key] = string(v[key], key);
  if (v.appRequestId !== undefined) {
    const id = string(v.appRequestId, "app request ID", 512);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid app request ID");
    result.appRequestId = id;
  }
  if (v.managed !== undefined) {
    if (typeof v.managed !== "boolean") throw new Error("Invalid managed submission");
    result.managed = v.managed;
  }
  if (v.resendEdited !== undefined) {
    if (typeof v.resendEdited !== "boolean") throw new Error("Invalid edited resend");
    result.resendEdited = v.resendEdited;
  }
  if (v.buildTarget !== undefined) {
    const target = object(v.buildTarget, "build target");
    const settings = object(target.modelSettings ?? {}, "build settings");
    if (!HARNESSES.includes(target.harness as never) || Object.entries(settings).length > 20 ||
        Object.entries(settings).some(([key, value]) => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || typeof value !== "string" || value.length > 128 || value.includes("\0")))
      throw new Error("Invalid build target");
    result.buildTarget = { harness: target.harness as never, model: string(target.model, "build model", 200), modelSettings: settings as Record<string, string> };
  }
  if (v.secondOpinion !== undefined) result.secondOpinion = opinion(v.secondOpinion);
  if (v.noteCard === null) result.noteCard = null;
  else if (v.noteCard !== undefined) {
    const card = object(v.noteCard, "note card");
    result.noteCard = {
      id: string(card.id, "note ID", 512), slug: string(card.slug, "note slug", 512),
      title: string(card.title, "note title", 4096), body: string(card.body, "note body"),
      ...(card.sourceCwd !== undefined ? { sourceCwd: string(card.sourceCwd, "note directory", 4096) } : {}),
    };
  }
  if (v.handoffCard === null) result.handoffCard = null;
  else if (v.handoffCard !== undefined) {
    const card = object(v.handoffCard, "handoff card");
    result.handoffCard = { ...opinion(card), brief: string(card.brief, "handoff brief") };
  }
  return result;
}

export function submissionPrompt(text: string, context: SubmissionMetadata, raw = false): string {
  if (context.promptOverride !== undefined) return context.promptOverride;
  if (raw) return text;
  const prompt = composeNoteMessage(context.noteCard ?? undefined, text);
  return context.handoffCard
    ? wrapHandoffPrompt(context.handoffCard.brief, context.handoffCard.from, prompt)
    : prompt;
}

export function submissionBlock(text: string, context: SubmissionMetadata, raw = false): Partial<Block> {
  const secondOpinion = context.secondOpinion ?? (context.handoffCard ? handoffTurnCard(context.handoffCard) : undefined);
  return {
    text: context.displayText ?? (!raw && secondOpinion && secondOpinion.kind !== "handoff" ? "Second opinion" : text),
    ...(!raw && secondOpinion ? { secondOpinion } : {}),
    ...(!raw && context.noteCard ? { noteCard: noteCardMeta(context.noteCard) } : {}),
    ...(context.ciContext ? { ciContext: context.ciContext } : {}),
    ...(context.appRequestId ? { appRequestId: context.appRequestId } : {}),
    ...(context.managed ? { internal: true } : {}),
  };
}

export function completeSubmission(session: Session, startBlockId: string, outcome: SubmissionOutcome): Session {
  const start = session.blocks.findIndex(block => block.id === startBlockId);
  if (start < 0) return session;
  return { ...session, blocks: session.blocks.map((block, index) =>
    index >= start && block.role === "user" && !block.turnOutcome
      ? { ...block, turnOutcome: outcome } : block) };
}
