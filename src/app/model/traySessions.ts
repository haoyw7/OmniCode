import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { remoteRequest } from "../../features/connections/model/connections";
import type {
  HostSessionActivity,
  HostSessionSummary,
} from "../../features/connections/model/protocol";
import {
  sharedHostMachineId,
  sharedProjects,
} from "../../features/connections/model/remoteProjects";
import { sessionDisplayTitle } from "../../features/sessions/model/session";
import { RemoteSessionUnread } from "../../features/sessions/model/remoteSessionUnread";

/** Rust's `tray::OPEN_SESSION_EVENT`, sent to the one window that opens it. */
export const TRAY_OPEN_SESSION_EVENT = "monocode:tray-open-session";

// The activity list carries every Host conversation (~1–2 MB), so poll gently.
const TRAY_POLL_MS = 15_000;
/** Unread and pinned rows always go; the tray shows at most 15 recent ones. */
const TRAY_RECENT_ROWS = 15;

export type TraySession = {
  id: string;
  project: string;
  title: string;
  busy: boolean;
  unread: boolean;
  pinned: boolean;
  activityAt: number;
};

export type TrayLabels = {
  open: string;
  unread: string;
  pinned: string;
  recent: string;
  more: string;
  newSession: string;
  quit: string;
};

/** The Host conversations the sidebar would list, newest first. */
export function traySessions(
  sessions: readonly HostSessionSummary[],
  unread: ReadonlySet<string>,
  projectCwd: (projectId: string) => string | undefined,
): TraySession[] {
  const rows = sessions
    .filter(
      (session) =>
        !session.archived &&
        !session.draft &&
        !session.orchestrationLeadId &&
        !session.workflowParentId &&
        !session.assistantOwnerId,
    )
    .map((session) => ({
      id: session.id,
      project: projectCwd(session.projectId) ?? session.cwd ?? "",
      title: sessionDisplayTitle(session.title, session.harness),
      busy: session.status === "running",
      unread: unread.has(session.id) || !!session.needsInput,
      pinned: !!session.pinned,
      activityAt: session.activityAt ?? session.updatedAt,
    }))
    .filter((row) => row.project)
    .sort((a, b) => b.activityAt - a.activityAt);
  return rows.filter(
    (row, index) => row.unread || row.pinned || index < TRAY_RECENT_ROWS,
  );
}

/**
 * Keep the tray menu in step with the shared Host. `focusedId` is the Host
 * conversation this window shows, which counts as read.
 */
export function useTraySessions(
  enabled: boolean,
  labels: TrayLabels,
  focusedId: string | undefined,
) {
  const tracker = useRef(new RemoteSessionUnread());
  const labelsKey = JSON.stringify(labels);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let last = "";
    const poll = async () => {
      const machineId = sharedHostMachineId();
      if (!machineId) return;
      const activity = await remoteRequest<HostSessionActivity>(
        machineId,
        "sessions.activity",
      ).catch(() => undefined);
      if (cancelled || !activity) return;
      const unread = tracker.current.observe(activity.sessions, focusedId);
      const projects = new Map(
        sharedProjects().map((project) => [project.projectId, project.cwd]),
      );
      const sessions = traySessions(activity.sessions, unread, (id) =>
        projects.get(id),
      );
      // Polls mostly return the same list; only a change rebuilds the menu.
      const next = JSON.stringify(sessions);
      if (next === last) return;
      last = next;
      await invoke("tray_update", {
        labels: JSON.parse(labelsKey) as TrayLabels,
        sessions,
      }).catch(() => undefined);
    };
    void poll();
    const timer = window.setInterval(() => void poll(), TRAY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, labelsKey, focusedId]);
}
