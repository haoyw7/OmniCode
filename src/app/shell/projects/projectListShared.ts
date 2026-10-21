import { duration } from "../../../shared/motion/tokens";
import type { ProjectHoverSummary } from "../../model/projectHoverSummary";
import { createContext, type ReactNode } from "react";
import type { SortableItemState } from "../../../shared/ui/primitives/Sortable";
import { sameProjectPath } from "../../../features/projects/model/recents";
import { type SidebarOrderedSectionId } from "../../../features/settings/model/sidebarSectionOrder";


export type ProjectListEntry = { id: string; content: ReactNode | (() => ReactNode) };

export const PROJECT_COLLAPSE_DURATION_MS = duration.collapse * 1000;

export const ProjectSummaryContext = createContext<{
  summaries?: ReadonlyMap<string, ProjectHoverSummary>;
  onOpen?: (path: string) => void;
  onPin?: (path: string) => void;
  restoringPinFocusPath?: { current: string | undefined };
  disabled: boolean;
}>({ disabled: false });

export const SidebarSectionReorderContext = createContext<{
  id: SidebarOrderedSectionId;
  item: SortableItemState;
} | null>(null);

export type ProjectTree = {
  expandedPaths: ReadonlySet<string>;
  pendingActivation: { current: string | undefined };
  onToggleProject?: (path: string) => void;
  onActivateProject?: (path: string) => void;
  canExpandProject?: (path: string) => boolean;
  renderProjectChildren?: (path: string) => ReactNode;
  onNewInProject?: (path: string) => void;
  needsApproval: ReadonlySet<string>;
};

export const nameClassName =
  "min-w-0 flex-1 truncate text-ui-base font-medium leading-tight";

export function isBusyPath(path: string, busy: Set<string>): boolean {
  for (const other of busy) {
    if (sameProjectPath(path, other)) return true;
  }
  return false;
}
