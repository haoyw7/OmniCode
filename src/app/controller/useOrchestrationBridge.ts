import { invoke } from "@tauri-apps/api/core";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import {
  orchestrationCheckoutCwd,
  orchestrationProjectCwd,
  orchestrator,
  workspaceIdentity,
} from "../../features/orchestration/model/orchestration";
import { sameProjectPath } from "../../features/projects/model/recents";
import {
  flushSessionWrites,
  getSession,
  shouldPersistSession,
  upsertSession,
  type SessionSummary,
} from "../../features/sessions/data/sessionStore";
import {
  applySessionCheckpoint,
  flushSessionCheckpoint,
  forgetSessionCheckpoint,
  notifyReviewChanged,
  sessionCheckpointCleanupSafe,
} from "../../features/sessions/model/checkpoint";
import { sessionChildHarnesses } from "../../features/sessions/model/handoff";
import {
  mergeModelSettings,
  modelsFor,
  resolveModel,
} from "../../features/sessions/model/models";
import {
  HARNESSES,
  newSession,
  sessionExecutionCwd,
  type Session,
} from "../../features/sessions/model/session";
import {
  createOrchestrationWorktree,
  detachSessionWorktree,
  listWorktrees,
  orchestrationWorktreeBranchName,
  removeOrchestrationBranch,
  removeOrchestrationWorktree,
} from "../../features/source-control/model/worktrees";
import {
  appendSteerUser,
  bindHarnessSession,
  canSteerHarness,
  forgetHarnessSession,
  isLiveHarness,
  respondHarnessApproval,
  respondHarnessQuestion,
  steerHarnessTurn,
  stopHarnessSession,
} from "../../integrations/harness";
import { isHarnessAvailable } from "../../integrations/harness/core/availability";
import { pathKey } from "../../shared/lib/paths";
import { submitWithSettlement } from "../model/managedSubmission";
import { type SubmissionAcceptance } from "../model/submissionAcceptance";
import type { WorkspaceSessionData } from "../model/workspaceSessionData";
import type { Submit } from "./workspaceTypes";

type Options = {
  sessionData: Pick<WorkspaceSessionData, "updateSummaries">;
  sessionsRef: RefObject<Session[]>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  onStop: (sessionId: string, managed?: boolean) => void;
  checkOpenWorktreeFiles: (path: string) => void;
  submitSession: Submit;
  flushHarnessEvents: () => void;
};

