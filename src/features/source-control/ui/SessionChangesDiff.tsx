import { GitReviewPane } from "./GitReviewPane";

type Props = {
  cwd: string;
  sessionId: string;
  focusPath?: string;
};

/** Checkpoint review starts on the exact snapshots owned by this session. */
export function SessionChangesDiff(props: Props) {
  return (
    <GitReviewPane
      key={`${props.cwd}:${props.sessionId}`}
      {...props}
      initialSource="session"
    />
  );
}
