import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  findSurfacePane,
  focusedFileTab,
  leafIds,
  type AppPageKind,
  type AppViewKind,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";
import {
  emptyTabVisitHistory,
  pruneTabVisitHistory,
  recordTabVisit,
  tabVisitBack,
  tabVisitForward,
  type TabVisitHistory,
} from "../../features/workspace/model/tabVisitHistory";

export type PageDestination = {
  tabId: string;
  paneId: string;
  fileId?: string;
  page: AppPageKind | null;
  dialog: AppViewKind | null;
};

/** One visit stack for chats, documents, app pages and their dialogs. */
export function usePageNavigation({
  tabs,
  activeTabId,
  page,
  dialog,
  notesEnabled,
  navigate,
}: {
  tabs: WorkspaceTab[];
  activeTabId: string;
  page: AppPageKind | null;
  dialog: AppViewKind | null;
  notesEnabled: boolean;
  navigate: (destination: PageDestination) => void;
}) {
  const tab = tabs.find((entry) => entry.id === activeTabId) ?? tabs[0];
  const destination: PageDestination = {
    tabId: tab?.id ?? "",
    paneId: tab?.focusedId ?? "",
    fileId: tab && focusedFileTab(tab)?.id,
    page,
    dialog,
  };
  const key = JSON.stringify(destination);
  const destinations = useRef(new Map<string, PageDestination>());
  const history = useRef(emptyTabVisitHistory(key));
  const latest = useRef({ tabs, notesEnabled, navigate });
  latest.current = { tabs, notesEnabled, navigate };
  const [availability, setAvailability] = useState({
    canBack: false,
    canForward: false,
  });

  const prune = useCallback((visits: TabVisitHistory, current: string) => {
    const open = new Set<string>();
    for (const [id, target] of destinations.current) {
      if (target.page === "notes" && !latest.current.notesEnabled) continue;
      const owner = latest.current.tabs.find(
        (entry) => entry.id === target.tabId,
      );
      if (!owner) continue;
      const surface = findSurfacePane(owner, target.paneId)?.pane;
      if (
        target.fileId
          ? surface?.files.some((file) => file.id === target.fileId)
          : leafIds(owner.layout).includes(target.paneId)
      )
        open.add(id);
    }
    return pruneTabVisitHistory(visits, open, current);
  }, []);

  const commit = useCallback((next: TabVisitHistory) => {
    history.current = next;
    const canBack = next.back.length > 0;
    const canForward = next.forward.length > 0;
    setAvailability((previous) =>
      previous.canBack === canBack && previous.canForward === canForward
        ? previous
        : { canBack, canForward },
    );
    const retained = new Set([...next.back, next.current, ...next.forward]);
    for (const id of destinations.current.keys()) {
      if (!retained.has(id)) destinations.current.delete(id);
    }
  }, []);

  useLayoutEffect(() => {
    destinations.current.set(key, JSON.parse(key) as PageDestination);
    const previous = prune(history.current, key);
    commit(prune(recordTabVisit(previous, key), key));
  }, [key, tabs, notesEnabled, prune, commit]);

  const visit = useCallback(
    (step: typeof tabVisitBack) => {
      const previous = prune(history.current, history.current.current);
      const next = step(previous);
      const target = next && destinations.current.get(next.current);
      commit(next ?? previous);
      if (target) latest.current.navigate(target);
    },
    [prune, commit],
  );

  const back = useCallback(() => visit(tabVisitBack), [visit]);
  const forward = useCallback(() => visit(tabVisitForward), [visit]);
  const previousTabs = useCallback(
    () =>
      history.current.back.flatMap((id) => {
        const target = destinations.current.get(id);
        return target ? [target.tabId] : [];
      }),
    [],
  );

  return { ...availability, back, forward, previousTabs };
}
