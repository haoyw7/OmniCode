import { GitReviewPane } from "./GitReviewPane";

type Props = {
  cwd: string;
  sha: string;
};

/** Commit tabs share the review renderer while staying pinned to their commit. */
export function CommitDiff({ cwd, sha }: Props) {
  return <GitReviewPane key={`${cwd}:${sha}`} cwd={cwd} commit={sha} />;
}
