/**
 * In-memory composer drafts, keyed by session id.
 *
 * SessionPane keeps the text you are typing in a React ref so retyping while
 * the pane stays mounted does not re-render on every keystroke. A plain ref
 * only lives as long as that one component instance though: closing a
 * session's pane (or moving it to another split) unmounts SessionPane, and
 * the ref - and whatever you had typed - is gone with no warning the moment
 * it remounts.
 *
 * This module-level map survives that, because it lives outside the React
 * tree for as long as the app process is running: the draft comes back when
 * the pane for that session opens again.
 *
 * Unsent attachments are stashed here when the Composer unmounts, so an
 * image-only draft comes back too.
 *
 * It does not survive an app restart or a full reload - that needs the
 * draft written into the session's persisted record on disk, which is a
 * separate, larger change (touches the Rust-side session_upsert schema
 * too).
 */
import type { McpTag } from "./mcpPicker";
import type { Attachment } from "./session";

const drafts = new Map<string, string>();
const environments = new Map<string, { cwd: string; distribution: string | null }>();

export const getComposerEnvironment = (sessionId: string) => environments.get(sessionId);
export function setComposerEnvironment(sessionId: string, value: { cwd: string; distribution: string | null } | undefined) {
  if (value) environments.set(sessionId, value);
  else environments.delete(sessionId);
}
const mcpTags = new Map<string, McpTag[]>();
const attachmentCounts = new Map<string, number>();
const attachmentReads = new Map<string, number>();
/**
 * Attachments of a Composer that unmounted with them unsent. The cache owns
 * them (and their preview URLs) until the session's Composer mounts again.
 */
const stashedAttachments = new Map<
  string,
  { attachments: Attachment[]; borrowedIds: ReadonlySet<string> }
>();

/** Hand an unmounting Composer's unsent attachments to the cache. */
export function stashComposerAttachments(
  sessionId: string,
  attachments: Attachment[],
  borrowedIds: ReadonlySet<string>,
): void {
  if (attachments.length > 0) {
    stashedAttachments.set(sessionId, { attachments, borrowedIds });
  } else {
    stashedAttachments.delete(sessionId);
  }
  setComposerAttachmentCount(sessionId, attachments.length);
}

/** Read without taking ownership, e.g. for a render-time initial value. */
export function peekComposerAttachments(sessionId: string) {
  return stashedAttachments.get(sessionId);
}

/** Take ownership back; the mounted Composer releases them from here on. */
export function takeComposerAttachments(sessionId: string) {
  const stash = stashedAttachments.get(sessionId);
  stashedAttachments.delete(sessionId);
  return stash;
}

/** Metadata only: the mounted Composer still owns attachments and their URLs. */
export function setComposerAttachmentCount(
  sessionId: string,
  count: number,
): void {
  if (count > 0) attachmentCounts.set(sessionId, count);
  else attachmentCounts.delete(sessionId);
}

/** Register before yielding to a file read, including reads that later fail. */
export function beginComposerAttachmentRead(sessionId: string): () => void {
  attachmentReads.set(sessionId, (attachmentReads.get(sessionId) ?? 0) + 1);
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    const remaining = (attachmentReads.get(sessionId) ?? 1) - 1;
    if (remaining > 0) attachmentReads.set(sessionId, remaining);
    else attachmentReads.delete(sessionId);
  };
}

export function hasComposerDraftContent(sessionId: string): boolean {
  return !!(
    drafts.get(sessionId)?.length ||
    mcpTags.get(sessionId)?.length ||
    attachmentCounts.get(sessionId) ||
    attachmentReads.get(sessionId)
  );
}

export function getComposerDraft(sessionId: string): string | undefined {
  return drafts.get(sessionId);
}

export function setComposerDraft(sessionId: string, text: string): void {
  if (text) {
    drafts.set(sessionId, text);
  } else {
    drafts.delete(sessionId);
    mcpTags.delete(sessionId);
  }
}

export function getComposerMcpTags(sessionId: string): McpTag[] {
  return mcpTags.get(sessionId) ?? [];
}

export function setComposerMcpTags(sessionId: string, tags: McpTag[]): void {
  if (tags.length > 0) {
    mcpTags.set(sessionId, tags);
  } else {
    mcpTags.delete(sessionId);
  }
}

export function clearComposerDraft(sessionId: string): void {
  const stash = takeComposerAttachments(sessionId);
  for (const file of stash?.attachments ?? []) {
    if (file.previewUrl && !stash?.borrowedIds.has(file.id)) {
      URL.revokeObjectURL(file.previewUrl);
    }
  }
  drafts.delete(sessionId);
  environments.delete(sessionId);
  mcpTags.delete(sessionId);
  attachmentCounts.delete(sessionId);
  attachmentReads.delete(sessionId);
}
