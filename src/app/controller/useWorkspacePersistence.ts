import type { WorkspaceNavigation } from "../hooks/useWorkspaceNavigation";
import { useEffect, useRef } from "react";
import {
  type DockSide,
  type ProjectTerminalDock as ProjectTerminal,
} from "../../features/projects/model/projectTerminal";
import { type WorkspaceTab } from "../../features/workspace/model/layout";
import type { AppProps } from "./workspaceTypes";
import { type Session } from "../../features/sessions/model/session";
import {
  replaceInFlightSessions,
  saveWorkspaceSnapshot,
} from "../../features/sessions/data/sessionStore";
import {
  inFlightRefs,
  inFlightSnapshotKey,
  shouldWriteInFlightSnapshot,
} from "../../features/sessions/model/inFlight";
import {
  collectWorkspaceSnapshot,
  workspaceSnapshotKey,
} from "../../features/workspace/model/workspaceSnapshot";

type Options = {
  sessions: Session[];
  tabs: WorkspaceTab[];
  activeTabId: string;
  projectCwd: string;
  projectTerminals: ProjectTerminal[];
  lastDockSide: DockSide | null;
  windowTransfer: AppProps["windowTransfer"];
  keepWorkspaceTab: WorkspaceNavigation["keepWorkspaceTab"];
  readProjectReturnMemory: WorkspaceNavigation["readProjectReturnMemory"];
  projectWorktreePath: string | undefined;
  navigationRevision: number;
};

/** Persists in-flight sessions and deduplicated workspace snapshots without rescheduling on streamed frames. */
export function useWorkspacePersistence({
  sessions,
  tabs,
  activeTabId,
  projectCwd,
  projectTerminals,
  lastDockSide,
  windowTransfer,
  keepWorkspaceTab,
  readProjectReturnMemory,
  projectWorktreePath,
  navigationRevision,
}: Options) {
  const inFlightSyncKey = useRef<string | null>(null);
  const sawInFlight = useRef(false);
  const workspaceSyncKey = useRef<string | null>(null);
  const workspaceSaveTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const refs = inFlightRefs(sessions, tabs);
    if (refs.length > 0) sawInFlight.current = true;
    const key = inFlightSnapshotKey(refs);
    if (
      !shouldWriteInFlightSnapshot(
        key,
        refs,
        inFlightSyncKey.current,
        sawInFlight.current,
      )
    ) {
      return;
    }
    inFlightSyncKey.current = key;
    void replaceInFlightSessions(refs).catch(() => undefined);
  }, [sessions, tabs]);

  useEffect(() => {
    if (windowTransfer) return;
    const snapshot = collectWorkspaceSnapshot(
      tabs,
      sessions,
      activeTabId,
      projectCwd,
      readProjectReturnMemory({
        project: projectCwd,
        tabs,
        sessions,
        activeTabId,
      }),
      projectTerminals,
      lastDockSide ?? undefined,
      keepWorkspaceTab,
    );
    const key = workspaceSnapshotKey(snapshot);
    if (workspaceSyncKey.current === key) return;
    workspaceSyncKey.current = key;
    // The key is recorded as soon as a save is scheduled, so an unrelated
    // re-render (every streamed frame) must not cancel it. Only a newer
    // snapshot replaces the pending one.
    window.clearTimeout(workspaceSaveTimer.current);
    workspaceSaveTimer.current = window.setTimeout(() => {
      workspaceSaveTimer.current = undefined;
      void saveWorkspaceSnapshot(snapshot).catch(() => undefined);
    }, 250);
  }, [
    tabs,
    sessions,
    activeTabId,
    projectCwd,
    projectTerminals,
    lastDockSide,
    windowTransfer,
    keepWorkspaceTab,
    readProjectReturnMemory,
    projectWorktreePath,
    navigationRevision,
  ]);
}
