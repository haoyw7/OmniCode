import { useCallback, useSyncExternalStore } from "react";
import {
  nativeSessionAccessHint,
  nativeSessionAccessSnapshot,
  nativeSessionReadOnly,
  subscribeNativeSessionAccess,
} from "../data/nativeSessions";
import type { Session } from "../model/session";

/** Access checks for another pane, and lease renewals, do not redraw this pane. */
export function useNativeSessionAccess(session: Session) {
  const native = !!session.nativeSession;
  const subscribe = useCallback(
    (listener: () => void) =>
      native ? subscribeNativeSessionAccess(session.id, listener) : () => {},
    [session.id, native],
  );
  const snapshot = useCallback(
    () => nativeSessionAccessSnapshot(session),
    [session],
  );
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return {
    readOnly: nativeSessionReadOnly(session),
    hint: nativeSessionAccessHint(session),
  };
}
