import { useCallback, useEffect, useRef, useState } from "react";
import { takeBotNotification as takeAssistantNotification } from "../features/bots/model/botNotifications";
import type { MobileClient } from "./client";
import type { SessionSnapshotStore } from "./sessionSnapshotStore";
import { pendingSessionInputKey } from "../features/sessions/model/sessionActivity";
import {
  loadMobileActivity,
  saveMobileActivity,
  type ActivityNotice,
  type MobileActivity,
} from "./activity";
import { playCue } from "../features/settings/model/sounds";
import {
  MobileNotifications,
  mobileNotificationPermission,
  mobileNotificationTexts,
  nativeActivityNotifications,
  showBrowserActivityNotification,
  showBrowserAssistantNotification,
  type MobileNotificationPermission,
  type MobileNotificationTarget,
} from "./notifications";
import { translate } from "../shared/i18n/language";
import { NativeActivitySync } from "./nativeActivitySync";
import type { HostSessionSummary } from "../features/connections/model/protocol";
import type { BotNotificationActivity as AssistantNotificationActivity } from "../features/bots/model/botNotifications";

const ENABLED_KEY = "monocode.mobileNotifications";

/** One cue per poll, however many conversations changed at once. */
function playActivityCue(notices: readonly ActivityNotice[]) {
  for (const notice of notices)
    if (
      playCue("turnFinished", {
        projectId: notice.session.projectId,
        category: notice.kind === "input" ? "agentInput" : "agentFinished",
      })
    )
      return;
}
/** Sends only what changed since the tracker's last snapshot, falling back
 * to the full list when it has none or rejects the changes. */
async function observeNative(
  sync: NativeActivitySync,
  environmentId: string,
  sessions: readonly HostSessionSummary[],
  assistant: AssistantNotificationActivity | null | undefined,
  enabled: boolean,
) {
  const { update, commit } = sync.plan(environmentId, sessions);
  if (!update.full) {
    try {
      const state = await MobileNotifications.observeChanges({
        environmentId,
        sessions: update.sessions,
        removed: update.removed,
        assistant,
        enabled,
      });
      commit();
      return state;
    } catch {
      sync.reset();
    }
  }
  const full = update.full ? { update, commit } : sync.plan(environmentId, sessions);
  try {
    const state = await MobileNotifications.observe({
      environmentId,
      sessions: full.update.sessions,
      assistant,
      enabled,
    });
    full.commit();
    return state;
  } catch (problem) {
    sync.reset();
    throw problem;
  }
}

