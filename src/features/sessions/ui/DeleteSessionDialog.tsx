import { Checkbox } from "../../../shared/ui/forms/Checkbox";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useState } from "react";
import { prettyCwd } from "../../../shared/lib/paths";
import { Button } from "../../../shared/ui/forms/Button";
import { Modal, ModalFooter } from "../../../shared/ui/Modal";

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
          <Checkbox data-ui="checkbox"

            checked={deleteWorktree}
            onCheckedChange={(checked) => setDeleteWorktree((checked === true))}
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
        <ModalFooter>
          <Button variant="secondary" onClick={() => onClose({ confirmed: false, deleteWorktree: false })}>
            {uiT("Cancel")}
          </Button>
          <Button variant="danger" onClick={() => onClose({ confirmed: true, deleteWorktree })}>
            {uiT("Delete session")}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
