import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Switch } from "../../../shared/ui/forms/Switch";
import { withStatusToast } from "../../../shared/ui/StatusToast";
import {
  useState,
  type ComponentType,
  type FormEvent,
  type ReactNode,
} from "react";
import { prettyCwd } from "../../../shared/lib/paths";
import { type Worktree } from "../model/worktrees";
import { Modal } from "../../../shared/ui/Modal";
import {
  CircleAlert,
  CloudUpload,
  FileDiff,
  Folder,
  GitBranch,
  Loader,
  MessageSquare,
} from "../../../shared/ui/icons";

const TONE = {
  danger: "text-red-400",
  warn: "text-amber-400",
  muted: "text-content/35",
};

function Consequence({
  icon: Icon,
  tone = "muted",
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  tone?: keyof typeof TONE;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <Icon className={`mt-px size-3.5 shrink-0 ${TONE[tone]}`} />
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}

export function DeleteWorktreeDialog({
  cwd,
  tree,
  sessionCount = 0,
  onRemove,
  onClose,
  onDeleted,
}: {
  cwd: string;
  tree: Worktree;
  sessionCount?: number;
  onRemove: (
    cwd: string,
    path: string,
    force: boolean,
    deleteSessions: boolean,
  ) => Promise<void>;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t: uiT } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [deleteSessions, setDeleteSessions] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      // Confirmation covers the complete destructive action, including any
      // local changes that appeared after the last status refresh.
      await withStatusToast(() => onRemove(cwd, tree.path, true, deleteSessions), {
        loading: uiT("Deleting worktree…"),
        success: uiT("Worktree deleted"),
        error: false,
      });
      onDeleted();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={uiT("Delete worktree?")}
      size="sm"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="flex flex-col gap-3.5 p-4 text-[13px] leading-[1.5]"
        onSubmit={(e) => void submit(e)}
      >
        <p className="text-content/75">
          {uiT(
            "This permanently deletes the working copy and everything inside it.",
          )}
        </p>
        <div className="rounded-lg border border-content/10 bg-content/5 p-3">
          <p className="flex items-start gap-2.5 text-[12px] text-content/55">
            <Folder className="mt-px size-3.5 shrink-0 text-content/35" />
            <span className="min-w-0 flex-1 break-all font-mono">
              {prettyCwd(tree.path)}
            </span>
          </p>
          <ul className="mt-2.5 flex flex-col gap-2 border-t border-content/8 pt-2.5 text-[12.5px] text-content/75">
            {sessionCount > 0 && (
              <Consequence
                icon={MessageSquare}
                tone={deleteSessions ? "danger" : "muted"}
              >
                {uiT(
                  "{count} session{plural} using this worktree {verb} {consequence}",
                  {
                    count: sessionCount,
                    plural: sessionCount === 1 ? "" : "s",
                    verb: sessionCount === 1 ? "is" : "are",
                    consequence: uiT(
                      deleteSessions
                        ? "permanently deleted."
                        : "kept. Select a branch or worktree to continue them.",
                    ),
                  },
                )}
              </Consequence>
            )}
            {tree.dirty && (
              <Consequence icon={FileDiff} tone="warn">
                {uiT(
                  "All uncommitted and untracked changes here are discarded.",
                )}
              </Consequence>
            )}
            {tree.dirty == null && (
              <Consequence icon={CircleAlert} tone="warn">
                {uiT(
                  "Changes could not be checked. Anything uncommitted here is discarded.",
                )}
              </Consequence>
            )}
            <Consequence icon={GitBranch}>
              {tree.branch ? (
                <>
                  {uiT("The")}{" "}
                  <span className="font-medium text-content">
                    {tree.branch}
                  </span>{" "}
                  {uiT("branch and its commits are kept.")}
                </>
              ) : (
                uiT("The branch is kept.")
              )}
            </Consequence>
            {!!tree.unpushed && (
              <Consequence icon={CloudUpload}>
                {uiT(
                  "{count} commit{plural} {verb} not on a remote. They stay on the branch.",
                  {
                    count: tree.unpushed,
                    plural: tree.unpushed === 1 ? "" : "s",
                    verb: tree.unpushed === 1 ? "is" : "are",
                  },
                )}
              </Consequence>
            )}
          </ul>
        </div>
        {sessionCount > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-content/10 p-3">
            <span
              id="delete-worktree-sessions-label"
              className="text-[12.5px] text-content/75"
            >
              {uiT("Also delete associated sessions")}
            </span>
            <Switch
              aria-labelledby="delete-worktree-sessions-label"
              checked={deleteSessions}
              disabled={busy}
              onCheckedChange={setDeleteSessions}
            />
          </div>
        )}
        {error && (
          <p role="alert" className="break-words text-[12.5px] text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-md px-3 py-1.5 hover:bg-content/5 active:scale-[0.97]"
          >
            {uiT("Cancel")}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-500/20 px-3 py-1.5 font-medium text-red-400 hover:bg-red-500/30 disabled:opacity-40 disabled:hover:bg-red-500/20 active:scale-[0.97]"
          >
            {busy && <Loader className="size-3.5 animate-spin" />}
            {sessionCount && deleteSessions
              ? uiT("Delete worktree and session{value0}", {
                  value0: String(sessionCount === 1 ? "" : "s"),
                })
              : uiT("Delete worktree")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
