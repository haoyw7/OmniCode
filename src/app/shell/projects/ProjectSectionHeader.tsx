import { IconButton } from "../../../shared/ui/forms/IconButton";
import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { DisclosureChevron } from "../../../shared/ui/DisclosureChevron";
import { MenuHover } from "../../../shared/ui/MenuHover";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { FolderPlus, Internet, Plus } from "../../../shared/ui/icons";
import { useContext, useRef, useState, type ReactNode } from "react";
import { Popover } from "../../../shared/ui/Popover";
import { OPEN_REMOTE_PROJECT_EVENT } from "../../../features/connections/model/connections";
import { SidebarSectionReorderContext } from "./projectListShared";



export function ProjectSectionHeader({
  label,
  expanded,
  contentId,
  onToggleExpanded,
  onAdd,
  onAddGroup,
  children,
}: {
  label: string;
  expanded: boolean;
  contentId: string;
  onToggleExpanded: () => void;
  onAdd?: () => void;
  onAddGroup?: (x: number, y: number) => void;
  children?: ReactNode;
}) {
  const { t: uiT } = useTranslation();
  const reorder = useContext(SidebarSectionReorderContext);
  return (
    <div
      data-sidebar-section-header
      className="group/section flex items-center gap-1 px-3 py-0.5"
    >
      <button
        type="button"
        data-sidebar-section-toggle
        aria-expanded={expanded}
        aria-controls={contentId}
        onPointerDown={(event) =>
          reorder?.sortable.onItemPointerDown(reorder.id, event)
        }
        onClick={onToggleExpanded}
        className={`flex min-w-0 flex-1 items-center gap-1 px-1 py-0.5 text-left text-ui-base text-foreground-subtle hover:text-content ${reorder ? "touch-none cursor-grab" : ""}`}
      >
        <span className="min-w-0 truncate text-foreground-subtle transition-colors duration-150 group-hover/section:text-content motion-reduce:transition-none">
          {label}
        </span>
        <span className="flex size-4 shrink-0 items-center justify-center opacity-0 group-hover/section:opacity-100">
          <DisclosureChevron
            expanded={expanded}
            aria-hidden="true"
            className="project-tree-chevron size-4"
          />
        </span>
      </button>
      {onAddGroup ? (
        <IconButton
          size="sm"
          shape="square"
          data-sidebar-toolbar-action
          label={uiT("New project group")}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onAddGroup(rect.left, rect.bottom);
          }}
        >
          <FolderPlus />
        </IconButton>
      ) : null}
      {onAdd ? <AddProjectButton onOpenFolder={onAdd} /> : null}
      {children}
    </div>
  );
}

/** Adds a folder on this computer, or one on a connected machine. */
export function AddProjectButton({
  onOpenFolder,
}: {
  onOpenFolder: () => void;
}) {
  const { t: uiT } = useTranslation();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const item =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-ui-caption text-content/80 hover:bg-surface-hover hover:text-content";
  return (
    <>
      <IconButton
        ref={anchor}
        size="sm"
        shape="square"
        data-sidebar-toolbar-action
        label={uiT("Open project")}
        active={open}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Plus />
      </IconButton>
      <PresenceBoundary propagate>{open ? (
        <Popover
          anchor={anchor}
          align="start"
          width={230}
          onDismiss={() => setOpen(false)}
          role="menu"
          aria-label={uiT("Open project")}
          className="p-1"
        >
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onOpenFolder();
            }}
          >
            <MenuHover />
            <FolderPlus className="size-3.5 shrink-0" />
            {uiT("Open folder…")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(new Event(OPEN_REMOTE_PROJECT_EVENT));
            }}
          >
            <MenuHover />
            <Internet className="size-3.5 shrink-0" />
            {uiT("Open folder on a machine…")}
          </button>
        </Popover>
      ) : null}</PresenceBoundary>
    </>
  );
}
