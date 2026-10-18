import type { ReactNode } from "react";
import { MenuSubmenu, type MenuSubmenuHandlers } from "../../../shared/ui/primitives/MenuSubmenu";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Switch } from "../../../shared/ui/forms/Switch";
import { MenuHover } from "../../../shared/ui/MenuHover";
/** Branch and worktree rows shown at the foot of the composer's folder menu. */
export function WorkspaceMenuRows({
  branchLabel,
  branchTitle,
  branchDisabled,
  worktree,
  worktreeName,
  worktreeDisabled,
  renderPicker,
  onWorktreeChange,
  onHold,
  onClose,
}: {
  /** Branch to check out, or the base of a new worktree. */
  branchLabel: string;
  branchTitle: string;
  branchDisabled: boolean;
  /** Whether the working copy is a worktree; null leaves the row out. */
  worktree: boolean | null;
  /** Folder name of a started session's worktree. */
  worktreeName?: string;
  worktreeDisabled: boolean;
  /** The branch submenu, opened beside the branch row. */
  renderPicker: (handlers: MenuSubmenuHandlers) => ReactNode;
  onWorktreeChange?: (worktree: boolean) => void;
  /** Keeps the menu open while the submenu or its dialogs take clicks. */
  onHold: (held: boolean) => void;
  onClose: () => void;
}) {
  const { t: uiT } = useTranslation();
  return (
    <>
      <MenuSubmenu
        label={branchTitle} value={branchLabel} disabled={branchDisabled}
        renderPicker={renderPicker} onHold={onHold} onFinish={onClose}
      />
      {/* Shares the menu row geometry and hover layer of the rows above. */}
      {worktree === null ? null : (
        <label
          data-menu-row="single"
          data-workspace-menu-worktree
          aria-disabled={worktreeDisabled || undefined}
          title={worktreeName}
          className={`flex h-8 w-full items-center gap-3 px-2.5 text-content/80 ${
            worktreeDisabled ? "opacity-40" : ""
          }`}
          onMouseDown={(event) => event.preventDefault()}
        >
          <MenuHover />
          <span data-menu-title className="shrink-0 text-[13px]">{uiT("Worktree")}</span>
          <span className="ml-auto min-w-0 truncate text-[12px] text-content/45">
            {worktreeName}
          </span>
          <Switch
            size="sm"
            checked={worktree}
            disabled={worktreeDisabled || !onWorktreeChange}
            aria-label={uiT("Worktree")}
            onCheckedChange={(next) => {
              onWorktreeChange?.(next);
            }}
          />
        </label>
      )}
    </>
  );
}
