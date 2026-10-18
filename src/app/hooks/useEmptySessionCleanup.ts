import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { Session } from "../../features/sessions/model/session";
import { clearComposerDraft } from "../../features/sessions/model/draftCache";
import {
  leafIds,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";
import { pruneDepartedEmptySessions } from "../model/emptySessionCleanup";

export function useEmptySessionCleanup({
  tabs,
  sessions,
  activeTabId,
  enabled,
  canDiscard,
  setTabs,
  onDiscard,
}: {
  tabs: WorkspaceTab[];
  sessions: Session[];
  activeTabId: string;
  enabled: boolean;
  canDiscard: (id: string) => boolean;
  setTabs: Dispatch<SetStateAction<WorkspaceTab[]>>;
  onDiscard?: (ids: ReadonlySet<string>) => void;
}) {
  const previous = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    // Tools temporarily cover the conversation. Retain its navigation context.
    if (!enabled) return;
    const tab = tabs.find((entry) => entry.id === activeTabId);
    if (!tab) return;
    const current = new Set(
      leafIds(tab.layout).filter((id) =>
        sessions.some((session) => session.id === id),
      ),
    );
    if (!current.size) return;
    const departed = new Set(
      [...(previous.current ?? [])].filter((id) => !current.has(id)),
    );
    previous.current = current;
    if (!departed.size) return;
    const result = pruneDepartedEmptySessions(tabs, departed, canDiscard);
    if (!result.removedIds.length) return;
    for (const id of result.removedIds) clearComposerDraft(id);
    // Existing idle-session detachment releases provider resources after the
    // panes leave the layout; existing navigation effects prune stale ids.
    setTabs(
      (latest) =>
        pruneDepartedEmptySessions(
          latest,
          new Set(result.removedIds),
          canDiscard,
        ).tabs,
    );
    onDiscard?.(new Set(result.removedIds));
  }, [activeTabId, tabs, sessions, enabled, canDiscard, setTabs, onDiscard]);
}
