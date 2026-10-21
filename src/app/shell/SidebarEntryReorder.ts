import { createContext } from "react";
import type { SortableItemState } from "../../shared/ui/primitives/Sortable";

export const SidebarEntryReorderContext = createContext<SortableItemState | null>(null);
