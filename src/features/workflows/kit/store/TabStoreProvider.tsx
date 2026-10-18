// Monocode shim: ZCode lists open workspace tabs; Monocode lists the open projects.
import { createContext, useContext } from "react";
import type { WindowTabState } from "../settings/automationWorkspaceOptions.js";

export const WorkflowProjectsContext = createContext<readonly WindowTabState[]>([]);

export function useTabStore<T>(selector: (store: { tabs: readonly WindowTabState[] }) => T): T {
  return selector({ tabs: useContext(WorkflowProjectsContext) });
}
