import "./styles/diff-counts.css";

export function MobileDiffCounts({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  return (
    <span className="mobile-git-counts">
      <span data-kind="add">+{additions}</span>
      <span data-kind="del">−{deletions}</span>
    </span>
  );
}
