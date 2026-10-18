import type { Block, Session } from "./session";

function messageTime(
  block: Block | undefined,
  user = false,
): number | undefined {
  if (!block) return undefined;
  const time =
    block.sentAt ??
    (block.startedAt != null
      ? block.startedAt + (user ? 0 : Math.max(0, block.durationMs ?? 0))
      : undefined);
  return time != null && Number.isFinite(time) && time > 0 ? time : undefined;
}

/** A running chat stays at its last send; a finished chat follows its last AI reply. */
export function sessionMessageActivityAt(
  session: Pick<Session, "blocks" | "busy">,
  running = session.busy,
): number | undefined {
  let user: Block | undefined;
  for (let index = session.blocks.length - 1; index >= 0; index--) {
    const block = session.blocks[index];
    if (block.internal) continue;
    if (block.role === "user" && !block.draft) {
      if (running) return messageTime(block, true);
      user ??= block;
    }
    if (
      !running &&
      (((block.role === "assistant" || block.role === "plan") &&
        !!block.text.trim()) ||
        block.role === "image")
    )
      return messageTime(block);
  }
  return messageTime(user, true);
}

/** Older histories/Hosts without message timestamps retain their activity fallback. */
export function sessionRecencyAt(summary: {
  updatedAt: number;
  activityAt?: number | null;
  status?: string;
  lastUserMessageAt?: number | null;
}): number {
  if (
    summary.activityAt != null &&
    Number.isFinite(summary.activityAt) &&
    summary.activityAt > 0
  )
    return summary.activityAt;
  if (
    summary.status === "running" &&
    summary.lastUserMessageAt != null &&
    Number.isFinite(summary.lastUserMessageAt) &&
    summary.lastUserMessageAt > 0
  )
    return summary.lastUserMessageAt;
  return summary.updatedAt;
}

export type SessionNotificationPreview = {
  reply: string | null;
  input: string | null;
};

/** Bounded transcript excerpts for clients that only receive session summaries. */
export function sessionNotificationPreview(
  session: Session,
): SessionNotificationPreview {
  const blocks = [...session.blocks].reverse();
  const reply = blocks.find(
    (block) =>
      !block.internal &&
      (block.role === "assistant" || block.role === "plan" || !!block.notice) &&
      !!block.text.trim(),
  );
  const approval = blocks.find(
    (block) => !block.internal && block.approval && !block.approval.decided,
  );
  const question = session.pendingQuestion;
  return {
    reply: notificationExcerpt(reply?.text),
    input:
      notificationExcerpt(
        question?.questions.map((item) => item.prompt).join("\n\n"),
      ) ||
      notificationExcerpt(question?.title) ||
      notificationExcerpt(approval?.tool?.title) ||
      notificationExcerpt(approval?.text),
  };
}

function notificationExcerpt(text?: string): string | null {
  const paragraph = text
    ?.trim()
    .split(/\n\s*\n/, 1)[0]
    ?.replace(/\s+/g, " ")
    .trim();
  if (!paragraph) return null;
  const characters = Array.from(paragraph);
  return characters.length > 240
    ? `${characters.slice(0, 239).join("")}…`
    : paragraph;
}

/** Stable identities for the input requests currently visible in a session. */
export function pendingSessionInputKey(
  session?: Session,
  runId?: string,
): string | null {
  if (!session) return null;
  const keys = session.blocks.flatMap((block) =>
    block.approval && !block.approval.decided
      ? [`approval:${block.approval.requestId}`]
      : [],
  );
  if (session.pendingQuestion)
    keys.push(`question:${session.pendingQuestion.requestId}`);
  return keys.length
    ? `${runId ? `${runId}:` : ""}${keys.sort().join(",")}`
    : null;
}
