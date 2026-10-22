import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useRef } from "react";
import { generateConfiguredSessionTitle } from "../../features/sessions/model/titleModelClient";
import { readHarnessSessionTitle } from "../../integrations/harness/core/registry";
import { SessionTitleCoordinator } from "../../integrations/harness/core/titleCoordinator";
import { type Session } from "../../features/sessions/model/session";
import { sessionUsesHost } from "../../features/connections/model/remoteProjects";

type Options = {
  sessions: Session[];
  sessionsRef: RefObject<Session[]>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
};

/** Owns native title bindings and the lifetime of the title coordinator. */
export function useSessionTitles({
  sessions,
  sessionsRef,
  setSessions,
}: Options) {
  const titleCoordinator = useRef<SessionTitleCoordinator | null>(null);
  if (!titleCoordinator.current)
    titleCoordinator.current = new SessionTitleCoordinator({
      get: (id) => sessionsRef.current.find((session) => session.id === id),
      update: (id, change) => {
        const previous = sessionsRef.current;
        const next = previous.map((session) =>
          session.id === id ? change(session) : session,
        );
        if (!next.some((session, index) => session !== previous[index])) return;
        sessionsRef.current = next;
        setSessions((current) =>
          current.map((session) =>
            session.id === id ? change(session) : session,
          ),
        );
      },
      read: readHarnessSessionTitle,
      generate: (session, message) =>
        generateConfiguredSessionTitle(session.cwd, message),
    });
  useEffect(() => () => titleCoordinator.current?.close(), []);
  const titleBindings = useRef(new Map<string, string>());
  useEffect(() => {
    const present = new Set(sessions.map((session) => session.id));
    for (const id of titleBindings.current.keys())
      if (!present.has(id)) {
        titleBindings.current.delete(id);
        titleCoordinator.current!.cancel(id);
      }
    for (const session of sessions) {
      if (!session.providerSessionId || sessionUsesHost(session)) continue;
      const binding = `${session.harness}:${session.providerAccountId ?? "default"}:${session.providerSessionId}`;
      if (titleBindings.current.get(session.id) === binding) continue;
      titleBindings.current.set(session.id, binding);
      void titleCoordinator.current!.read(session.id);
    }
  }, [sessions]);

  return { titleCoordinator };
}
