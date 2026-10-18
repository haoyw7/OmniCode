import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { sessionUsesHost } from "../../features/connections/model/remoteProjects";
import { buildRemotePlan } from "../../features/connections/model/remoteSessionActions";
import { exhaustedWindowResetAt } from "../../features/providers/model/rateLimits";
import {
  fetchClaudeRateLimits,
  fetchCodexRateLimits,
} from "../../features/providers/model/rateLimitsFetch";
import { CONTINUE_PROMPT } from "../../features/sessions/model/inFlight";
import {
  canDispatchQueuedHead,
  dequeueQueuedMessage,
  queuedMessageForSubmit,
} from "../../features/sessions/model/messageQueue";
import { saveLastModelSettings } from "../../features/sessions/model/models";
import {
  type PlanBuildTarget,
  type Session,
  type UsageLimit,
} from "../../features/sessions/model/session";
import {
  USAGE_LIMIT_RESUME_GRACE_MS,
  usageLimitResumeDue,
} from "../../features/sessions/model/usageLimit";
import type { HarnessEvent } from "../../integrations/harness";
import type { Submit } from "./workspaceTypes";

type Options = {
  setSessions: Dispatch<SetStateAction<Session[]>>;
  sessionsRef: RefObject<Session[]>;
  onSubmit: (...args: Parameters<Submit>) => boolean;
  sessions: Session[];
  enqueueHarnessEvent: (sessionId: string, event: HarnessEvent) => void;
  flushHarnessEvents: () => void;
};