export function useMobileActivity(
  client: MobileClient,
  options: {
    connected: boolean;
    foreground: boolean;
    assistantVisible?: boolean;
    snapshots?: Pick<SessionSnapshotStore, "getRendered" | "subscribeRendered">;
    visibleSession?: {
      id: string;
      projectId: string;
      revision: number;
      lastCompletedRunId?: string | null;
      pendingInputKey?: string | null;
    };
    language: string;
    onOpen: (target: MobileNotificationTarget) => void | Promise<void>;
  },
) {
  const { connected, foreground, visibleSession, assistantVisible, language, snapshots } = options;
  const environmentId = connected
    ? client.connection?.environmentId
    : undefined;
  const [unreadIds, commitUnreadIds] = useState<Set<string>>(() => new Set());
  const setUnreadIds = useCallback((update: Set<string> | ((previous: Set<string>) => Set<string>)) => {
    commitUnreadIds((previous) => {
      const next = typeof update === "function" ? update(previous) : update;
      return next.size === previous.size && [...next].every((id) => previous.has(id)) ? previous : next;
    });
  }, []);
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(ENABLED_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [permission, setPermission] =
    useState<MobileNotificationPermission>("prompt");
  const [notificationError, setNotificationError] = useState("");
  const hadConnection = useRef(false);
  const activity = useRef<MobileActivity | undefined>(undefined);
  const nativeSync = useRef(new NativeActivitySync());
  const current = useRef({ ...options, environmentId, enabled, permission });
  current.current = { ...options, environmentId, enabled, permission };
  const readVisibleSession = useCallback(() => {
    const { visibleSession: visible, snapshots: source } = current.current;
    if (!visible || !source) return visible;
    const rendered = source.getRendered();
    if (rendered?.session.id !== visible.id) return undefined;
    return {
      id: rendered.session.id, projectId: rendered.projectId, revision: rendered.revision,
      lastCompletedRunId: rendered.lastCompletedRunId,
      pendingInputKey: pendingSessionInputKey(rendered.session, rendered.runId),
    };
  }, []);
  const onOpen = (target: MobileNotificationTarget) => {
    if (target.environmentId !== current.current.environmentId) return;
    void Promise.resolve(current.current.onOpen(target)).catch(() => {});
  };

  useEffect(() => {
    if (!environmentId) {
      setUnreadIds(new Set());
      return;
    }
    let live = true;
    activity.current = loadMobileActivity(environmentId);
    setUnreadIds(
      new Set(
        nativeActivityNotifications()
          ? activity.current.manualUnreadIds()
          : activity.current.unreadIds(),
      ),
    );
    if (!nativeActivityNotifications()) {
      return;
    }
    const apply = (result: { environmentId: string; unreadIds: string[] }) => {
      if (
        live &&
        result.environmentId === environmentId &&
        current.current.environmentId === environmentId
      )
        setUnreadIds(
          new Set([
            ...result.unreadIds,
            ...(activity.current?.manualUnreadIds() ?? []),
          ]),
        );
    };
    const unreadListener = MobileNotifications.addListener("unread", apply);
    const openListener = MobileNotifications.addListener("open", onOpen);
    void (async () => {
      await openListener;
      apply(await MobileNotifications.state({ environmentId }));
      const pending = await MobileNotifications.consumeOpen();
      if (live && pending.target) onOpen(pending.target);
    })().catch(() => {});
    return () => {
      live = false;
      void unreadListener.then((handle) => handle.remove()).catch(() => {});
      void openListener.then((handle) => handle.remove()).catch(() => {});
    };
  }, [environmentId]);

  useEffect(() => {
    if (!foreground) return;
    let live = true;
    void (async () => {
      let next = await mobileNotificationPermission();
      if (
        next === "prompt" &&
        connected &&
        nativeActivityNotifications()
      )
        next = await mobileNotificationPermission(true);
      if (live) setPermission(next);
    })();
    return () => {
      live = false;
    };
  }, [connected, enabled, foreground]);

  useEffect(() => {
    if (!nativeActivityNotifications()) return;
    // Initial restoration and permission checks may run while a native service
    // from the previous activity is still receiving updates.
    if (!connected) {
      if (hadConnection.current || client.connection?.disabled)
        void MobileNotifications.stop().catch(() => {});
      hadConnection.current = false;
      return;
    }
    hadConnection.current = true;
    if (permission === "denied" || permission === "unsupported") {
      void MobileNotifications.stop().catch(() => {});
    } else if (permission === "granted" && foreground && client.connection) {
      void MobileNotifications.start({
        ...client.connection,
        enabled,
        texts: mobileNotificationTexts(client.connection.name),
      })
        .then(() => setNotificationError(""))
        .catch(() =>
          setNotificationError(
            translate("Unable to receive background conversation updates."),
          ),
        );
    }
  }, [
    connected,
    environmentId,
    enabled,
    permission,
    foreground,
    language,
    client,
    client.connection,
  ]);

  // The open conversation never produces a notice, so cue its own transitions.
  const visibleCursor = useRef<
    { id: string; finished: string | null; input: string | null } | undefined
  >(undefined);
  useEffect(() => {
    if (!visibleSession) {
      visibleCursor.current = undefined;
      return;
    }
    const finished = visibleSession.lastCompletedRunId ?? null;
    const input = visibleSession.pendingInputKey ?? null;
    const previous = visibleCursor.current;
    visibleCursor.current = { id: visibleSession.id, finished, input };
    if (!foreground || previous?.id !== visibleSession.id) return;
    const newInput = !!input && input !== previous.input;
    const newFinish = !!finished && finished !== previous.finished;
    if (newInput || newFinish)
      playCue("turnFinished", {
        projectId: visibleSession.projectId,
        category: newInput ? "agentInput" : "agentFinished",
      });
  }, [
    foreground,
    visibleSession?.id,
    visibleSession?.projectId,
    visibleSession?.lastCompletedRunId,
    visibleSession?.pendingInputKey,
  ]);

  useEffect(() => {
    if (!environmentId) return;
    let live = true;
    let generation = 0;
    let previousKey: string | undefined;
    const update = () => {
      // A transcript layout commit can notify the previous subscription before
      // passive effect cleanup. Never acknowledge it with stale Host/visibility.
      if (!live || current.current.environmentId !== environmentId) return;
      const { foreground, assistantVisible } = current.current;
      const visible = readVisibleSession();
      const key = JSON.stringify([foreground, assistantVisible, visible]);
      if (key === previousKey) return;
      previousKey = key;
      const turn = ++generation;
      if (foreground && visible && activity.current) {
        activity.current.markRead(visible.id, visible.revision, {
          finished: visible.lastCompletedRunId, input: visible.pendingInputKey,
        });
        saveMobileActivity(environmentId, activity.current);
      }
      if (nativeActivityNotifications()) {
        void MobileNotifications.setVisible({
          environmentId, foreground, assistantVisible,
          sessionId: visible?.id, revision: visible?.revision,
          ...(visible?.lastCompletedRunId !== undefined ? { lastCompletedRunId: visible.lastCompletedRunId } : {}),
          ...(visible?.pendingInputKey !== undefined ? { pendingInputKey: visible.pendingInputKey } : {}),
        }).then((result) => {
          if (live && turn === generation && current.current.environmentId === environmentId
            && current.current.foreground === foreground && current.current.assistantVisible === assistantVisible)
            setUnreadIds(new Set([...result.unreadIds, ...(activity.current?.manualUnreadIds() ?? [])]));
        }).catch(() => {});
      } else if (foreground && visible && activity.current) {
        setUnreadIds(new Set(activity.current.unreadIds()));
      }
    };
    const unsubscribe = snapshots?.subscribeRendered(update);
    update();
    return () => { live = false; unsubscribe?.(); };
  }, [environmentId, foreground, assistantVisible, visibleSession?.id,
    visibleSession?.revision, visibleSession?.lastCompletedRunId, visibleSession?.pendingInputKey,
    snapshots, readVisibleSession, setUnreadIds]);

  useEffect(() => {
    if (!environmentId || !foreground) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const poll = async () => {
      try {
        const result = await client.activity();
        if (!live || result.environmentId !== environmentId) return;
        if (nativeActivityNotifications()) {
          playActivityCue(
            activity.current?.observe(
              result.sessions,
              readVisibleSession()?.id,
            ) ?? [],
          );
          if (activity.current) saveMobileActivity(environmentId, activity.current);
          const state = await observeNative(
            nativeSync.current,
            environmentId,
            result.sessions,
            result.assistant,
            current.current.enabled &&
              current.current.permission === "granted",
          );
          if (live)
            setUnreadIds(
              new Set([
                ...state.unreadIds,
                ...(activity.current?.manualUnreadIds() ?? []),
              ]),
            );
        } else if (activity.current) {
          const assistantNotice = takeAssistantNotification(environmentId, result.assistant ?? null);
          if (assistantNotice && result.assistant && !current.current.assistantVisible &&
            current.current.enabled && current.current.permission === "granted")
            showBrowserAssistantNotification(result.assistant, environmentId, onOpen);
          const notices = activity.current.observe(
            result.sessions,
            readVisibleSession()?.id,
          );
          playActivityCue(notices);
          const visible = readVisibleSession();
          if (visible)
            activity.current.markRead(visible.id, visible.revision, {
              finished: visible.lastCompletedRunId,
              input: visible.pendingInputKey,
            });
          saveMobileActivity(environmentId, activity.current);
          if (live) setUnreadIds(new Set(activity.current.unreadIds()));
          if (
            current.current.enabled &&
            current.current.permission === "granted"
          )
            for (const notice of notices)
              showBrowserActivityNotification(
                notice.session,
                notice.kind,
                environmentId,
                onOpen,
              );
        }
        failures = 0;
      } catch {
        failures = Math.min(failures + 1, 4);
      } finally {
        if (live)
          timer = setTimeout(
            poll,
            failures ? Math.min(60_000, 3_000 * 2 ** failures) : 3_000,
          );
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [environmentId, foreground, client]);

  const setNotificationsEnabled = async (next: boolean) => {
    try {
      localStorage.setItem(ENABLED_KEY, next ? "1" : "0");
    } catch {
      /* Runtime preference remains effective. */
    }
    setEnabled(next);
    if (next) setPermission(await mobileNotificationPermission(true));
  };
  const requestPermission = async () =>
    setPermission(await mobileNotificationPermission(true));
  const openSettings = () => MobileNotifications.openSettings().catch(() => {});
  const markUnread = (id: string, revision: number) => {
    if (!environmentId || !activity.current) return;
    activity.current.markUnread(id, revision);
    saveMobileActivity(environmentId, activity.current);
    setUnreadIds((ids) => new Set([...ids, id]));
  };
  return {
    unreadIds,
    markUnread,
    enabled,
    permission,
    notificationError,
    setNotificationsEnabled,
    requestPermission,
    openSettings,
    canOpenSettings: nativeActivityNotifications(),
  };
}
