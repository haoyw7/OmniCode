import type { GitFileDiffKind } from "../../../contracts/workspace";

import { GitReviewPane } from "./GitReviewPane";

type Props = {
  cwd: string;
  focusPath?: string;
  focusKind?: GitFileDiffKind;
  /** Opened from a session: its captured snapshots are the first source. */
  sessionId?: string;
  turnId?: string;
};

/**
 * The working copy's one review. It starts on the session's snapshots when a
 * session opened it, otherwise on the comparison source control picked.
 */
export function WorkingTreeDiff({ focusKind = "unstaged", ...props }: Props) {
  return (
    <GitReviewPane
      key={`${props.cwd}:${focusKind}:${props.sessionId ?? ""}:${props.turnId ?? ""}`}
      {...props}
      initialSource={props.sessionId ? "session" : focusKind}
    />
  );
}