export function useSessionTurnActions({
  setSessions,
  sessionsRef,
  onSubmit,
  sessions,
  enqueueHarnessEvent,
  flushHarnessEvents,
}: Options) {
  const queueDispatchingRef = useRef(new Set<string>());

  const usageResumingRef = useRef(new Set<string>());

  const usageResetLookups = useRef(new WeakSet<UsageLimit>());

  const onUpdatePlan = useCallback(
    (sessionId: string, blockId: string, text: string) => {
      setSessions((prev) =>
        prev.map((session) => {
          if (sessionUsesHost(session)) return session;
          if (session.id !== sessionId || session.busy) return session;
          return {
            ...session,
            blocks: session.blocks.map((block) => {
              if (
                block.id !== blockId ||
                block.role !== "plan" ||
                block.plan?.status === "streaming" ||
                block.plan?.status === "building" ||
                block.plan?.status === "built"
              ) {
                return block;
              }
              const originalText = block.plan?.originalText ?? block.text;
              return {
                ...block,
                text,
                plan: {
                  ...(block.plan ?? { status: "ready" as const }),
                  status: "ready" as const,
                  originalText,
                  edited: text !== originalText,
                },
              };
            }),
          };
        }),
      );
    },
    [],
  );

  const onBuildPlan = useCallback(
    (sessionId: string, blockId: string, target?: PlanBuildTarget) => {
      const session = sessionsRef.current.find(
        (entry) => entry.id === sessionId,
      );
      if (session && sessionUsesHost(session)) {
        buildRemotePlan(sessionId, blockId, target);
        return;
      }
      const block = session?.blocks.find((entry) => entry.id === blockId);
      if (
        !session ||
        session.busy ||
        block?.role !== "plan" ||
        !!block.orchestration ||
        !block.text.trim() ||
        block.plan?.status === "streaming" ||
        block.plan?.status === "building" ||
        block.plan?.status === "built"
      ) {
        return;
      }
      if (target && session.modelSettings) {
        saveLastModelSettings(session.modelSettings, "fill");
      }
      onSubmit(sessionId, "Build approved plan", [], {
        intent: "build",
        planBlockId: blockId,
        buildTarget: target,
      });
    },
    [onSubmit],
  );

  useEffect(() => {
    const timers: number[] = [];
    const scheduled = new Set<string>();
    for (const session of sessions) {
      // The Host owns these queues, including native conversations in local projects.
      if (sessionUsesHost(session)) continue;
      const queued = session.queuedMessages ?? [];
      if (session.busy || queued.length === 0) continue;

      if (session.queueStatus === "resuming") {
        setSessions((prev) =>
          prev.map((entry) =>
            entry.id === session.id
              ? { ...entry, queueStatus: "active" }
              : entry,
          ),
        );
        continue;
      }
      if (
        !canDispatchQueuedHead(session) ||
        queueDispatchingRef.current.has(session.id)
      ) {
        continue;
      }

      const next = queued[0];
      if (!next) continue;
      queueDispatchingRef.current.add(session.id);
      scheduled.add(session.id);
      timers.push(
        window.setTimeout(() => {
          queueDispatchingRef.current.delete(session.id);
          const latest = sessionsRef.current.find(
            (entry) => entry.id === session.id,
          );
          const head = latest?.queuedMessages?.[0];
          if (
            !latest ||
            !head ||
            head.id !== next.id ||
            !canDispatchQueuedHead(latest)
          ) {
            return;
          }
          onSubmit(session.id, head.text, head.attachments, {
            queuedMessageId: head.id,
            noteCard: head.noteCard,
            handoffCard: head.handoffCard,
            intent: head.intent,
          });
        }, 0),
      );
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      for (const id of scheduled) queueDispatchingRef.current.delete(id);
    };
  }, [onSubmit, sessions]);

  const onDeleteQueuedMessage = useCallback(
    (sessionId: string, messageId: string) => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? dequeueQueuedMessage(session, messageId)
            : session,
        ),
      );
    },
    [],
  );

  const onQueuedMessageEditingChange = useCallback(
    (sessionId: string, messageId?: string) => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? { ...session, editingQueuedMessageId: messageId }
            : session,
        ),
      );
    },
    [],
  );

  const onEditQueuedMessage = useCallback(
    (sessionId: string, messageId: string, text: string) => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                queuedMessages: session.queuedMessages?.map((message) =>
                  message.id === messageId ? { ...message, text } : message,
                ),
                editingQueuedMessageId: undefined,
              }
            : session,
        ),
      );
    },
    [],
  );

  const onSteerQueuedMessage = useCallback(
    (sessionId: string, messageId: string) => {
      const session = sessionsRef.current.find(
        (entry) => entry.id === sessionId,
      );
      const message = session
        ? queuedMessageForSubmit(session, messageId, "steer")
        : undefined;
      if (!session || !message) return;
      if (message.intent === "orchestrate" && session.busy) {
        enqueueHarnessEvent(sessionId, {
          type: "status",
          text: "Orchestration planning will start after the current turn finishes.",
        });
        flushHarnessEvents();
        return;
      }
      onSubmit(sessionId, message.text, message.attachments, {
        followUpBehavior: "steer",
        queuedMessageId: message.id,
        noteCard: message.noteCard,
        handoffCard: message.handoffCard,
        intent: message.intent,
      });
    },
    [onSubmit, enqueueHarnessEvent, flushHarnessEvents],
  );

  const onResumeQueue = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find(
        (entry) => entry.id === sessionId,
      );
      if (
        !session ||
        session.busy ||
        session.queueStatus !== "paused" ||
        !session.queuedMessages?.length
      ) {
        return;
      }
      setSessions((prev) =>
        prev.map((entry) =>
          entry.id === sessionId
            ? { ...entry, queueStatus: "resuming" }
            : entry,
        ),
      );
      onSubmit(sessionId, CONTINUE_PROMPT, [], {
        followUpBehavior: "steer",
      });
    },
    [onSubmit],
  );

  const onUsageLimitDismiss = useCallback((sessionId: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId && session.usageLimit
          ? { ...session, usageLimit: undefined }
          : session,
      ),
    );
  }, []);

  const onUsageLimitResumeAtReset = useCallback(
    (sessionId: string, enabled: boolean) => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId && session.usageLimit
            ? {
                ...session,
                usageLimit: { ...session.usageLimit, resumeAtReset: enabled },
              }
            : session,
        ),
      );
    },
    [],
  );

  const onUsageLimitResume = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find(
        (entry) => entry.id === sessionId,
      );
      if (!session?.usageLimit || session.busy) return;
      onUsageLimitDismiss(sessionId);
      onSubmit(sessionId, CONTINUE_PROMPT);
    },
    [onSubmit, onUsageLimitDismiss],
  );

  const [usageLimitTick, setUsageLimitTick] = useState(0);

  useEffect(() => {
    const now = Date.now();
    const timers: number[] = [];
    const scheduled = new Set<string>();
    let nextCheck = Number.POSITIVE_INFINITY;
    for (const session of sessions) {
      const limit = session.usageLimit;
      if (!limit?.resumeAtReset || limit.resetsAt == null) continue;
      if (!usageLimitResumeDue(session, now)) {
        nextCheck = Math.min(
          nextCheck,
          limit.resetsAt + USAGE_LIMIT_RESUME_GRACE_MS - now,
        );
        continue;
      }
      if (usageResumingRef.current.has(session.id)) continue;
      usageResumingRef.current.add(session.id);
      scheduled.add(session.id);
      timers.push(
        window.setTimeout(() => {
          usageResumingRef.current.delete(session.id);
          const latest = sessionsRef.current.find(
            (entry) => entry.id === session.id,
          );
          if (latest && usageLimitResumeDue(latest, Date.now())) {
            onUsageLimitResume(session.id);
          }
        }, 0),
      );
    }
    if (Number.isFinite(nextCheck)) {
      // Re-check every minute at most: timers drift while the machine sleeps.
      timers.push(
        window.setTimeout(
          () => setUsageLimitTick((tick) => tick + 1),
          Math.max(1_000, Math.min(nextCheck, 60_000)),
        ),
      );
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      for (const id of scheduled) usageResumingRef.current.delete(id);
    };
  }, [onUsageLimitResume, sessions, usageLimitTick]);

  // The stream does not always say when the limit resets; ask the provider.
  useEffect(() => {
    for (const session of sessions) {
      const limit = session.usageLimit;
      if (!limit || limit.resetsAt != null) continue;
      if (usageResetLookups.current.has(limit)) continue;
      const fetchLimits =
        session.harness === "claude"
          ? fetchClaudeRateLimits
          : session.harness === "codex"
            ? fetchCodexRateLimits
            : undefined;
      if (!fetchLimits) continue;
      usageResetLookups.current.add(limit);
      void fetchLimits(session.providerAccountId).then((limits) => {
        const resetsAt = exhaustedWindowResetAt(limits);
        if (resetsAt == null) return;
        setSessions((prev) =>
          prev.map((entry) =>
            entry.id === session.id && entry.usageLimit === limit
              ? { ...entry, usageLimit: { ...limit, resetsAt } }
              : entry,
          ),
        );
      });
    }
  }, [sessions]);
  return {
    onDeleteQueuedMessage,
    onEditQueuedMessage,
    onQueuedMessageEditingChange,
    onSteerQueuedMessage,
    onResumeQueue,
    onUsageLimitResume,
    onUsageLimitResumeAtReset,
    onUsageLimitDismiss,
    onBuildPlan,
    onUpdatePlan,
  };
}