export function useOrchestrationBridge({
  sessionData,
  sessionsRef,
  setSessions,
  onStop,
  checkOpenWorktreeFiles,
  submitSession,
  flushHarnessEvents,
}: Options) {
  useLayoutEffect(() => {
    orchestrator.bind({
      session: (id) => sessionsRef.current.find((session) => session.id === id),
      sessions: () => sessionsRef.current,
      choices: () =>
        HARNESSES.filter(isHarnessAvailable).map((harness) => ({
          harness,
          models: modelsFor(harness).map(({ id, name }) => ({ id, name })),
        })),
      createWorker: async (run, task) => {
        const projectCwd = orchestrationProjectCwd(run);
        const leadCheckoutCwd = orchestrationCheckoutCwd(run);
        const lead = sessionsRef.current.find(
          (session) => session.id === run.leadId,
        );
        if (!lead) throw new Error("Lead session is unavailable");
        const workspace =
          task.workspacePolicy === "shared"
            ? workspaceIdentity(projectCwd, leadCheckoutCwd)
            : task.workspace
              ? await listWorktrees(leadCheckoutCwd).then((listed) => {
                  const tree = listed.worktrees.find(
                    (entry) =>
                      pathKey(entry.path) ===
                      pathKey(task.workspace!.checkoutCwd),
                  );
                  if (!tree)
                    throw new Error(
                      "This worker's retained worktree is missing. Its saved changes cannot be retried automatically.",
                    );
                  return workspaceIdentity(
                    projectCwd,
                    tree.path,
                    tree.branch ?? task.workspace!.branch,
                  );
                })
              : await createOrchestrationWorktree(
                  leadCheckoutCwd,
                  orchestrationWorktreeBranchName(task.id),
                ).then((tree) =>
                  workspaceIdentity(
                    projectCwd,
                    tree.path,
                    tree.branch ?? undefined,
                  ),
                );
        const checkoutCwd = workspace.checkoutCwd;
        const scratchDir = await invoke<string>("control_attach_worker", {
          leadId: run.leadId,
          sessionId: task.sessionId,
        });
        const existing = sessionsRef.current.find(
          (session) => session.id === task.sessionId,
        );
        if (existing) {
          if (
            existing.harness !== task.harness ||
            existing.model !== task.model ||
            !sameProjectPath(existing.cwd, projectCwd) ||
            (!existing.worktreeRemoved &&
              !sameProjectPath(sessionExecutionCwd(existing), checkoutCwd))
          )
            throw new Error(
              "This worker's configuration changed. Restore its approved harness, model and project before retrying.",
            );
          // The lead's runtime mode governs its agents, including across a
          // change mid-run: auto stays auto, supervised asks the lead.
          const synced = {
            ...existing,
            cwd: projectCwd,
            executionCwd: checkoutCwd,
            branch: workspace.branch,
            worktreeRemoved: false,
            runtimeMode: lead.runtimeMode,
            orchestrationLeadId: run.leadId,
          };
          await upsertSession(synced);
          const next = sessionsRef.current.map((session) =>
            session.id === synced.id ? synced : session,
          );
          sessionsRef.current = next;
          setSessions(next);
          return { scratchDir, workspace };
        }
        const restored = await getSession(task.sessionId);
        if (
          restored &&
          (restored.harness !== task.harness || restored.model !== task.model)
        )
          throw new Error(
            "The saved worker no longer matches its approved model. Create a new assignment.",
          );
        const fresh = {
          ...newSession(task.harness, projectCwd, task.model, lead.runtimeMode),
          executionCwd: checkoutCwd,
          branch: workspace.branch,
          ...(task.modelSettings
            ? {
                modelSettings: mergeModelSettings(
                  resolveModel(task.harness, task.model),
                  task.modelSettings,
                ),
              }
            : {}),
        };
        const base = restored
          ? {
              ...restored,
              busy: false,
              cwd: projectCwd,
              executionCwd: checkoutCwd,
              branch: workspace.branch,
              worktreeRemoved: false,
              runtimeMode: lead.runtimeMode,
            }
          : {
              ...fresh,
              id: task.sessionId,
              title: task.title,
            };
        const worker = { ...base, orchestrationLeadId: run.leadId };
        if (worker.providerSessionId)
          bindHarnessSession(
            worker.harness,
            worker.id,
            worker.providerSessionId,
            sessionExecutionCwd(worker),
            worker.providerAccountId,
            worker.blocks,
            worker.nativeSession,
          );
        await upsertSession(worker);
        const next = [...sessionsRef.current, worker];
        sessionsRef.current = next;
        setSessions(next);
        // Workers belong to the lead's agent panel; no workspace tab is created.
        return { scratchDir, workspace };
      },
      integrateWorker: async (run, task) => {
        const fromCwd = task.workspace?.checkoutCwd;
        if (!fromCwd)
          throw new Error("This worker's isolated checkout is unavailable");
        const session = sessionsRef.current.find(
          (entry) => entry.id === task.sessionId,
        );
        if (session)
          await Promise.all(
            sessionChildHarnesses(session).map((harness) =>
              stopHarnessSession(harness, task.sessionId),
            ),
          );
        await invoke("harness_kill", { sessionId: task.sessionId });
        await invoke("control_turn_finished", { sessionId: task.sessionId });
        await flushSessionCheckpoint(task.sessionId);
        const listed = await listWorktrees(orchestrationCheckoutCwd(run));
        const workerTree = listed.worktrees.find((tree) =>
          sameProjectPath(tree.path, fromCwd),
        );
        const leadTree = listed.worktrees.find((tree) =>
          sameProjectPath(tree.path, orchestrationCheckoutCwd(run)),
        );
        if (!workerTree || !leadTree)
          throw new Error(
            "The worker or lead checkout is no longer registered. The worker worktree was kept.",
          );
        if (workerTree.head !== leadTree.head)
          throw new Error(
            "The worker or lead branch moved while this task was running. The worker worktree was kept for manual review.",
          );
        return applySessionCheckpoint(
          task.sessionId,
          fromCwd,
          orchestrationCheckoutCwd(run),
        );
      },
      cleanupWorker: async (run, task, onlyIfUnchanged) => {
        const workspace = task.workspace;
        if (!workspace || workspace.kind !== "worktree") return true;
        const path = workspace.checkoutCwd;
        await flushSessionCheckpoint(task.sessionId);
        const listed = await listWorktrees(orchestrationCheckoutCwd(run));
        const exists = listed.worktrees.some(
          (tree) => pathKey(tree.path) === pathKey(path),
        );
        if (!exists && onlyIfUnchanged) return false;
        const workerTree = listed.worktrees.find(
          (tree) => pathKey(tree.path) === pathKey(path),
        );
        const leadTree = listed.worktrees.find((tree) =>
          sameProjectPath(tree.path, orchestrationCheckoutCwd(run)),
        );
        if (
          exists &&
          (!workerTree || !leadTree || workerTree.head !== leadTree.head)
        ) {
          if (onlyIfUnchanged) return false;
          throw new Error(
            "The worker or lead branch moved before cleanup. The worker worktree was kept for manual review.",
          );
        }
        if (onlyIfUnchanged) {
          const safe = await sessionCheckpointCleanupSafe(task.sessionId, path);
          if (!safe) return false;
        } else if (exists) {
          // Re-verify immediately before destructive cleanup. The operation is
          // idempotent, so this also finishes a partially applied integration.
          await applySessionCheckpoint(
            task.sessionId,
            path,
            orchestrationCheckoutCwd(run),
          );
        }

        if (exists) {
          onStop(task.sessionId, true);
          const session = sessionsRef.current.find(
            (entry) => entry.id === task.sessionId,
          );
          if (session) {
            await Promise.all(
              sessionChildHarnesses(session).map((harness) =>
                stopHarnessSession(harness, task.sessionId),
              ),
            );
          }
          await invoke("harness_kill", { sessionId: task.sessionId });
          await invoke("control_turn_finished", {
            sessionId: task.sessionId,
          });
          await flushSessionWrites();
          checkOpenWorktreeFiles(path);
          const removed = await removeOrchestrationWorktree(
            orchestrationCheckoutCwd(run),
            path,
          );
          const affected = new Set([task.sessionId, ...removed.sessionIds]);
          sessionsRef.current = sessionsRef.current.map((session) =>
            affected.has(session.id)
              ? detachSessionWorktree(session, removed.projectCwd, path)
              : session,
          );
          setSessions(sessionsRef.current);
          const detachSummary = (entry: SessionSummary) =>
            affected.has(entry.id)
              ? detachSessionWorktree(entry, removed.projectCwd, path)
              : entry;
          sessionData.updateSummaries(detachSummary);
          if (session)
            await Promise.allSettled(
              sessionChildHarnesses(session).map((harness) =>
                forgetHarnessSession(harness, task.sessionId),
              ),
            );
        } else {
          const detached = sessionsRef.current.find(
            (entry) => entry.id === task.sessionId,
          );
          if (detached && !detached.worktreeRemoved) {
            const next = detachSessionWorktree(
              detached,
              orchestrationProjectCwd(run),
              path,
            );
            sessionsRef.current = sessionsRef.current.map((entry) =>
              entry.id === task.sessionId ? next : entry,
            );
            setSessions(sessionsRef.current);
            if (shouldPersistSession(next)) await upsertSession(next);
          }
        }
        if (workspace.branch)
          await removeOrchestrationBranch(
            orchestrationCheckoutCwd(run),
            workspace.branch,
          );
        await forgetSessionCheckpoint(task.sessionId);
        notifyReviewChanged(task.sessionId);
        return true;
      },
      submit: (id, text, done) => {
        void submitWithSettlement({
          submit: (onSettled) => {
            let acceptance: SubmissionAcceptance = false;
            // Commit an immediate turn before another scheduler update. A
            // deferred submission flushes its own turn after synchronization.
            flushSync(() => {
              acceptance = submitSession(id, text, [], {
                managed: true,
                onSettled,
              });
            });
            return acceptance;
          },
          onSettled: done,
          rejectionMessage:
            "The selected agent session could not accept this turn.",
        }).catch(console.error);
      },
      steer: async (id, text) => {
        flushHarnessEvents();
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (!session) throw new Error("This agent is no longer available");
        if (!session.busy)
          throw new Error(
            "This agent is not running a turn; send it a fresh one with message.",
          );
        if (
          !isLiveHarness(session.harness) ||
          !canSteerHarness(session.harness)
        )
          throw new Error(
            `${session.harness} cannot take guidance mid-turn. Wait for the turn to finish, then use message.`,
          );
        // Record it on the worker before dispatch, so its own transcript shows
        // why it changed course even if the harness call then fails.
        const next = sessionsRef.current.map((entry) =>
          entry.id === id ? appendSteerUser(entry, text) : entry,
        );
        sessionsRef.current = next;
        setSessions(next);
        await steerHarnessTurn({
          harness: session.harness,
          sessionId: id,
          cwd: sessionExecutionCwd(session),
          model: session.model,
          modelSettings: session.modelSettings,
          text,
        });
      },
      respondApproval: (id, requestId, decision) => {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (session)
          respondHarnessApproval(session.harness, id, requestId, decision);
      },
      answerQuestion: (id, requestId, reply) => {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (session)
          respondHarnessQuestion(session.harness, id, requestId, reply);
      },
      stop: async (id) => {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        onStop(id, true);
        try {
          if (session)
            await Promise.all(
              sessionChildHarnesses(session).map((harness) =>
                stopHarnessSession(harness, id),
              ),
            );
        } finally {
          // Also reap processes left behind by a renderer reload, before the
          // corresponding session has been restored in this window.
          await invoke("harness_kill", { sessionId: id });
          await invoke("control_turn_finished", { sessionId: id });
        }
      },
    });
  }, [checkOpenWorktreeFiles, submitSession, onStop, flushHarnessEvents]);
}
