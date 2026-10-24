import { showNativeMessage } from "../../../platform/tauri/dialogs";
import { listenReminderOpen, openReminderWindow, registerReminderWindow, showReminderNotification, takeReminderOpen } from "../../../platform/tauri/reminders";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { loadNotificationsEnabled, NOTIFICATIONS_CHANGE_EVENT } from "../model/notifications";
import { loadSoundsEnabled, SOUNDS_CHANGE_EVENT } from "../../settings/model/sounds";
import { getProjectNotificationRule, subscribeNotificationPreferences } from "../model/notificationPreferences";
import { knownNotificationProject } from "../model/notificationProjects";
import { claimDueReminders, clearReminders, listReminders, REMINDERS_CHANGED, setReminders } from "../../sessions/model/sessionReminders";
import type { ReminderTarget, SessionReminder } from "../../../contracts/reminders";
import { translate } from "../../../shared/i18n/language";

/** Host owns the schedule; this refresh also catches other windows and devices. */
const REFRESH_MS = 30_000;

export function useSessionReminders(
  onOpenSession: (sessionId: string) => Promise<void>,
  ensureSaved: (sessionIds: readonly string[]) => Promise<void>,
  openSessionIds: readonly string[],
) {
  const [reminders, setItems] = useState<SessionReminder[]>([]);
  const [now, setNow] = useState(Date.now);
  const [error, setError] = useState<string | null>(null);
  const [, refreshPolicy] = useReducer((revision: number) => revision + 1, 0);
  const revision = useRef(0);
  const delivering = useRef<Promise<void> | null>(null);
  const dueTimer = useRef<number | undefined>(undefined);
  const remindersRef = useRef(reminders);
  remindersRef.current = reminders;
  const callbacks = useRef({ onOpenSession, ensureSaved });
  callbacks.current = { onOpenSession, ensureSaved };

  /**
   * Claim only reminders whose project policy this window can resolve, as the
   * shell scheduler did. Muted reminders are still claimed so they never replay.
   */
  const deliver = useCallback(async () => {
    if (delivering.current) return delivering.current;
    const run = (async () => {
      const current = Date.now();
      const resolved = remindersRef.current.filter((reminder) =>
        reminder.firedAt === null && reminder.dueAt <= current && knownNotificationProject(reminder.cwd));
      if (resolved.length === 0) return;
      const claimed = await claimDueReminders(resolved.map((reminder) => reminder.sessionId));
      const enabled = loadNotificationsEnabled();
      const sound = loadSoundsEnabled();
      for (const reminder of claimed) {
        const project = knownNotificationProject(reminder.cwd);
        const rule = project && getProjectNotificationRule(project.id, "reminders");
        if (!enabled || !rule?.enabled || reminder.dueAt <= rule.after) continue;
        await showReminderNotification({
          sessionId: reminder.sessionId, dueAt: reminder.dueAt, title: reminder.title,
          body: translate("Reminder: continue this conversation."), sound,
        }).catch(() => undefined);
      }
    })();
    delivering.current = run;
    try { await run; } finally { delivering.current = null; }
  }, []);

  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try {
      const { reminders: items, nextDueAt } = await listReminders();
      if (request !== revision.current) return;
      remindersRef.current = items;
      setItems(items);
      setNow(Date.now());
      setError(null);
      window.clearTimeout(dueTimer.current);
      if (nextDueAt !== null) {
        const wait = Math.max(0, nextDueAt - Date.now());
        if (wait < REFRESH_MS) dueTimer.current = window.setTimeout(() => { void refresh(); }, wait + 50);
      }
      if (items.some((item) => item.firedAt === null && item.dueAt <= Date.now())) {
        await deliver();
        if (request === revision.current) {
          const next = await listReminders();
          if (request !== revision.current) return;
          remindersRef.current = next.reminders;
          setItems(next.reminders);
        }
      }
    } catch (error) {
      if (request === revision.current) setError(String(error));
    }
  }, [deliver]);

  const report = (error: unknown) => {
    void showNativeMessage(String(error), { title: translate("Reminder"), kind: "error" });
  };

  const schedule = useCallback(
    async (ids: readonly string[], dueAt: number) => {
      try {
        await callbacks.current.ensureSaved(ids);
        await setReminders(ids, dueAt);
        await refresh();
      } catch (error) {
        report(error);
      }
    },
    [refresh],
  );

  const cancel = useCallback(
    async (ids: readonly string[], expectedDueAt?: number) => {
      try {
        await clearReminders(ids, expectedDueAt);
        await refresh();
      } catch (error) {
        report(error);
      }
    },
    [refresh],
  );

  const dismissDue = useCallback(
    async (sessionId: string) => {
      const reminder = remindersRef.current.find(
        (item) => item.sessionId === sessionId && item.dueAt <= Date.now(),
      );
      if (!reminder) return;
      await cancel([sessionId], reminder.dueAt);
    },
    [cancel],
  );

  const openHere = useCallback(
    async (reminder: ReminderTarget) => {
      try {
        await callbacks.current.onOpenSession(reminder.sessionId);
        // An old notification must never clear a newer reminder for this session.
        await clearReminders([reminder.sessionId], reminder.dueAt);
        await refresh();
      } catch (error) {
        report(error);
      }
    },
    [refresh],
  );

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const policyChanged = () => {
      refreshPolicy();
      void deliver().catch((error) => {
        if (!disposed) setError(String(error));
      });
    };
    const takeOpen = async () => {
      if (disposed) return;
      try {
        const request = await takeReminderOpen();
        if (request && !disposed) await openHere(request);
      } catch (error) {
        if (!disposed) setError(String(error));
      }
    };
    const onChanged = () => { void refresh(); };
    void (async () => {
      try {
        const stop = await listenReminderOpen(() => { void takeOpen(); });
        if (disposed) { stop(); return; }
        unlisten = stop;
        await refresh();
        await takeOpen();
      } catch (error) {
        if (!disposed) setError(String(error));
      }
    })();
    const onFocus = () => {
      void refresh();
      void takeOpen();
    };
    const onVisible = () => {
      if (!document.hidden) onFocus();
    };
    // Catches renamed/deleted sessions, other windows and devices, and a
    // machine waking after its scheduled time.
    const timer = window.setInterval(onChanged, REFRESH_MS);
    window.addEventListener(REMINDERS_CHANGED, onChanged);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(NOTIFICATIONS_CHANGE_EVENT, policyChanged);
    window.addEventListener(SOUNDS_CHANGE_EVENT, policyChanged);
    window.addEventListener("storage", policyChanged);
    const unsubscribePreferences = subscribeNotificationPreferences(policyChanged);
    return () => {
      disposed = true;
      unsubscribePreferences();
      revision.current++;
      unlisten?.();
      window.clearInterval(timer);
      window.clearTimeout(dueTimer.current);
      window.removeEventListener(REMINDERS_CHANGED, onChanged);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(NOTIFICATIONS_CHANGE_EVENT, policyChanged);
      window.removeEventListener(SOUNDS_CHANGE_EVENT, policyChanged);
      window.removeEventListener("storage", policyChanged);
    };
  }, [openHere, refresh, deliver]);

  const sessionIdsKey = JSON.stringify(openSessionIds);
  useEffect(() => {
    void registerReminderWindow(JSON.parse(sessionIdsKey)).catch((error) => setError(String(error)));
  }, [sessionIdsKey]);

  const open = useCallback(async (reminder: ReminderTarget) => {
    try {
      await openReminderWindow(reminder);
    } catch (error) {
      report(error);
    }
  }, []);

  return {
    reminders,
    due: reminders.filter((reminder) => {
      const project = knownNotificationProject(reminder.cwd);
      if (!project || reminder.dueAt > now) return false;
      const rule = getProjectNotificationRule(project.id, "reminders");
      return rule.enabled && reminder.dueAt > rule.after;
    }),
    error,
    refresh,
    schedule,
    cancel,
    dismissDue,
    open,
  };
}
