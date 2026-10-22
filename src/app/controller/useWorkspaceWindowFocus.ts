import type { Dispatch, RefObject, SetStateAction } from "react";
import { onWorkspaceWindowFocusChanged } from "../../platform/tauri/workspaceWindow";
import { useEffect, useLayoutEffect } from "react";
import type { HarnessEventQueue } from "../model/harnessFlush";
import type { AppViewKind } from "../../features/workspace/model/layout";
import { type Session } from "../../features/sessions/model/session";
import { syncDockBadge } from "../../features/notifications/model/dockBadge";
import { setWindowFocused } from "../../features/notifications/model/notifications";

type Options = {
  sessions: Session[];
  sessionsRef: RefObject<Session[]>;
  projectTerminalFocusedRef: RefObject<boolean>;
  appViewFocusedRef: RefObject<AppViewKind | undefined>;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  setComposerFocusToken: Dispatch<SetStateAction<number>>;
  activeTabId: string;
  inboxVisible: boolean;
  inboxSessionId: string | undefined;
  activeAppView: AppViewKind | undefined;
  flushHarnessEvents: HarnessEventQueue["flush"];
  flushForegroundHarnessEvents: HarnessEventQueue["flushForeground"];
};

/** Synchronizes window focus, dock badges and foreground output before paint. */
export function useWorkspaceWindowFocus({
  sessions,
  sessionsRef,
  projectTerminalFocusedRef,
  appViewFocusedRef,
  setComposerFocused,
  setComposerFocusToken,
  activeTabId,
  inboxVisible,
  inboxSessionId,
  activeAppView,
  flushHarnessEvents,
  flushForegroundHarnessEvents,
}: Options) {
  useEffect(() => {
    syncDockBadge(sessions);
  }, [sessions]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onWorkspaceWindowFocusChanged(({ payload: focused }) => {
      setWindowFocused(focused);
      if (focused) {
        flushForegroundHarnessEvents();
        syncDockBadge(sessionsRef.current);
        if (
          document.activeElement === document.body &&
          !projectTerminalFocusedRef.current &&
          !appViewFocusedRef.current
        ) {
          setComposerFocused(true);
          setComposerFocusToken((token) => token + 1);
        }
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [flushForegroundHarnessEvents]);

  useEffect(() => {
    const onVisible = () => {
      // Flush on hiding too: WebKit can suspend a pending animation frame,
      // leaving the last output stranded until another event or activation.
      flushHarnessEvents();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [flushHarnessEvents]);

  useLayoutEffect(() => {
    // Catch up only the newly visible panes before paint. Other streams keep
    // their background timer instead of adding work to this tab switch.
    flushForegroundHarnessEvents();
  }, [
    activeTabId,
    inboxVisible,
    inboxSessionId,
    activeAppView,
    flushForegroundHarnessEvents,
  ]);
}
