import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "../../shared/i18n/useTranslation";
import { BranchPicker } from "../../features/source-control/ui/BranchPicker";
import { WorkspacePicker } from "../../features/workspace/ui/WorkspacePicker";
import { useProjectBranchesState } from "../../features/source-control/hooks/useProjectBranches";
import type { QuickGitRequest } from "../../features/quick-composer/model/quickGitPopup";
import type { QuickWorkspace } from "../../features/quick-composer/model/quickWorkspace";

export function QuickGitPopupPicker({
  request,
  onFinish,
}: {
  request: QuickGitRequest;
  onFinish: (id: string, choice?: QuickWorkspace) => Promise<void>;
}) {
  const { t: uiT } = useTranslation();
  const finished = useRef(false);
  const { choice } = request;
  const cwd = choice.tree?.path ?? choice.cwd ?? "";
  const { branches, settled } = useProjectBranchesState(cwd, true);
  const finish = useCallback(
    (value?: QuickWorkspace) => {
      if (finished.current) return;
      finished.current = true;
      void onFinish(request.id, value).catch(() => {
        finished.current = false;
      });
    },
    [onFinish, request.id],
  );
  const waiting = !settled || !branches;
  useEffect(() => {
    if (!waiting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      finish();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [waiting, finish]);

  // This window has its own cold branch cache. Mounting an initially open
  // WorkspacePicker before it is enabled closes it permanently on first use.
  // Give the native window real content to measure while Git is loading.
  if (waiting)
    return (
      <div className="flex items-center gap-3 px-3 py-3 text-xs">
        <p role="status" className="flex-1 text-content/60">
          {settled
            ? uiT("Couldn’t load branches for this project.")
            : uiT("Loading branches…")}
        </p>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-content/70 hover:bg-content/6"
          onClick={() => finish()}
        >
          {uiT("Close")}
        </button>
      </div>
    );
  if (request.kind === "branch")
    return (
      <BranchPicker
        cwd={cwd}
        worktree={!!choice.tree && !choice.tree.isMain}
        initialOpen
        onDismiss={() => finish()}
        onChange={() => finish(choice)}
        onClose={() => finish()}
      />
    );
  return (
    <WorkspacePicker
      cwd={cwd}
      mode={choice.mode}
      base={choice.base}
      initialPicker={request.kind}
      onModeChange={(mode, base) =>
        finish({
          cwd: choice.cwd,
          mode,
          ...(mode === "worktree" ? { base } : {}),
        })
      }
      onBaseChange={(base) => finish({ ...choice, base })}
      onSelectWorktree={async (tree) =>
        finish({ cwd: choice.cwd, mode: "current", tree })
      }
      onClose={() => finish()}
    />
  );
}
