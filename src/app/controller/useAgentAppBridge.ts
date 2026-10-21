import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import {
  handleAgentApp,
  type AppSessionListing,
  type AppSessionPlacement,
} from "../../features/agent-app/model/agentApp";
import { upsertNote } from "../../features/notes";
import { orchestrator } from "../../features/orchestration/model/orchestration";
import { sameProjectPath } from "../../features/projects/model/recents";
import type { QuickLaunch } from "../../features/quick-composer/model/quickComposer";
import {
  getSession,
  listSessionsByProject,
} from "../../features/sessions/data/sessionStore";
import {
  sessionDraftBlock,
  type Attachment,
  type Session,
} from "../../features/sessions/model/session";
import {
  createWorktree,
  listWorktrees,
} from "../../features/source-control/model/worktrees";
import type { Submit } from "./workspaceTypes";

type Options = {
  launchQuickSession: (
    launch: QuickLaunch,
    deliveryId: string,
    placement?: AppSessionPlacement | undefined,
  ) => Promise<void>;
  submitSession: Submit;
  onSaveDraft: (
    sessionId: string,
    text: string,
    attachments?: Attachment[],
    appRequestId?: string | undefined,
  ) => boolean;
  ensureOpenSession: (sessionId: string) => Promise<Session | null>;
  sessionsRef: RefObject<Session[]>;
};

