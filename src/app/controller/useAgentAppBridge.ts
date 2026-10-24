import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import type { Session } from "../../contracts/session";
import type { DesktopAppCommand } from "../../contracts/app";
import type { RemoteMachine } from "../../contracts/protocol";
import { consumeDesktopAppCommands } from "../../features/connections/model/desktopAppCommands";
import { loadRemoteSession, rememberRemoteSession, remoteSessionFor, useRemoteMachines, REMOTE_HISTORY_CHANGE } from "../../features/connections/model/connections";
import { projectPath, remoteProjectFor } from "../../features/connections/model/remoteProjects";
import { sharedSessionBackend } from "../../features/sessions/data/sharedSessionBackend";
import { leafIds, newTab, splitPane, type WorkspaceTab } from "../../features/workspace/model/layout";
import { desktopWindow } from "../../platform/tauri/window";

type Options = {
  sessionsRef: RefObject<Session[]>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  tabsRef: RefObject<WorkspaceTab[]>;
  setTabs: Dispatch<SetStateAction<WorkspaceTab[]>>;
  appendTab(tab: WorkspaceTab, cwd?: string): void;
  revealTab(tabId: string, cwd: string): void;
};

/** Only presentation remains in the window: Host already created/sent the session. */
export function useAgentAppBridge(options: Options) {
  const current = useRef(options); current.current = options;
  const windowId = useRef<string | undefined>(undefined);
  if (!windowId.current) windowId.current = `${desktopWindow().label}-${crypto.randomUUID()}`;
  const { machines } = useRemoteMachines();
  const [, refreshBindings] = useState(0);
  useEffect(() => {
    const changed = () => refreshBindings(value => value + 1);
    window.addEventListener(REMOTE_HISTORY_CHANGE, changed);
    return () => window.removeEventListener(REMOTE_HISTORY_CHANGE, changed);
  }, []);
  const machinesKey = machines.map(machine => `${machine.id}:${machine.environmentId}`).sort().join("\n");
  const sessionsKey = options.sessionsRef.current.map(session =>
    `${remoteProjectFor(session.cwd)?.environmentId}:${remoteSessionFor(session.id) ?? ""}`).sort().join("\n");
  useEffect(() => {
    let alive = true;
    const stops = machines.map(machine => consumeDesktopAppCommands(machine, windowId.current!, () =>
      current.current.sessionsRef.current.flatMap(session => {
        if (remoteProjectFor(session.cwd)?.environmentId !== machine.environmentId) return [];
        const id = remoteSessionFor(session.id);
        return id ? [id] : [];
      }), async command => {
        if (!alive) throw new Error("The workspace window is closed");
        return revealHostSession(machine, command, current.current, () => alive);
      }));
    return () => { alive = false; stops.forEach(stop => stop()); };
  }, [machinesKey, sessionsKey]);
}

export async function revealHostSession(machine: RemoteMachine, command: DesktopAppCommand,
  options: Options, alive: () => boolean = () => true): Promise<{ sessionId: string; tabId: string }> {
  const match = (wireId: string) => options.sessionsRef.current.find(session =>
    remoteProjectFor(session.cwd)?.environmentId === machine.environmentId && remoteSessionFor(session.id) === wireId);
  const source = match(command.sourceSessionId);
  const project = source && remoteProjectFor(source.cwd);
  if (command.action !== "sessions.reveal" || !source || !project || project.projectId !== command.projectId)
    throw new Error("This conversation is not attached to its Host");
  const snapshot = await loadRemoteSession(machine.id, command.sessionId);
  if (!alive()) throw new Error("The workspace window is closed");
  if (!match(command.sourceSessionId)) throw new Error("The source conversation is no longer open in this window");
  if (snapshot.projectId !== command.projectId || snapshot.session.id !== command.sessionId)
    throw new Error("This conversation is not attached to its Host");
  const previous = match(command.sessionId);
  const session: Session = { ...snapshot.session,
    id: previous?.id ?? (project.local ? command.sessionId : crypto.randomUUID()), cwd: project.key,
    executionCwd: projectPath(project, snapshot.session.executionCwd ?? snapshot.session.cwd),
  };
  const existingTab = options.tabsRef.current.find(tab => leafIds(tab.layout).includes(session.id));
  let tabId = existingTab?.id;
  let nextTabs: WorkspaceTab[] | undefined = existingTab && command.reveal
    ? options.tabsRef.current.map(tab => tab.id === existingTab.id ? { ...tab, focusedId: session.id, diffFocused: false } : tab)
    : undefined;
  if (!tabId && command.placement) {
    const anchor = match(command.placement.besideSessionId);
    const anchorProject = anchor && remoteProjectFor(anchor.cwd);
    const tab = anchor && options.tabsRef.current.find(entry => leafIds(entry.layout).includes(anchor.id));
    if (!anchor || !tab || anchorProject?.projectId !== command.projectId)
      throw new Error("The target session must be open in this project");
    tabId = tab.id;
    nextTabs = options.tabsRef.current.map(entry => entry.id === tab.id ? {
      ...entry, layout: splitPane(entry.layout, anchor.id, command.placement!.direction, session.id),
      focusedId: command.reveal ? session.id : entry.focusedId,
      diffFocused: command.reveal ? false : entry.diffFocused,
    } : entry);
  }
  rememberRemoteSession(session.id, command.sessionId, project);
  if (project.local) sharedSessionBackend()?.rememberSession(session.id, project.key);
  const nextSessions = [...options.sessionsRef.current.filter(entry => entry.id !== session.id), session];
  options.sessionsRef.current = nextSessions;
  options.setSessions(nextSessions);
  if (nextTabs) { options.tabsRef.current = nextTabs; options.setTabs(nextTabs); }
  if (!tabId) {
    const tab = newTab(session.id);
    tabId = tab.id;
    options.appendTab(tab, project.key);
    // appendTab may defer React's commit; retain the identity for duplicate delivery.
    if (!options.tabsRef.current.some(entry => entry.id === tab.id))
      options.tabsRef.current = [...options.tabsRef.current, tab];
  }
  if (command.reveal) options.revealTab(tabId, project.key);
  return { sessionId: command.sessionId, tabId };
}
