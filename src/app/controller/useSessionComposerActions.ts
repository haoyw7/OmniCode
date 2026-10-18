import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback } from "react";
import { sessionUsesHost } from "../../features/connections/model/remoteProjects";
import { remoteSessionActions } from "../../features/connections/model/remoteSessionActions";
import {
  discardDraftSessionRecord,
  shouldPersistSession,
} from "../../features/sessions/data/sessionStore";
import {
  selectComposerConfiguration,
  sessionComposerConfiguration,
} from "../../features/sessions/model/composerConfiguration";
import {
  isPreparingHandoff,
  planComposerSwitch,
} from "../../features/sessions/model/handoff";
import {
  preferredModelSettings,
  resolveModel,
  saveLastModelSettings,
  saveRecentModelChoice,
} from "../../features/sessions/model/models";
import {
  HARNESS_LABEL,
  canReplaceSessionTitle,
  removeSessionDraft,
  sessionDraftBlock,
  titleFromPrompt,
  type Attachment,
  type HarnessId,
  type RuntimeMode,
  type Session,
} from "../../features/sessions/model/session";
import { forgetHarnessSession } from "../../integrations/harness";
import { withHarnessChoice } from "../model/sessionTransforms";
import type { WorkspaceSessionData } from "../model/workspaceSessionData";

type Options = {
  sessionData: Pick<WorkspaceSessionData, "forget">;
  sessionsRef: RefObject<Session[]>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
};

export function useSessionComposerActions({
  sessionData,
  sessionsRef,
  setSessions,
}: Options) {
  const onModelChange = useCallback(
    (sessionId: string, harness: HarnessId, model: string) => {
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      if (!current) return;
      if (isPreparingHandoff(current)) return;
      const resolved = resolveModel(harness, model);
      saveRecentModelChoice(resolved.harness, resolved.id);
      const configuration = sessionComposerConfiguration(current);
      saveLastModelSettings(configuration.modelSettings, "fill");
      const modelSettings = preferredModelSettings(
        resolved,
        configuration.modelSettings,
      );
      const plan = planComposerSwitch(current, harness);
      if (plan.kind === "empty") {
        void forgetHarnessSession(plan.forget, sessionId);
      }
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const selected = selectComposerConfiguration(s, {
            harness,
            model: resolved.id,
            modelSettings,
            runtimeMode: configuration.runtimeMode,
          });
          if (selected.pendingConfiguration) return selected;
          const next = withHarnessChoice(
            { ...s, runtimeMode: configuration.runtimeMode },
            harness,
            resolved.id,
            modelSettings,
          );
          if (plan.kind === "arm") {
            return { ...next, pendingSwitch: plan.pending };
          }
          if (plan.kind === "revert") {
            return {
              ...next,
              pendingSwitch: undefined,
              ...(plan.restoreProviderSessionId
                ? { providerSessionId: plan.restoreProviderSessionId }
                : { providerSessionId: undefined }),
              ...(plan.restoreProviderAccountId
                ? { providerAccountId: plan.restoreProviderAccountId }
                : { providerAccountId: undefined }),
            };
          }
          if (plan.kind === "empty") {
            return { ...next, pendingSwitch: undefined };
          }
          return next;
        }),
      );
    },
    [],
  );

  const onModelSettingsChange = useCallback(
    (sessionId: string, modelSettings: Record<string, string>) => {
      saveLastModelSettings(modelSettings);
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? selectComposerConfiguration(s, {
                ...sessionComposerConfiguration(s),
                modelSettings,
              })
            : s,
        ),
      );
    },
    [],
  );

  const onRuntimeModeChange = useCallback(
    (sessionId: string, runtimeMode: RuntimeMode) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? selectComposerConfiguration(s, {
                ...sessionComposerConfiguration(s),
                runtimeMode,
              })
            : s,
        ),
      );
    },
    [],
  );

  const onSaveDraft = useCallback(
    (
      sessionId: string,
      text: string,
      attachments: Attachment[] = [],
      appRequestId?: string,
    ) => {
      const current = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (current && sessionUsesHost(current))
        return !!remoteSessionActions(sessionId)?.saveDraft(text, attachments);
      if (
        !current ||
        current.busy ||
        sessionDraftBlock(current) ||
        current.inboxAsk ||
        current.worktreeRemoved ||
        (!text.trim() && attachments.length === 0)
      ) {
        return false;
      }
      const placeholderTitle = canReplaceSessionTitle(
        current.title,
        current.harness,
        HARNESS_LABEL[current.harness],
      );
      const title = placeholderTitle
        ? titleFromPrompt(text, current.harness, attachments)
        : current.title;
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId && !sessionDraftBlock(session)
            ? {
                ...session,
                title,
                blocks: [
                  ...session.blocks,
                  {
                    id: crypto.randomUUID(),
                    role: "user",
                    text,
                    ...(attachments.length > 0 ? { attachments } : {}),
                    draft: true,
                    startedAt: Date.now(),
                    ...(appRequestId ? { appRequestId } : {}),
                  },
                ],
              }
            : session,
        ),
      );
      return true;
    },
    [],
  );

  const onRemoveDraft = useCallback(
    (sessionId: string, draftBlockId: string) => {
      const current = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (!current) return false;
      const withoutDraft = removeSessionDraft(current, draftBlockId);
      if (!withoutDraft) return false;

      if (!shouldPersistSession(withoutDraft)) {
        sessionData.forget(sessionId);
        void discardDraftSessionRecord(sessionId).catch(() => undefined);
      }

      setSessions((sessions) =>
        sessions.map((session) =>
          session.id === sessionId
            ? (removeSessionDraft(session, draftBlockId) ?? session)
            : session,
        ),
      );
      return true;
    },
    [sessionData],
  );
  return {
    onSaveDraft,
    onModelChange,
    onModelSettingsChange,
    onRuntimeModeChange,
    onRemoveDraft,
  };
}