export function useAgentAppBridge({
  launchQuickSession,
  submitSession,
  onSaveDraft,
  ensureOpenSession,
  sessionsRef,
}: Options) {
  const launchQuickSessionRef = useRef(launchQuickSession);

  launchQuickSessionRef.current = launchQuickSession;

  const submitSessionRef = useRef(submitSession);

  submitSessionRef.current = submitSession;

  const saveDraftRef = useRef(onSaveDraft);

  saveDraftRef.current = onSaveDraft;

  const ensureOpenSessionRef = useRef(ensureOpenSession);

  ensureOpenSessionRef.current = ensureOpenSession;

  const appReceipts = useRef(
    new Map<string, { signature: string; promise: Promise<unknown> }>(),
  );

  useEffect(() => {
    const listening = listen<{
      id: string;
      namespace: string;
      sessionId: string;
      requestId: string;
      action: string;
      input: Record<string, unknown>;
    }>("omnicode-control-request", ({ payload }) => {
      const handle = async () => {
        if (payload.namespace === "control") {
          return orchestrator.handle(
            payload.sessionId,
            payload.requestId,
            payload.action,
            payload.input,
          );
        }
        if (payload.namespace !== "app")
          throw new Error("Unknown CLI namespace");
        const source = sessionsRef.current.find(
          (session) => session.id === payload.sessionId,
        );
        if (
          !source ||
          source.inboxAsk ||
          source.orchestrationLeadId ||
          orchestrator.run(source.id)
        )
          throw new Error("This session cannot use the OmniCode app CLI");
        const key = `${source.id}:${payload.requestId}`;
        const signature = JSON.stringify([payload.action, payload.input]);
        const previous = appReceipts.current.get(key);
        if (previous) {
          if (previous.signature !== signature)
            throw new Error("Request ID was already used with different input");
          return previous.promise;
        }
        const promise = handleAgentApp(
          source,
          payload.requestId,
          payload.action,
          payload.input,
          {
            start: async (launch, id, placement) => {
              const open = sessionsRef.current.find(
                (session) => session.id === id,
              );
              const stored = open ? null : await getSession(id);
              const existing = open ?? stored;
              const previous = existing?.blocks.find(
                (block) => block.appRequestId === id,
              );
              if (previous) {
                if (
                  previous.text !== launch.prompt ||
                  (!launch.draft && !!previous.draft)
                )
                  throw new Error(
                    "Request ID was already used for another session launch",
                  );
                return;
              }
              if (
                existing?.blocks.some(
                  (block) => block.role === "user" && !block.draft,
                )
              )
                return;
              if (existing && sessionDraftBlock(existing))
                throw new Error("Session ID already has a different draft");
              await launchQuickSessionRef.current(launch, id, placement);
            },
            sessions: async (cwd): Promise<AppSessionListing[]> => {
              const stored = await listSessionsByProject(cwd);
              const byId = new Map<string, AppSessionListing>();
              for (const session of stored) {
                if (session.orchestrationLeadId) continue;
                byId.set(session.id, {
                  id: session.id,
                  title: session.title,
                  harness: session.harness,
                  model: session.model,
                  busy: false,
                  hasDraft: !!session.draft,
                });
              }
              for (const session of sessionsRef.current) {
                if (
                  session.orchestrationLeadId ||
                  !sameProjectPath(session.cwd, cwd)
                )
                  continue;
                byId.set(session.id, {
                  id: session.id,
                  title: session.title,
                  harness: session.harness,
                  model: session.model,
                  busy: !!session.busy,
                  hasDraft: !!sessionDraftBlock(session),
                });
              }
              return [...byId.values()];
            },
            session: async (id) => {
              const target =
                sessionsRef.current.find((session) => session.id === id) ??
                (await getSession(id));
              return target &&
                !target.orchestrationLeadId &&
                sameProjectPath(target.cwd, source.cwd)
                ? target
                : null;
            },
            send: async (id, prompt, requestId) => {
              const target = await ensureOpenSessionRef.current(id);
              if (
                !target ||
                target.orchestrationLeadId ||
                !sameProjectPath(target.cwd, source.cwd) ||
                orchestrator.run(id)
              )
                throw new Error("Session is unavailable in this project");
              const previous = target.blocks.find(
                (block) => block.appRequestId === requestId,
              );
              if (previous) {
                if (previous.text !== prompt)
                  throw new Error(
                    "Request ID was already used with another prompt",
                  );
                if (previous.draft)
                  throw new Error("Request ID belongs to an unsent draft");
                return { alreadySubmitted: true };
              }
              if (target.busy)
                throw new Error("Session is busy; try again when it finishes");
              if (sessionDraftBlock(target))
                throw new Error(
                  "Session already has a draft; send or remove it first",
                );
              const accepted = await submitSessionRef.current(id, prompt, [], {
                appRequestId: requestId,
              });
              if (!accepted)
                throw new Error("Session could not accept the follow-up");
              return { alreadySubmitted: false };
            },
            draft: async (id, prompt, requestId) => {
              const target = await ensureOpenSessionRef.current(id);
              if (
                !target ||
                target.orchestrationLeadId ||
                !sameProjectPath(target.cwd, source.cwd) ||
                orchestrator.run(id)
              )
                throw new Error("Session is unavailable in this project");
              const previous = target.blocks.find(
                (block) => block.appRequestId === requestId,
              );
              if (previous) {
                if (previous.text !== prompt)
                  throw new Error(
                    "Request ID was already used with another prompt",
                  );
                return { alreadySaved: true, draft: !!previous.draft };
              }
              if (target.busy)
                throw new Error("Session is busy; try again when it finishes");
              if (sessionDraftBlock(target))
                throw new Error(
                  "Session already has a draft; send or remove it first",
                );
              const saved = flushSync(() =>
                saveDraftRef.current(id, prompt, [], requestId),
              );
              if (!saved) throw new Error("Session could not accept a draft");
              return { alreadySaved: false, draft: true };
            },
            worktrees: (cwd) => listWorktrees(cwd),
            createWorktree: (cwd, branch, base, existing) =>
              createWorktree(cwd, branch, base, existing),
            notes: () => invoke("notes_list"),
            note: (id) => invoke("notes_get", { id }),
            saveNote: upsertNote,
          },
        );
        appReceipts.current.set(key, { signature, promise });
        void promise.catch(() => {
          if (appReceipts.current.get(key)?.promise === promise)
            appReceipts.current.delete(key);
        });
        if (appReceipts.current.size > 256) {
          const first = appReceipts.current.keys().next().value;
          if (first) appReceipts.current.delete(first);
        }
        return promise;
      };
      void handle()
        .then(
          (result) =>
            invoke("control_reply", {
              id: payload.id,
              response: { ok: true, result },
            }),
          (error: unknown) =>
            invoke("control_reply", {
              id: payload.id,
              response: {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              },
            }),
        )
        .catch(console.error);
    });
    return () => {
      void listening.then((unlisten) => unlisten());
    };
  }, []);
}
