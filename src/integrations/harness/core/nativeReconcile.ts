import {
  titleFromPrompt,
  type Block,
  type Session,
} from "../../../features/sessions/model/session";
import {
  applyNativeTitle,
  type SessionTitleState,
} from "../../../features/sessions/model/titlePolicy";
import type {
  NativeSessionFile,
  NativeSessionProvider,
  NativeTranscript,
} from "./nativeSessions";

/** Claude and Codex sessions belong to the account profile whose directory stores them. */
export const accountScoped = (provider: NativeSessionProvider) =>
  provider === "claude" || provider === "codex";

export const promptTitle = (transcript: NativeTranscript, provider: NativeSessionProvider) =>
  titleFromPrompt(
    transcript.blocks.find((block) => block.role === "user")?.text ?? "",
    provider,
  );
/**
 * Imported titles wait for the original agent's title. The prompt-derived
 * placeholder never triggers MonoCode's own title generation.
 */
export const NATIVE_PENDING_TITLE: SessionTitleState = {
  source: "placeholder",
  epoch: 0,
  purpose: "initial",
  fallbackAttempted: true,
};

/**
 * Use the title the agent generated (or the user set in its CLI), now or when
 * it appears later. A title renamed in MonoCode stays manual and always wins.
 */
export function withNativeTitle(session: Session, raw: string | undefined): Session {
  return session.providerSessionId
    ? applyNativeTitle(session, session.providerSessionId, raw)
    : session;
}

export type NativeMergeResult =
  | { kind: "merged"; session: Session; changed: boolean }
  | { kind: "diverged"; missing: string[] };

/**
 * Host-managed merge keyed by native parser block IDs, never by prompt text.
 *
 * `hostTurn` means every native record added since the last applied revision
 * was written by a Host turn while it held the writer lease: those records are
 * absorbed into the Host's own turn blocks (which keep attachments, cards and
 * metrics) instead of being inserted again. Without a Host turn, new native
 * records come from another writer and are appended. A tracked native block
 * that disappears outside a Host turn (rewind, branch switch) is reported as
 * divergence and leaves history untouched.
 */
export function mergeNativeHistory(
  session: Session,
  file: NativeSessionFile,
  transcript: NativeTranscript,
  options: { hostTurn: boolean; dataDir?: string },
): NativeMergeResult {
  const link = session.nativeSession;
  const trackedNative = link?.nativeIds ?? [];
  const nativeIds = new Set(transcript.blocks.map((block) => block.id));
  const missing = trackedNative.filter((id) => !nativeIds.has(id));
  if (missing.length && !options.hostTurn) return { kind: "diverged", missing };
  const known = new Set(trackedNative);
  const added = transcript.blocks.filter((block) => !known.has(block.id));
  const drafts = session.blocks.filter((block) => block.draft);
  const history = session.blocks.filter((block) => !block.draft);
  const blocks: Block[] = options.hostTurn || !added.length ? history : [...history, ...added];
  const nextNative = [
    ...trackedNative.filter((id) => nativeIds.has(id)),
    ...added.map((block) => block.id),
  ];
  const changed =
    blocks !== history ||
    link?.revision !== file.revision ||
    link?.path !== file.path ||
    link.mode !== "managed" ||
    (!!options.dataDir && link.dataDir !== options.dataDir) ||
    nextNative.length !== trackedNative.length;
  const historyIds = blocks.map((block) => block.id);
  return {
    kind: "merged",
    changed,
    session: {
      ...session,
      providerSessionId: file.providerSessionId,
      providerAccountId: accountScoped(file.provider)
        ? (session.providerAccountId ?? file.accountId ?? "default")
        : session.providerAccountId,
      blocks: [...blocks, ...drafts],
      nativeSession: {
        provider: file.provider,
        providerSessionId: file.providerSessionId,
        createdAt: link?.createdAt ?? transcript.createdAt,
        updatedAt: file.modifiedAt,
        path: file.path,
        revision: file.revision,
        blockIds: historyIds,
        nativeIds: nextNative,
        mode: "managed",
        ...(file.storage ? { storage: file.storage } : {}),
        ...(file.accountId ? { accountId: file.accountId } : {}),
        ...((options.dataDir ?? link?.dataDir)
          ? { dataDir: options.dataDir ?? link?.dataDir }
          : {}),
      },
    },
  };
}
