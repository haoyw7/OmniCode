import { RotatingIcon } from "../../../shared/ui/RotatingIcon";
import { motionGeometry } from "../../../shared/motion/tokens";
import { useState } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { Check, ChevronRight, FolderTree, Loader } from "../../../shared/ui/icons";
import type {
  WorktreeCreation,
  WorktreeLogLine,
} from "../../source-control/model/worktreeCreation";
import { WORKTREE_NAME_ERROR } from "../../source-control/model/worktreeNaming";

/**
 * The worktree creation record under the message that started it. The log stays
 * open while Git works and for a moment after; then it folds away and the header
 * stays so the log can be reopened.
 */
export function WorktreeCreationCard({ creation }: { creation: WorktreeCreation }) {
  const { t: uiT } = useTranslation();
  // A click overrides the default for this creation only.
  const [toggle, setToggle] = useState<{ id: string; open: boolean }>();
  const finished = creation.status === "created";
  const logOpen = toggle?.id === creation.id ? toggle.open : !creation.folded;
  const title = finished
    ? uiT("Worktree created")
    : creation.status === "failed"
      ? uiT("Worktree creation failed")
      : uiT("Creating worktree…");
  const logText = (line: WorktreeLogLine) => {
    switch (line.kind) {
      case "info":
        return `[info] ${uiT(line.key, line.values)}`;
      case "text":
        return uiT(line.key, line.values);
      case "output":
        return line.text;
      case "error": {
        const key = line.text.replace(/^Error: /, "").replace(/^Host rejected request: /, "");
        return `[error] ${key === WORKTREE_NAME_ERROR || key === "Worktree creation cancelled." ? uiT(key) : line.text}`;
      }
    }
  };

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={logOpen}
        onClick={() => setToggle({ id: creation.id, open: !logOpen })}
        className="flex max-w-full min-w-0 items-center gap-1.5 py-1 font-sans text-[13px] text-content/60 hover:text-content"
      >
        <FolderTree className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{title}</span>
        {creation.status === "creating" ? (
          <Loader className="size-3.5 shrink-0 animate-spin" />
        ) : finished ? (
          <Check className="size-3.5 shrink-0" />
        ) : null}
        <RotatingIcon icon={ChevronRight} angle={logOpen ? motionGeometry.disclosureAngle : 0} className="size-3 shrink-0 text-content/40" />
      </button>
      <AnimatedCollapse expanded={logOpen}>
        <div className="mt-1 rounded-lg border border-content/10 bg-content/3 px-3 py-2 font-mono text-[11px] leading-5 text-content/60">
          {creation.log.map((line, index) => (
            <div key={index} className="whitespace-pre-wrap break-words">
              {logText(line)}
            </div>
          ))}
        </div>
      </AnimatedCollapse>
    </div>
  );
}
