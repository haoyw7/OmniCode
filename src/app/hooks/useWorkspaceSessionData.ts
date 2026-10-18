import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { installNativeSessionSync } from "../../features/sessions/data/nativeSessions";
import {
  flushSessionWrites,
  getSession,
  listLinkedSessions,
  listSessionsByProject,
  rebaseProjectSessions,
  upsertSession,
  type SessionSummary,
} from "../../features/sessions/data/sessionStore";
import type { Session } from "../../features/sessions/model/session";
import { WorkspaceSessionData } from "../model/workspaceSessionData";

export function useWorkspaceSessionData(options: {
  sessionsRef: RefObject<Session[]>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  history: SessionSummary[];
  historyCwd: string | null;
  restoredSessions: Session[] | undefined;
  isSwitching: (id: string) => boolean;
  onImported: (cwd: string) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const [data] = useState(
    () =>
      new WorkspaceSessionData({
        storage: {
          flush: flushSessionWrites,
          get: getSession,
          save: upsertSession,
          list: listSessionsByProject,
          linked: listLinkedSessions,
          rebase: rebaseProjectSessions,
        },
        live: () => latest.current.sessionsRef.current,
        isSwitching: (id) => latest.current.isSwitching(id),
        history: options.history,
        historyCwd: options.historyCwd,
      }),
  );
  const snapshot = useSyncExternalStore(
    data.subscribe,
    data.snapshot,
    data.snapshot,
  );
  useEffect(() => {
    data.start();
    return data.stop;
  }, [data]);
  useEffect(() => {
    data.restore(options.restoredSessions);
  }, [data, options.restoredSessions]);
  useEffect(
    () =>
      installNativeSessionSync({
        live: () => latest.current.sessionsRef.current,
        changed: (session, summary, imported) => {
          if (!data.acceptExternal(session, summary)) return;
          const { sessionsRef, setSessions, onImported } = latest.current;
          // Bulk imports only render transcripts that are already open.
          if (sessionsRef.current.some((entry) => entry.id === session.id)) {
            sessionsRef.current = sessionsRef.current.map((entry) =>
              entry.id === session.id ? session : entry,
            );
            setSessions(sessionsRef.current);
          }
          if (imported) onImported(session.cwd);
        },
      }),
    [data],
  );
  return { data, ...snapshot };
}
