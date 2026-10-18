import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Split } from "../../../shared/ui/icons";

/** Show only Git-confirmed linked worktrees, including one opened as a project. */
export function SessionWorktreeIcon({
  session,
}: {
  session: { cwd?: string; executionCwd?: string; linkedWorktree?: boolean; worktreeRemoved?: boolean };
}) {
  const { t } = useTranslation();
  if (!session.linkedWorktree || session.worktreeRemoved) return null;
  return (
    <span
      role="img"
      aria-label={t("Worktree")}
      title={`${t("Worktree")}\n${session.executionCwd || session.cwd || ""}`}
      className="inline-flex shrink-0 items-center text-content/45"
    >
      <Split className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
    </span>
  );
}
