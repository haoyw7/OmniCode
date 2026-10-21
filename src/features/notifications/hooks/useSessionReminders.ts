import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useMutation, useQuery } from "@tanstack/react-query";
import { invalidateAfterChange, queryClient } from "../../../shared/lib/queryClient";
import { toast } from "sonner";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  loadNotificationsEnabled,
  NOTIFICATIONS_CHANGE_EVENT,
} from "../model/notifications";
import { loadSoundsEnabled, SOUNDS_CHANGE_EVENT } from "../../settings/model/sounds";
import {
  getProjectNotificationRule,
  subscribeNotificationPreferences,
} from "../model/notificationPreferences";
import {
  knownNotificationProject,
} from "../model/notificationProjects";
import {
  clearReminders,
  listReminders,
  REMINDER_OPEN,
  REMINDERS_CHANGED,
  setReminders,
  type ReminderTarget,
  type SessionReminder,
} from "../../sessions/model/sessionReminders";

const EMPTY_REMINDERS: SessionReminder[] = [];

export function useSessionReminders(
  onOpenSession: (sessionId: string) => Promise<void>,
  ensureSaved: (sessionIds: readonly string[]) => Promise<void>,
  openSessionIds: readonly string[],
) {
  const queryKey = ["sessionReminders"] as const;
  const read = useQuery({ queryKey, queryFn: listReminders, refetchInterval: 30000 }, queryClient);
  const reminders = read.data ?? EMPTY_REMINDERS;
  const actions = useMutation({ mutationFn: async (action: () => Promise<void>) => action() }, queryClient);
  const nativeMutation = useMutation({ mutationFn: ({ name, args }: { name: string; args?: Record<string, unknown> }) => invoke(name, args) }, queryClient);
  const command = useCallback(<T,>(name: string, args?: Record<string, unknown>) => nativeMutation.mutateAsync({ name, args }) as Promise<T>, [nativeMutation.mutateAsync]);
  const [now, setNow] = useState(Date.now);
  const [error, setError] = useState<string | null>(null);
  const [, refreshPolicy] = useReducer((revision: number) => revision + 1, 0);
  const configurationRevision = useRef(0);
  const configurationQueue = useRef<Promise<void>>(Promise.resolve());
  const remindersRef = useRef(reminders);
  remindersRef.current = reminders;
  const callbacks = useRef({ onOpenSession, ensureSaved });
  callbacks.current = { onOpenSession, ensureSaved };

  const configure = useCallback(async () => {
    const request = ++configurationRevision.current;
    // Native preferences are global state. Keep writes ordered and skip queued
    // snapshots superseded by another window event or a newer project policy.
    const pending = configurationQueue.current
      .catch(() => {})
      .then(async () => {
        if (request !== configurationRevision.current) return;
        await command("reminder_configure", {
          preferences: {
            notificationsEnabled: loadNotificationsEnabled(),
            sound: loadSoundsEnabled(),
            projectRules: Object.fromEntries(
              remindersRef.current.flatMap((reminder) => {
                const project = knownNotificationProject(reminder.cwd);
                return project
                  ? [
                      [
                        reminder.sessionId,
                        getProjectNotificationRule(project.id, "reminders"),
                      ],
                    ]
                  : [];
              }),
            ),
          },
        });
      });
    configurationQueue.current = pending;
    try {
      await pending;
    } catch (error) {
      if (request === configurationRevision.current) throw error;
    }
  }, [command]);

  useEffect(() => {
    if (!read.data) return;
    remindersRef.current = read.data; setNow(Date.now());
    void configure().catch(error => setError(String(error)));
  }, [read.dataUpdatedAt, configure]);
  const refresh = useCallback(async () => {
    await invalidateAfterChange(["sessionReminders"]);
    const items = queryClient.getQueryData<SessionReminder[]>(["sessionReminders"]);
    if (items) { remindersRef.current = items; setNow(Date.now()); setError(null); await configure(); }
  }, [configure]);

  const report = (error: unknown) => {
    toast.error(String(error));
  };

  const schedule = useCallback(
    async (ids: readonly string[], dueAt: number) => {
      try {
        await actions.mutateAsync(async () => {
          await callbacks.current.ensureSaved(ids);
          await setReminders(ids, dueAt);
          await refresh();
        });
      } catch (error) {
        report(error);
      }
    },
    [refresh],
  );

  const cancel = useCallback(
    async (ids: readonly string[], expectedDueAt?: number) => {
      try {
        await actions.mutateAsync(async () => {
          await clearReminders(ids, expectedDueAt);
          await refresh();
        });
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
        await actions.mutateAsync(async () => {
          await callbacks.current.onOpenSession(reminder.sessionId);
          // An old notification must never clear a newer reminder for this session.
          await clearReminders([reminder.sessionId], reminder.dueAt);
          await refresh();
        });
      } catch (error) {
        report(error);
      }
    },
    [refresh],
  );

  useEffect(() => {
    let disposed = false;
    const subscriptions: Array<() => void> = [];
    const configureCurrent = () => {
      refreshPolicy();
      void configure().catch((error) => {
        if (!disposed) setError(String(error));
      });
    };
    const takeOpen = async () => {
      if (disposed) return;
      try {
        const request = await command<ReminderTarget | null>(
          "reminder_take_open",
        );
        if (request && !disposed) await openHere(request);
      } catch (error) {
        if (!disposed) setError(String(error));
      }
    };
    const subscribe = async (event: string, handler: () => void) => {
      const unlisten = await listen(event, handler);
      if (disposed) unlisten();
      else subscriptions.push(unlisten);
    };
    void (async () => {
      try {
        await Promise.all([
          subscribe(REMINDERS_CHANGED, () => {
            void refresh();
          }),
          subscribe(REMINDER_OPEN, () => {
            void takeOpen();
          }),
        ]);
        if (disposed) return;
        await takeOpen();
      } catch (error) {
        if (!disposed) setError(String(error));
      }
    })();
    const onFocus = () => {
      void takeOpen();
    };
    const onVisible = () => {
      if (!document.hidden) onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(NOTIFICATIONS_CHANGE_EVENT, configureCurrent);
    window.addEventListener(SOUNDS_CHANGE_EVENT, configureCurrent);
    window.addEventListener("storage", configureCurrent);
    const unsubscribePreferences =
      subscribeNotificationPreferences(configureCurrent);
    return () => {
      disposed = true;
      unsubscribePreferences();
      configurationRevision.current++;
      subscriptions.forEach((unlisten) => unlisten());
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(NOTIFICATIONS_CHANGE_EVENT, configureCurrent);
      window.removeEventListener(SOUNDS_CHANGE_EVENT, configureCurrent);
      window.removeEventListener("storage", configureCurrent);
    };
  }, [openHere, refresh, configure]);

  const sessionIdsKey = JSON.stringify(openSessionIds);
  useEffect(() => {
    void command("reminder_register_window", {
      sessionIds: JSON.parse(sessionIdsKey),
    }).catch((error) => setError(String(error)));
  }, [sessionIdsKey]);

  const open = useCallback(async (reminder: ReminderTarget) => {
    try {
      await command("reminder_open", {
        sessionId: reminder.sessionId,
        dueAt: reminder.dueAt,
      });
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
    error: error ?? (read.error ? String(read.error) : null),
    refresh,
    schedule,
    cancel,
    dismissDue,
    open,
  };
}
