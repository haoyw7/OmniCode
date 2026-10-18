import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useEffect, useRef } from "react";
import {
  applyBtwHarnessEvent,
  btwTurnHarness,
  buildBtwPrompt,
  replaceBtwThread,
  sealBtwResponseBlocks,
  supportsBtwHarness,
} from "../../features/sessions/model/btw";
import {
  nativeModelId,
  preferredModelSettings,
  resolveModel,
} from "../../features/sessions/model/models";
import { harnessForTurn } from "../../features/sessions/model/secondOpinion";
import {
  HARNESS_TITLE,
  sessionExecutionCwd,
  type Block,
  type BtwThread,
  type HarnessId,
  type Session,
} from "../../features/sessions/model/session";
import {
  runHarnessTextPrompt,
  stopHarnessTextPrompts,
} from "../../integrations/harness";

type Options = {
  sessions: Session[];
  sessionsRef: RefObject<Session[]>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  persistSession: (session: Session | undefined) => void;
};

export function useBtwConversations({
  sessions,
  sessionsRef,
  setSessions,
  persistSession,
}: Options) {
  const btwRequestsRef = useRef(
    new Map<string, { sessionId: string; controller: AbortController }>(),
  );

  useEffect(() => {
    const liveSessionIds = new Set(sessions.map((session) => session.id));
    for (const [key, request] of btwRequestsRef.current) {
      if (liveSessionIds.has(request.sessionId)) continue;
      request.controller.abort();
      btwRequestsRef.current.delete(key);
    }
  }, [sessions]);

  useEffect(
    () => () => {
      for (const request of btwRequestsRef.current.values()) {
        request.controller.abort();
      }
      btwRequestsRef.current.clear();
      void stopHarnessTextPrompts();
    },
    [],
  );

  const updateBtwThread = useCallback(
    (
      sessionId: string,
      userBlockId: string,
      threadId: string,
      update: (thread: BtwThread | undefined) => BtwThread | undefined,
    ): Session | undefined => {
      const previous = sessionsRef.current;
      let updatedSession: Session | undefined;
      const next = previous.map((session) => {
        if (session.id !== sessionId) return session;
        const blockIndex = session.blocks.findIndex(
          (block) => block.id === userBlockId && block.role === "user",
        );
        if (blockIndex < 0) return session;
        const block = session.blocks[blockIndex];
        const current = block.btwThreads?.find(
          (thread) => thread.id === threadId,
        );
        const nextThread = update(current);
        if (!nextThread) return session;
        const nextBlock = current
          ? replaceBtwThread(block, nextThread)
          : {
              ...block,
              btwThreads: [...(block.btwThreads ?? []), nextThread],
            };
        const blocks = session.blocks.slice();
        blocks[blockIndex] = nextBlock;
        updatedSession = { ...session, blocks };
        return updatedSession;
      });
      if (!updatedSession) return undefined;
      sessionsRef.current = next;
      setSessions(next);
      persistSession(updatedSession);
      return updatedSession;
    },
    [persistSession],
  );

  const removeBtwThread = useCallback(
    (
      sessionId: string,
      userBlockId: string,
      threadId: string,
    ): Session | undefined => {
      const previous = sessionsRef.current;
      let updatedSession: Session | undefined;
      const next = previous.map((session) => {
        if (session.id !== sessionId) return session;
        const blockIndex = session.blocks.findIndex(
          (block) => block.id === userBlockId && block.role === "user",
        );
        if (blockIndex < 0) return session;
        const block = session.blocks[blockIndex];
        const threads = block.btwThreads ?? [];
        if (!threads.some((thread) => thread.id === threadId)) return session;
        const nextThreads = threads.filter((thread) => thread.id !== threadId);
        const nextBlock = {
          ...block,
          btwThreads: nextThreads.length > 0 ? nextThreads : undefined,
        };
        const blocks = session.blocks.slice();
        blocks[blockIndex] = nextBlock;
        updatedSession = { ...session, blocks };
        return updatedSession;
      });
      if (!updatedSession) return undefined;
      sessionsRef.current = next;
      setSessions(next);
      persistSession(updatedSession);
      return updatedSession;
    },
    [persistSession],
  );

  const runBtwRequest = useCallback(
    (input: {
      sessionId: string;
      userBlockId: string;
      source: Session;
      thread: BtwThread;
      harness: HarnessId;
    }) => {
      const harness = input.harness;
      if (!supportsBtwHarness(harness)) return;
      const cwd = sessionExecutionCwd(input.source);
      const model = nativeModelId(
        input.thread.model ?? input.source.model,
      ).trim();
      if (!cwd || cwd === "~") {
        updateBtwThread(
          input.sessionId,
          input.userBlockId,
          input.thread.id,
          (thread) =>
            thread
              ? {
                  ...thread,
                  status: "error",
                  updatedAt: Date.now(),
                  error:
                    "A project working directory is required for this question.",
                }
              : undefined,
        );
        return;
      }
      if (!model && harness === "codex") {
        updateBtwThread(
          input.sessionId,
          input.userBlockId,
          input.thread.id,
          (thread) =>
            thread
              ? {
                  ...thread,
                  status: "error",
                  updatedAt: Date.now(),
                  error: "The selected Codex model is unavailable.",
                }
              : undefined,
        );
        return;
      }

      let prompt: string;
      try {
        prompt = buildBtwPrompt({
          blocks: input.source.blocks,
          thread: input.thread,
          cwd,
        });
      } catch (error) {
        updateBtwThread(
          input.sessionId,
          input.userBlockId,
          input.thread.id,
          (thread) =>
            thread
              ? {
                  ...thread,
                  status: "error",
                  updatedAt: Date.now(),
                  error:
                    error instanceof Error
                      ? error.message
                      : "The completed turn is no longer available.",
                }
              : undefined,
        );
        return;
      }

      const key = `${input.sessionId}:${input.thread.id}`;
      btwRequestsRef.current.get(key)?.controller.abort();
      const controller = new AbortController();
      btwRequestsRef.current.set(key, {
        sessionId: input.sessionId,
        controller,
      });

      const userMessageId =
        input.thread.messages[input.thread.messages.length - 1]?.id ??
        input.thread.id;
      const responseModel = model || input.source.model;

      void runHarnessTextPrompt({
        harness,
        cwd,
        providerAccountId: input.source.providerAccountId,
        model: model || undefined,
        modelSettings: input.thread.modelSettings ?? input.source.modelSettings,
        ephemeral: false,
        threadId: input.thread.providerThreadId,
        onThreadId: (providerThreadId) => {
          if (controller.signal.aborted) return;
          updateBtwThread(
            input.sessionId,
            input.userBlockId,
            input.thread.id,
            (thread) =>
              thread && thread.providerThreadId !== providerThreadId
                ? {
                    ...thread,
                    providerThreadId,
                    updatedAt: Date.now(),
                  }
                : thread,
          );
        },
        onEvent: (event) => {
          if (controller.signal.aborted) return;
          updateBtwThread(
            input.sessionId,
            input.userBlockId,
            input.thread.id,
            (thread) =>
              thread?.status === "running"
                ? {
                    ...thread,
                    updatedAt: Date.now(),
                    pendingBlocks: applyBtwHarnessEvent(
                      thread.pendingBlocks ?? [],
                      event,
                      harness,
                      responseModel,
                      userMessageId,
                    ),
                  }
                : undefined,
          );
        },
        intent: "plan",
        prompt,
        signal: controller.signal,
      })
        .then((output) => {
          if (controller.signal.aborted) return;
          const text = output.trim();
          if (!text) {
            throw new Error(
              `${HARNESS_TITLE[harness]} returned an empty side answer.`,
            );
          }
          updateBtwThread(
            input.sessionId,
            input.userBlockId,
            input.thread.id,
            (thread) => {
              if (!thread) return undefined;
              const pendingBlocks = thread.pendingBlocks ?? [];
              const blocks =
                pendingBlocks.length > 0
                  ? sealBtwResponseBlocks(
                      pendingBlocks,
                      harness,
                      responseModel,
                      userMessageId,
                    )
                  : undefined;
              return {
                ...thread,
                status: "ready",
                updatedAt: Date.now(),
                pendingBlocks: undefined,
                messages: [
                  ...thread.messages,
                  {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    text,
                    createdAt: Date.now(),
                    ...(blocks?.length ? { blocks } : {}),
                  },
                ],
                error: undefined,
              };
            },
          );
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const message =
            error instanceof Error
              ? error.message
              : `${HARNESS_TITLE[harness]} could not answer this side question.`;
          updateBtwThread(
            input.sessionId,
            input.userBlockId,
            input.thread.id,
            (thread) =>
              thread
                ? {
                    ...thread,
                    status: "error",
                    updatedAt: Date.now(),
                    pendingBlocks: undefined,
                    error: message,
                  }
                : undefined,
          );
        })
        .finally(() => {
          if (btwRequestsRef.current.get(key)?.controller === controller) {
            btwRequestsRef.current.delete(key);
          }
        });
    },
    [updateBtwThread],
  );

  const onBtwSubmit = useCallback(
    (
      sessionId: string,
      turn: Block[],
      threadId: string,
      messageId: string,
      text: string,
      model?: string,
      modelSettings?: Record<string, string>,
    ) => {
      const source = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      const sourceUserId = turn.find((block) => block.role === "user")?.id;
      const sourceEndBlockId = turn[turn.length - 1]?.id;
      const turnHarness = source
        ? harnessForTurn(source.blocks, turn, source.harness)
        : undefined;
      const turnModel = turn.find((block) => block.role === "user")?.turnModel
        ?.id;
      const sourceBlockEarly = source?.blocks.find(
        (block) => block.id === sourceUserId && block.role === "user",
      );
      const existingEarly = sourceBlockEarly?.btwThreads?.find(
        (thread) => thread.id === threadId,
      );
      const requestHarness = source
        ? supportsBtwHarness(turnHarness)
          ? turnHarness
          : (existingEarly?.harness ??
            btwTurnHarness(source.blocks, turn, source.harness))
        : undefined;
      if (
        !source ||
        !supportsBtwHarness(requestHarness) ||
        source.worktreeRemoved ||
        !sourceUserId ||
        !sourceEndBlockId
      ) {
        return false;
      }
      const sourceBlock = sourceBlockEarly;
      if (!sourceBlock) return false;
      const existing = existingEarly;
      const selectedModel =
        model?.trim() ||
        existing?.model ||
        turnModel ||
        nativeModelId(source.model).trim();
      const selectedModelSettings =
        modelSettings ??
        existing?.modelSettings ??
        preferredModelSettings(
          resolveModel(requestHarness!, selectedModel || source.model),
          source.modelSettings,
        );
      if (existing?.status === "running") return false;
      if (existing && existing.sourceEndBlockId !== sourceEndBlockId) {
        return false;
      }
      const now = Date.now();
      const thread: BtwThread = existing
        ? {
            ...existing,
            harness: existing.harness ?? turnHarness,
            model: selectedModel || undefined,
            modelSettings: selectedModelSettings,
            status: "running",
            updatedAt: now,
            error: undefined,
            pendingBlocks: [],
            messages: [
              ...existing.messages,
              { id: messageId, role: "user", text, createdAt: now },
            ],
          }
        : {
            id: threadId,
            sourceEndBlockId,
            createdAt: now,
            updatedAt: now,
            status: "running",
            pendingBlocks: [],
            harness: requestHarness,
            ...(selectedModel ? { model: selectedModel } : {}),
            modelSettings: selectedModelSettings,
            messages: [{ id: messageId, role: "user", text, createdAt: now }],
          };
      const updated = updateBtwThread(
        sessionId,
        sourceUserId,
        threadId,
        () => thread,
      );
      if (!updated) return false;
      runBtwRequest({
        sessionId,
        userBlockId: sourceUserId,
        source,
        thread,
        harness: thread.harness ?? requestHarness!,
      });
      return true;
    },
    [runBtwRequest, updateBtwThread],
  );

  const onBtwModelChange = useCallback(
    (
      sessionId: string,
      turn: Block[],
      threadId: string,
      model: string,
      modelSettings: Record<string, string>,
    ) => {
      const source = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      const sourceUserId = turn.find((block) => block.role === "user")?.id;
      const turnHarness = source
        ? harnessForTurn(source.blocks, turn, source.harness)
        : undefined;
      const nextModel = model.trim();
      const sourceBlock = source?.blocks.find(
        (block) => block.id === sourceUserId && block.role === "user",
      );
      const threadHarness = source
        ? (sourceBlock?.btwThreads?.find((thread) => thread.id === threadId)
            ?.harness ??
          btwTurnHarness(source.blocks, turn, source.harness) ??
          turnHarness)
        : undefined;
      if (
        !source ||
        !supportsBtwHarness(threadHarness) ||
        source.worktreeRemoved ||
        !sourceUserId ||
        !nextModel
      ) {
        return;
      }
      updateBtwThread(sessionId, sourceUserId, threadId, (thread) =>
        thread
          ? {
              ...thread,
              model: nextModel,
              modelSettings,
              updatedAt: Date.now(),
            }
          : undefined,
      );
    },
    [updateBtwThread],
  );

  const onBtwDelete = useCallback(
    (sessionId: string, turn: Block[], threadId: string) => {
      const source = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      const sourceUserId = turn.find((block) => block.role === "user")?.id;
      const turnHarness = source
        ? harnessForTurn(source.blocks, turn, source.harness)
        : undefined;
      const sourceBlock = source?.blocks.find(
        (block) => block.id === sourceUserId && block.role === "user",
      );
      const threadHarness = source
        ? (sourceBlock?.btwThreads?.find((thread) => thread.id === threadId)
            ?.harness ??
          btwTurnHarness(source.blocks, turn, source.harness) ??
          turnHarness)
        : undefined;
      if (
        !source ||
        !supportsBtwHarness(threadHarness) ||
        source.worktreeRemoved ||
        !sourceUserId
      ) {
        return;
      }
      const requestKey = `${sessionId}:${threadId}`;
      btwRequestsRef.current.get(requestKey)?.controller.abort();
      btwRequestsRef.current.delete(requestKey);
      removeBtwThread(sessionId, sourceUserId, threadId);
    },
    [removeBtwThread],
  );

  // Stopping keeps whatever the side answer had streamed, like stopping a
  // main turn, and leaves the thread ready for the next question.
  const onBtwStop = useCallback(
    (sessionId: string, turn: Block[], threadId: string) => {
      const sourceUserId = turn.find((block) => block.role === "user")?.id;
      if (!sourceUserId) return;
      const key = `${sessionId}:${threadId}`;
      btwRequestsRef.current.get(key)?.controller.abort();
      btwRequestsRef.current.delete(key);
      updateBtwThread(sessionId, sourceUserId, threadId, (thread) => {
        if (!thread || thread.status !== "running") return thread;
        const harness = thread.harness;
        const userMessageId =
          thread.messages[thread.messages.length - 1]?.id ?? thread.id;
        const pending = thread.pendingBlocks ?? [];
        const blocks =
          pending.length > 0 && harness
            ? sealBtwResponseBlocks(
                pending,
                harness,
                thread.model ?? "",
                userMessageId,
              )
            : [];
        const text = blocks
          .filter((block) => block.role === "assistant")
          .map((block) => block.text)
          .join("\n\n")
          .trim();
        const now = Date.now();
        return {
          ...thread,
          status: "ready",
          updatedAt: now,
          pendingBlocks: undefined,
          error: undefined,
          messages: blocks.length
            ? [
                ...thread.messages,
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  text,
                  createdAt: now,
                  blocks,
                },
              ]
            : thread.messages,
        };
      });
    },
    [updateBtwThread],
  );

  const onBtwRetry = useCallback(
    (sessionId: string, turn: Block[], threadId: string) => {
      const source = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      const sourceUserId = turn.find((block) => block.role === "user")?.id;
      const turnHarness = source
        ? harnessForTurn(source.blocks, turn, source.harness)
        : undefined;
      const sourceBlock = source?.blocks.find(
        (block) => block.id === sourceUserId && block.role === "user",
      );
      const existing = sourceBlock?.btwThreads?.find(
        (thread) => thread.id === threadId,
      );
      const threadHarness = source
        ? (existing?.harness ??
          btwTurnHarness(source.blocks, turn, source.harness) ??
          turnHarness)
        : undefined;
      if (
        !source ||
        !supportsBtwHarness(threadHarness) ||
        source.worktreeRemoved ||
        !sourceUserId
      ) {
        return;
      }
      if (!sourceBlock || !existing || existing.status !== "error") return;
      const thread: BtwThread = {
        ...existing,
        status: "running",
        updatedAt: Date.now(),
        error: undefined,
        pendingBlocks: [],
      };
      const updated = updateBtwThread(
        sessionId,
        sourceUserId,
        threadId,
        () => thread,
      );
      if (!updated) return;
      runBtwRequest({
        sessionId,
        userBlockId: sourceUserId,
        source: updated,
        thread,
        harness: thread.harness ?? threadHarness!,
      });
    },
    [runBtwRequest, updateBtwThread],
  );
  return { onBtwSubmit, onBtwRetry, onBtwDelete, onBtwStop, onBtwModelChange };
}
