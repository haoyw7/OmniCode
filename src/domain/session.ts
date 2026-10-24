import { HARNESS_LABEL, HARNESS_TITLE } from '../contracts/session';
import type { HarnessId, Attachment, Block, Session } from '../contracts/session';


/** fx ACP rejects attachment prompt blocks. */
export function harnessSupportsAttachments(id: HarnessId): boolean {
  return id !== "fx";
}


/** First line of a prompt, truncated for the tab strip. */
export function titleFromPrompt(
  prompt: string,
  harness: HarnessId,
  attachments: Attachment[] = [],
): string {
  const line = prompt.trim().split(/\r?\n/)[0]?.trim() ?? "";
  const fromFiles =
    !line && attachments.length > 0
      ? attachments
          .map((file) => file.name)
          .filter(Boolean)
          .slice(0, 3)
          .join(", ")
      : "";
  const seed = line || fromFiles;
  if (!seed) return HARNESS_LABEL[harness];
  const max = 72;
  const short = seed.length > max ? `${seed.slice(0, max - 1)}…` : seed;
  return formatSessionTitle(harness, short);
}


export function formatSessionTitle(harness: HarnessId, title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return HARNESS_LABEL[harness];
  return `${HARNESS_LABEL[harness]} · ${trimmed}`;
}

/** Title without the application-added harness prefix; other titles unchanged. */
export function stripSessionTitlePrefix(title: string, harness: HarnessId): string {
  const prefix = `${HARNESS_LABEL[harness]} · `;
  return title.startsWith(prefix) ? title.slice(prefix.length) : title;
}


/** True when the stored title is still a placeholder the LLM may replace. */
export function canReplaceSessionTitle(
  current: string,
  harness: HarnessId,
  seed: string,
): boolean {
  return (
    current === seed ||
    current === HARNESS_LABEL[harness] ||
    current === HARNESS_TITLE[harness]
  );
}


export function hasPendingApproval(blocks: Block[]): boolean {
  return blocks.some((block) => block.approval && !block.approval.decided);
}


export function sessionNeedsInput(session: Session): boolean {
  return (
    !session.worktreeRemoved &&
    (hasPendingApproval(session.blocks) || session.pendingQuestion != null)
  );
}


/** The single unsent user turn held by a session, when present. */
export function sessionDraftBlock(
  session: Pick<Session, "blocks">,
): Block | undefined {
  return session.blocks.find((block) => block.role === "user" && block.draft);
}


/** Remove one saved draft without disturbing the conversation before it. */
export function removeSessionDraft(
  session: Session,
  draftBlockId: string,
): Session | undefined {
  const draft = session.blocks.find(
    (block) =>
      block.id === draftBlockId && block.role === "user" && block.draft,
  );
  if (!draft) return undefined;
  const blocks = session.blocks.filter((block) => block.id !== draftBlockId);
  const draftTitle = titleFromPrompt(
    draft.text,
    session.harness,
    draft.attachments,
  );
  return {
    ...session,
    blocks,
    title:
      blocks.length === 0 && session.title === draftTitle
        ? HARNESS_LABEL[session.harness]
        : session.title,
  };
}


/** Actual execution directory, independent of Git worktree registration. */
export function sessionExecutionCwd(session: {
  cwd: string;
  executionCwd?: string;
}): string {
  return session.executionCwd || session.cwd;
}