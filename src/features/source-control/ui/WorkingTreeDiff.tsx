import type { GitFileDiffKind } from "../../../platform/tauri/fs";
import { GitReviewPane } from "./GitReviewPane";

type Props = {
  cwd: string;
  focusPath?: string;
  focusKind?: GitFileDiffKind;
};

/** Preserve the sidebar/tab's comparison as the initial source. */
export function WorkingTreeDiff({ focusKind = "unstaged", ...props }: Props) {
  return (
    <GitReviewPane
      key={`${props.cwd}:${focusKind}`}
      {...props}
      initialSource={focusKind}
    />
  );
}
