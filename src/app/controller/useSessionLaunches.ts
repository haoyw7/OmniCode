import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { type AppSessionPlacement } from "../../features/agent-app/model/agentApp";
import { claimInboxAutomationRuns } from "../../features/automations/model/automationEvents";
import {
  claimDueAutomations,
  recoverAutomationRuns,
  updateAutomationRun,
  type Automation,
  type AutomationRun,
} from "../../features/automations/model/automations";
import type { RecentProject } from "../../features/projects/model/recents";
import { sameProjectPath } from "../../features/projects/model/recents";
import { useQuickComposerLaunches } from "../../features/quick-composer/hooks/useQuickComposerLaunches";
import type { QuickLaunch } from "../../features/quick-composer/model/quickComposer";
import {
  HARNESS_LABEL,
  formatSessionTitle,
  newSession,
  sessionExecutionCwd,
  type Attachment,
  type LinkedWorkItem,
  type Session,
} from "../../features/sessions/model/session";
import { linkedWorkItemFromAutomationEvent } from "../../features/sessions/model/sessionWorkItem";
import { type SidebarTabId } from "../../features/settings/model/appearance";
import {
  leafIds,
  newTab,
  splitPane,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";
import { pathKey } from "../../shared/lib/paths";
import { submitWithSettlement } from "../model/managedSubmission";
import { acceptQuickLaunch } from "../model/quickLaunchSession";
import type { Submit } from "./workspaceTypes";

type Options = {
  sessionsRef: RefObject<Session[]>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  appendTab: (tab: WorkspaceTab, cwd?: string | undefined) => void;
  setActiveTabId: (id: string) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  focusOpenSession: (sessionId: string) => boolean;
  setSidebarTab: (tab: SidebarTabId, project?: string | undefined) => void;
  submitSession: Submit;
  tabsRef: RefObject<WorkspaceTab[]>;
  setTabs: Dispatch<SetStateAction<WorkspaceTab[]>>;
  setProjectCwd: Dispatch<SetStateAction<string>>;
  setRecents: Dispatch<SetStateAction<RecentProject[]>>;
  onSaveDraft: (
    sessionId: string,
    text: string,
    attachments?: Attachment[],
    appRequestId?: string | undefined,
  ) => boolean;
};

export function useSessionLaunches({
  sessionsRef,
  setSessions,
  appendTab,
  setActiveTabId,
  setComposerFocused,
  focusOpenSession,
  setSidebarTab,
  submitSession,
  tabsRef,
  setTabs,
  setProjectCwd,
  setRecents,
  onSaveDraft,
}: Options) {
  const automationSessionReservations = useRef(new Set<string>());

  const automationRecoveryRef = useRef<Promise<void> | null>(null);

  const automationRecoveryCutoffRef = useRef(Date.now());

  const launchAutomation = useCallback(
    async (
      automation: Automation,
      run: AutomationRun,
      reveal = false,
      prompt = run.prompt ?? automation.prompt,
      sourceWorkItem?: LinkedWorkItem,
    ) => {
      let reservationId: string | undefined;
      let releaseAfterSettle = false;
      const releaseReservation = () => {
        if (!reservationId) return;
        automationSessionReservations.current.delete(reservationId);
        reservationId = undefined;
      };
      try {
        const eventRun = run.trigger === "event";
        const linkedWorkItem =
          sourceWorkItem ?? linkedWorkItemFromAutomationEvent(run);
        let session =
          automation.reuseSession && automation.lastSessionId
            ? sessionsRef.current.find(
                (entry) =>
                  entry.id === automation.lastSessionId &&
                  entry.harness === automation.harness &&
                  !entry.busy &&
                  !entry.worktreeRemoved &&
                  !automationSessionReservations.current.has(entry.id) &&
                  (automation.workspaceMode === "current"
                    ? entry.workspaceMode !== "worktree" &&
                      pathKey(sessionExecutionCwd(entry)) === pathKey(automation.cwd)
                    : automation.workspaceMode === "existing"
                      ? pathKey(sessionExecutionCwd(entry)) ===
                        pathKey(automation.executionCwd ?? "")
                      : false),
              )
            : undefined;

        if (!session) {
          session = {
            ...newSession(
              automation.harness,
              automation.cwd,
              automation.model,
              automation.runtimeMode,
              automation.modelSettings,
            ),
            title: eventRun
              ? HARNESS_LABEL[automation.harness]
              : formatSessionTitle(automation.harness, automation.name),
            titleState: {
              source: eventRun ? ("placeholder" as const) : ("manual" as const),
              epoch: 0,
              purpose: "initial" as const,
              fallbackAttempted: false,
            },
            automationId: automation.id,
            ...(linkedWorkItem ? { linkedWorkItem } : {}),
            ...(automation.workspaceMode === "worktree"
              ? { workspaceMode: "worktree" as const, worktreeBase: "HEAD" }
              : automation.workspaceMode === "existing" &&
                  automation.executionCwd
                ? { executionCwd: automation.executionCwd }
                : {}),
          };
          const nextSessions = [...sessionsRef.current, session];
          sessionsRef.current = nextSessions;
          setSessions(nextSessions);
          const tab = newTab(session.id);
          appendTab(tab, automation.cwd);
          if (reveal) {
            setActiveTabId(tab.id);
            setComposerFocused(false);
          }
        } else {
          const stamped = {
            ...session,
            automationId: automation.id,
            model: automation.model,
            modelSettings: automation.modelSettings ?? {},
            runtimeMode: automation.runtimeMode,
            ...(linkedWorkItem ? { linkedWorkItem } : {}),
          };
          session = stamped;
          const nextSessions = sessionsRef.current.map((entry) =>
            entry.id === stamped.id ? stamped : entry,
          );
          sessionsRef.current = nextSessions;
          setSessions(nextSessions);
          if (reveal) {
            focusOpenSession(session.id);
          }
        }

        reservationId = session.id;
        automationSessionReservations.current.add(session.id);

        if (reveal) {
          setSidebarTab("sessions", session.cwd);
        }

        await updateAutomationRun(run.id, "running", {
          sessionId: session.id,
        });
        // From here the settlement callback owns reservation cleanup, including
        // a rejected submission that never starts an agent turn.
        releaseAfterSettle = true;
        await submitWithSettlement({
          submit: (onSettled) =>
            submitSession(session.id, prompt, [], {
              refreshTitle: eventRun,
              onSettled,
            }),
          rejectionMessage:
            "The selected agent session could not start this run.",
          onSettled: (outcome) => {
            const status =
              outcome.status === "completed"
                ? "succeeded"
                : outcome.status === "cancelled"
                  ? "cancelled"
                  : "failed";
            void updateAutomationRun(run.id, status, {
              sessionId: session.id,
              ...(outcome.error ? { error: outcome.error } : {}),
            })
              .catch(() => undefined)
              .finally(releaseReservation);
          },
        });
      } catch (reason: unknown) {
        await updateAutomationRun(run.id, "failed", {
          error: reason instanceof Error ? reason.message : String(reason),
        }).catch(() => undefined);
        throw reason;
      } finally {
        if (!releaseAfterSettle) releaseReservation();
      }
    },
    [appendTab, focusOpenSession, submitSession],
  );

  const launchQuickSession = useCallback(
    (
      launch: QuickLaunch,
      deliveryId: string,
      placement?: AppSessionPlacement,
    ) =>
      acceptQuickLaunch(
        launch,
        deliveryId,
        {
          getSessions: () => sessionsRef.current,
          updateSessions: (update) => {
            sessionsRef.current = update(sessionsRef.current);
            // Compose with submission's queued transcript updates.
            setSessions(update);
          },
          appendTab,
          placeSession: (sessionId, target, cwd) => {
            const anchor = sessionsRef.current.find(
              (session) => session.id === target.besideSessionId,
            );
            const tab = tabsRef.current.find((entry) =>
              leafIds(entry.layout).includes(target.besideSessionId),
            );
            if (!anchor || !sameProjectPath(anchor.cwd, cwd) || !tab)
              throw new Error(
                "The target session must be open in this project",
              );
            const nextTabs = tabsRef.current.map((entry) =>
              entry.id === tab.id
                ? {
                    ...entry,
                    layout: splitPane(
                      entry.layout,
                      target.besideSessionId,
                      target.direction,
                      sessionId,
                    ),
                    focusedId: launch.reveal ? sessionId : entry.focusedId,
                    diffFocused: launch.reveal ? false : entry.diffFocused,
                  }
                : entry,
            );
            tabsRef.current = nextTabs;
            setTabs(nextTabs);
            return tab.id;
          },
          setProjectCwd,
          setRecents,
          revealTab: (id, cwd) => {
            setActiveTabId(id);
            setComposerFocused(false);
            setSidebarTab("sessions", cwd);
          },
          submit: submitSession,
          saveDraft: (id, prompt, attachments, requestId) =>
            flushSync(() => onSaveDraft(id, prompt, attachments, requestId)),
        },
        placement,
      ),
    [appendTab, submitSession, onSaveDraft],
  );

  useQuickComposerLaunches(launchQuickSession);

  const ensureAutomationRecovery = useCallback(() => {
    if (!automationRecoveryRef.current) {
      const recovery = (async () => {
        const pending = await recoverAutomationRuns(
          automationRecoveryCutoffRef.current,
        );
        for (const item of pending) {
          await launchAutomation(
            item.automation,
            item.run,
            false,
            item.run.prompt ?? item.automation.prompt,
          ).catch(() => undefined);
        }
      })();
      automationRecoveryRef.current = recovery.catch((error: unknown) => {
        automationRecoveryRef.current = null;
        throw error;
      });
    }
    return automationRecoveryRef.current;
  }, [launchAutomation]);

  useEffect(() => {
    let disposed = false;
    let evaluating = false;
    const evaluate = async () => {
      if (disposed || evaluating) return;
      evaluating = true;
      try {
        await ensureAutomationRecovery();
        const due = await claimDueAutomations();
        for (const item of due) {
          if (disposed) break;
          void launchAutomation(item.automation, item.run).catch(
            () => undefined,
          );
        }
      } catch {
        // Scheduling retries on the next tick; individual claimed runs record
        // launch failures in launchAutomation.
      } finally {
        evaluating = false;
      }
    };
    void evaluate();
    const timer = window.setInterval(() => void evaluate(), 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void evaluate();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ensureAutomationRecovery, launchAutomation]);

  const onInboxAppeared = useCallback(
    (items: Parameters<typeof claimInboxAutomationRuns>[0]) => {
      void ensureAutomationRecovery()
        .then(() => claimInboxAutomationRuns(items))
        .then((due) => {
          for (const item of due) {
            void launchAutomation(
              item.automation,
              item.run,
              false,
              item.prompt,
              item.linkedWorkItem,
            ).catch(() => undefined);
          }
        })
        .catch(() => undefined);
    },
    [ensureAutomationRecovery, launchAutomation],
  );
  return { launchQuickSession, onInboxAppeared, launchAutomation };
}
