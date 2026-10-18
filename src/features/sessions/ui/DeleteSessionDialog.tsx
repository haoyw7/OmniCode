import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useState } from "react";
import { prettyCwd } from "../../../shared/lib/paths";
import { Modal } from "../../../shared/ui/Modal";

export type SessionDeleteChoice = {
  confirmed: boolean;
  deleteWorktree: boolean;
};

export function DeleteSessionDialog({
  title,
  unusedWorktree,
  onClose,
}: {
  title: string;
  unusedWorktree: string;
  onClose: (choice: SessionDeleteChoice) => void;
}) {
  const { t: uiT } = useTranslation();
  const [deleteWorktree, setDeleteWorktree] = useState(false);
  return (
    <Modal
      title={uiT("Delete session?")}
      size="sm"
      onClose={() => onClose({ confirmed: false, deleteWorktree: false })}
    >
      <div className="flex flex-col gap-4 p-4 text-[12px]">
        <p>
          “{title}
          {uiT("” will be permanently deleted.")}
        </p>
        <label className="flex items-start gap-2">
          <input data-ui="checkbox"
            type="checkbox"
            checked={deleteWorktree}
            onChange={(e) => setDeleteWorktree(e.target.checked)}
            className="mt-0.5 accent-accent"
          />
          <span>
            {uiT("Also delete the unused worktree")}
            <span className="mt-1 block break-all text-[11px] text-content/45">
              {prettyCwd(unusedWorktree)}
            </span>
            <span className="mt-1 block text-[11px] text-content/45">
              {uiT(
                "The branch is kept. If files have uncommitted changes, the worktree stays.",
              )}
            </span>
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onClose({ confirmed: false, deleteWorktree: false })}
            className="rounded-md px-3 py-1.5 hover:bg-content/5 active:scale-[0.97]"
          >
            {uiT("Cancel")}
          </button>
          <button
            type="button"
            onClick={() => onClose({ confirmed: true, deleteWorktree })}
            className="rounded-md bg-red-500/20 px-3 py-1.5 font-medium text-red-400 hover:bg-red-500/30 active:scale-[0.97]"
          >
            {uiT("Delete session")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
