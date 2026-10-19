import { applyAgentEvent } from "./agentTranscript";
import { agentTranscript, updateAgentTool } from "../../../features/sessions/model/agentTranscript";
import { applyNativeTitle } from "../../../features/sessions/model/titlePolicy";
import type {
  Attachment,
  Block,
  Session,
  TaskListItem,
  ToolPreview,
} from "../../../features/sessions/model/session";
import { mergeContextUsage } from "../../../features/sessions/model/contextUsage";
import { displayPath } from "../../../shared/lib/paths";
import {
  composeToolTitle,
  isFileTool,
  isWeakToolTitle,
  mergeToolPreview,
  stubFilePreview,
} from "./preview";
import { joinStreamText } from "./streamText";
import { taskListText } from "../../../features/sessions/model/taskList";
import { isReviewablePlan } from "../../../features/sessions/model/plan";
import { resolveModel } from "../../../features/sessions/model/models";
import { userTurnStartTimes } from "../../../features/sessions/model/turnTiming";
import type { HarnessEvent } from "./types";
import { questionTranscriptText } from "../../../features/sessions/model/questionHistory";

/** Apply one delivery batch without copying the transcript for every token. */
export function applyHarnessEvents(
  session: Session,
  events: readonly HarnessEvent[],
): Session {
  let next = session;
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (event.type !== "message.delta" && event.type !== "reasoning.delta") {
      next = applyHarnessEvent(next, event);
      continue;
    }
    const texts = [event.text];
    while (index + 1 < events.length) {
      const following = events[index + 1];
      if (following.type !== event.type) break;
      texts.push(following.text);
      index++;
    }
    next = patchStreaming(
      next,
      event.type === "message.delta" ? "assistant" : "reasoning",
      texts,
      true,
    );
  }
  return next;
}

export function applyHarnessEvent(
  session: Session,
  event: HarnessEvent,
): Session {
  switch (event.type) {
    case "session.titleRefreshRequested":
      return session;
    case "session.titleUpdated":
      return applyNativeTitle(session, event.providerSessionId, event.title);
    case "message.delta":
      return patchStreaming(session, "assistant", event.text, true);
    case "message.completed":
      return finishRole(session, "assistant");
    case "image.generated": {
      if (!("path" in event)) return session;
      if (!event.agentCallId) return appendImage(session, event);
      const blocks = updateAgentTool(session.blocks, event.agentCallId, (block) => {
        const rows = agentTranscript(block);
        const id = `${event.agentCallId}:image:${event.itemId}`;
        if (rows.some((row) => row.id === id)) return block;
        const transcript = appendImage({ ...session, blocks: rows }, event).blocks;
        if (transcript.length === rows.length) return block;
        transcript[transcript.length - 1] = { ...transcript[transcript.length - 1], id };
        return { ...block, agentRun: { name: block.text, steps: [], ...block.agentRun, transcript } };
      });
      return blocks === session.blocks ? session : { ...session, blocks };
    }
    case "reasoning.delta":
      return patchStreaming(session, "reasoning", event.text, true);
    case "reasoning.completed":
      return finishRole(session, "reasoning");
    case "tool.started":
      return upsertTool(session, {
        callId: event.callId,
        title: event.title,
        kind: event.kind,
        status: event.status,
        preview: event.preview,
        paths: event.paths,
        streaming: true,
        agentModel: event.agentModel,
        ...(event.background ? { background: true } : {}),
      });
    case "tool.updated":
      return upsertTool(session, {
        callId: event.callId,
        title: event.title,
        kind: event.kind,
        status: event.status,
        detail: event.detail,
        preview: event.preview,
        paths: event.paths,
        streaming: event.status !== "completed" && event.status !== "failed",
        agentModel: event.agentModel,
      });
    case "agent.step":
    case "agent.updated":
      return applyAgentEvent(session, event);
    case "approval.requested":
      return attachApproval(session, event);
    case "approval.resolved": {
      const blocks = session.blocks.map((block) =>
        block.approval?.requestId === event.requestId
          ? {
              ...block,
              approval: { ...block.approval, decided: event.decision },
            }
          : block,
      );
      return { ...session, blocks };
    }
    case "question.asked": {
      const prompt = {
          requestId: event.requestId,
          historyId: crypto.randomUUID(),
          questions: event.questions,
          ...(event.title ? { title: event.title } : {}),
          ...(event.allowLateReply ? { allowLateReply: true } : {}),
          ...(event.autoResolveAt != null
            ? { autoResolveAt: event.autoResolveAt }
            : {}),
      };
      return {
        ...appendBlock(session, {
          id: prompt.historyId, role: "system", question: prompt,
          text: questionTranscriptText(prompt),
        }),
        pendingQuestion: prompt,
      };
    }
    case "question.updated":
      return session.pendingQuestion?.requestId === event.requestId
        ? {
            ...session,
            pendingQuestion: {
              ...session.pendingQuestion,
              autoResolveAt: event.autoResolveAt,
            },
            blocks: session.blocks.map((block) =>
              block.id === session.pendingQuestion?.historyId && block.question
                ? { ...block, question: { ...block.question, autoResolveAt: event.autoResolveAt } }
                : block),
          }
        : session;
    case "question.resolved": {
      // The Host may clear the live prompt as soon as it accepts an answer.
      const historyId = session.pendingQuestion?.requestId === event.requestId
        ? session.pendingQuestion.historyId
        : [...session.blocks].reverse().find((block) =>
            block.question?.requestId === event.requestId && !block.question.decision)?.id;
      return {
        ...session,
        pendingQuestion: session.pendingQuestion?.requestId === event.requestId
          ? undefined : session.pendingQuestion,
        blocks: session.blocks.map((block) => {
          if (block.id !== historyId || !block.question) return block;
          const question = {
            ...block.question, decision: event.decision, autoResolveAt: undefined,
            ...(event.reply ? { reply: event.reply } : {}),
          };
          return { ...block, question, text: questionTranscriptText(question) };
        }),
      };
    }
    case "context": {
      const context = mergeContextUsage(session.context, event);
      return context.used === session.context?.used && context.window === session.context?.window &&
        context.breakdown === session.context?.breakdown
        ? session
        : { ...session, context };
    }
    case "turn.metrics":
      return mergeTurnMetrics(session, event);
    case "tasks.updated":
      return upsertTaskList(session, event);
    case "background.updated":
      if (event.tasks.length === 0) {
        if (!session.backgroundTasks) return session;
        const { backgroundTasks: _cleared, ...rest } = session;
        return rest;
      }
      return { ...session, backgroundTasks: event.tasks };
    case "plan":
      return upsertPlan(session, event);
    case "session.error":
      return appendBlock(failStreaming(session), {
        id: crypto.randomUUID(),
        role: "system",
        text: event.message,
        notice: "error",
      });
    case "session.providerBound":
      return { ...session, providerSessionId: event.providerSessionId,
        ...(session.nativeSession && (session.nativeSession.providerSessionId !== event.providerSessionId || session.nativeSession.provider !== session.harness)
          ? { nativeSession: undefined } : {}),
      };
    case "turn.started": {
      const index = lastMatchingBlock(
        session.blocks,
        (block) => block.role === "user",
      );
      if (index < 0) return session;
      const block = session.blocks[index];
      if (block.providerTurnId === event.providerTurnId) return session;
      const blocks = session.blocks.slice();
      blocks[index] = { ...block, providerTurnId: event.providerTurnId };
      return { ...session, blocks };
    }
    case "session.configChanged":
      return {
        ...session,
        ...(event.model ? { model: event.model } : {}),
        ...(event.modelSettingOptions
          ? { modelSettingOptions: event.modelSettingOptions }
          : event.model && event.model !== session.model ? { modelSettingOptions: undefined } : {}),
        ...(event.modelSettings
          ? {
              modelSettings: {
                ...session.modelSettings,
                ...event.modelSettings,
              },
            }
          : {}),
      };
    case "status":
      return event.key
        ? upsertKeyedStatus(session, event.key, event.text)
        : appendStatus(session, event.text);
    case "usage.limited":
      return {
        ...session,
        usageLimit: event.resetsAt != null ? { resetsAt: event.resetsAt } : {},
      };
    case "interjection":
      // A visible boundary the user must not miss, so unlike status it never
      // deduplicates and never reads as turn lifecycle.
      return appendBlock(session, {
        id: crypto.randomUUID(),
        role: "system",
        text: event.text,
        interjection: {
          customType: event.customType,
          ...(event.severity ? { severity: event.severity } : {}),
        },
      });
    default:
      return session;
  }
}

function mergeTurnMetrics(
  session: Session,
  event: Extract<HarnessEvent, { type: "turn.metrics" }>,
): Session {
  let userIndex = -1;
  for (let index = session.blocks.length - 1; index >= 0; index -= 1) {
    if (session.blocks[index].role === "user") {
      userIndex = index;
      break;
    }
  }
  if (userIndex < 0) return session;

  const current = session.blocks[userIndex];
  const metrics = {
    ...(current.turnMetrics ?? {}),
    ...(event.generationSample !== undefined ? { generationSample: event.generationSample } : {}),
    ...(event.inputTokens != null ? { inputTokens: event.inputTokens } : {}),
    ...(event.outputTokens != null ? { outputTokens: event.outputTokens } : {}),
    ...(event.cacheReadTokens != null
      ? { cacheReadTokens: event.cacheReadTokens }
      : {}),
    ...(event.cacheWriteTokens != null
      ? { cacheWriteTokens: event.cacheWriteTokens }
      : {}),
    ...(event.cacheHitPercent != null
      ? { cacheHitPercent: event.cacheHitPercent }
      : {}),
  };
  // Provider usage snapshots often repeat between text chunks. Preserve identity
  // so unchanged telemetry neither re-renders the transcript nor schedules a save.
  if (JSON.stringify(metrics) === JSON.stringify(current.turnMetrics ?? {})) return session;
  const blocks = session.blocks.slice();
  blocks[userIndex] = { ...current, turnMetrics: metrics };
  return { ...session, blocks };
}

function upsertPlan(
  session: Session,
  event: Extract<HarnessEvent, { type: "plan" }>,
): Session {
  const key = event.key?.trim() || undefined;
  const lastUser = lastMatchingBlock(
    session.blocks,
    (block) => block.role === "user",
  );
  const existing = lastMatchingBlock(session.blocks, (block, index) => {
    if (block.role !== "plan") return false;
    if (key) {
      return block.plan?.key === key || (!block.plan?.key && index > lastUser);
    }
    return index > lastUser;
  });
  const streaming = event.streaming ?? false;

  if (existing >= 0) {
    const current = session.blocks[existing];
    const text = event.append
      ? joinStreamText(current.text, event.text)
      : event.text || current.text;
    const blocks = session.blocks.slice();
    blocks[existing] = {
      ...current,
      text,
      streaming,
      startedAt: current.startedAt ?? current.sentAt ?? Date.now(),
      ...(text !== current.text ? { sentAt: Date.now() } : {}),
      plan: {
        ...(current.plan ?? { status: streaming ? "streaming" : "ready" }),
        ...(key ? { key } : {}),
        status: streaming ? "streaming" : "ready",
        ...(!streaming && text ? { originalText: text, edited: false } : {}),
      },
    };
    return { ...session, blocks };
  }

  if (!event.text) return session;
  return appendBlock(session, {
    id: crypto.randomUUID(),
    role: "plan",
    text: event.text,
    streaming,
    plan: {
      ...(key ? { key } : {}),
      status: streaming ? "streaming" : "ready",
      ...(!streaming ? { originalText: event.text } : {}),
    },
  });
}

function upsertTaskList(
  session: Session,
  event: Extract<HarnessEvent, { type: "tasks.updated" }>,
): Session {
  const key = event.key?.trim() || undefined;
  const lastUser = lastMatchingBlock(
    session.blocks,
    (block) => block.role === "user",
  );
  const existing = lastMatchingBlock(session.blocks, (block, index) => {
    if (block.role !== "tasks") return false;
    if (key) {
      if (block.taskList?.key !== key) return false;
      // A list from another provider conversation stays as history.
      return (
        !event.providerSessionId ||
        block.taskList?.providerSessionId === event.providerSessionId
      );
    }
    return index > lastUser;
  });
  const previousItems =
    existing >= 0 ? session.blocks[existing].taskList?.items : undefined;
  const items = previousItems
    ? event.merge
      ? mergeTaskListItems(previousItems, event.items)
      : event.authoritative
        ? event.items
        : preserveTaskListLabels(previousItems, event.items)
    : event.items;

  if (items.length === 0) {
    if (existing < 0) return session;
    return {
      ...session,
      blocks: session.blocks.filter((_, index) => index !== existing),
    };
  }

  const taskList = {
    ...(key ? { key } : {}),
    ...(event.providerSessionId ? { providerSessionId: event.providerSessionId } : {}),
    ...(event.explanation?.trim()
      ? { explanation: event.explanation.trim() }
      : {}),
    items,
  };
  const text = taskListText(items);
  if (existing >= 0) {
    const blocks = session.blocks.slice();
    blocks[existing] = {
      ...blocks[existing],
      text,
      taskList,
    };
    return { ...session, blocks };
  }

  return appendBlock(session, {
    id: crypto.randomUUID(),
    role: "tasks",
    text,
    taskList,
  });
}

function mergeTaskListItems(
  existing: TaskListItem[],
  updates: TaskListItem[],
): TaskListItem[] {
  if (updates.length === 0) return existing;
  const items = existing.slice();
  const indexById = new Map<string, number>();
  for (let index = 0; index < items.length; index += 1) {
    const id = items[index].id;
    if (id) indexById.set(id, index);
  }

  for (const update of updates) {
    const index = update.id
      ? (indexById.get(update.id) ??
        items.findIndex((item) => item.text === update.text))
      : items.findIndex((item) => item.text === update.text);
    if (index < 0) {
      items.push(update);
      if (update.id) indexById.set(update.id, items.length - 1);
      continue;
    }
    const current = items[index];
    items[index] = {
      ...(current.id || update.id ? { id: current.id ?? update.id } : {}),
      // A merge update changes state. Full snapshots remain responsible for
      // intentional task renames or reordered lists.
      text: current.text,
      status: update.status,
    };
  }
  return items;
}

function preserveTaskListLabels(
  existing: TaskListItem[],
  snapshot: TaskListItem[],
): TaskListItem[] {
  const existingById = new Map(
    existing.flatMap((item) => (item.id ? [[item.id, item] as const] : [])),
  );
  return snapshot.map((item) => {
    const previous = item.id ? existingById.get(item.id) : undefined;
    return previous && previous.text !== item.text
      ? { ...item, text: previous.text }
      : item;
  });
}

function lastMatchingBlock(
  blocks: Block[],
  predicate: (block: Block, index: number) => boolean,
): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (predicate(blocks[index], index)) return index;
  }
  return -1;
}

type UserTurnExtra = {
  checkpointTurnId?: string;
  secondOpinion?: Block["secondOpinion"];
  noteCard?: Block["noteCard"];
  ciContext?: string;
  internal?: boolean;
  omnicode?: boolean;
  intent?: Block["intent"];
  appRequestId?: string;
};

function userTurnFields(extra?: UserTurnExtra) {
  return {
    ...(extra?.checkpointTurnId ? { checkpointTurnId: extra.checkpointTurnId } : {}),
    ...(extra?.secondOpinion ? { secondOpinion: extra.secondOpinion } : {}),
    ...(extra?.noteCard ? { noteCard: extra.noteCard } : {}),
    ...(extra?.ciContext ? { ciContext: extra.ciContext } : {}),
    ...(extra?.internal ? { internal: true } : {}),
    ...(extra?.omnicode ? { omnicode: true } : {}),
    ...(extra?.intent ? { intent: extra.intent } : {}),
    ...(extra?.appRequestId ? { appRequestId: extra.appRequestId } : {}),
  };
}

function turnModelFields(session: Session) {
  const model = resolveModel(session.harness, session.model);
  return {
    turnModel: {
      harness: session.harness,
      id: session.model,
      name: model.name,
    },
  };
}

export function appendUser(
  session: Session,
  text: string,
  attachments: Attachment[] = [],
  extra?: UserTurnExtra,
): Session {
  session = settlePendingApprovals(session);
  return appendBlock(
    { ...session, busy: true },
    {
      id: crypto.randomUUID(),
      role: "user",
      text,
      startedAt: Date.now(),
      ...turnModelFields(session),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...userTurnFields(extra),
    },
  );
}

/** Append a follow-up user message during an active turn without sealing streams. */
export function appendSteerUser(
  session: Session,
  text: string,
  attachments: Attachment[] = [],
  extra?: UserTurnExtra,
): Session {
  return {
    ...session,
    busy: true,
    blocks: [
      ...session.blocks,
      {
        id: crypto.randomUUID(),
        role: "user",
        text,
        sentAt: Date.now(),
        ...turnModelFields(session),
        ...(attachments.length > 0 ? { attachments } : {}),
        ...userTurnFields(extra),
      },
    ],
  };
}

export function stopStreaming(session: Session, endedAt = Date.now()): Session {
  const { backgroundTasks: _cleared, ...settled } =
    settlePendingApprovals(session);
  return {
    ...settled,
    busy: false,
    pendingQuestion: undefined,
    blocks: stampTurnDuration(settled.blocks.map((block) => stopBlockProgress(
      block.question && !block.question.decision
        ? { ...block, question: { ...block.question, decision: "cancelled", autoResolveAt: undefined } }
        : block,
    )), endedAt),
  };
}

/**
 * Approval request ids are live only for the turn that produced them. Once
 * that turn has stopped (or a later turn is about to start), leaving one
 * undecided makes its old Allow/Deny controls and notification actionable
 * even though the harness can no longer receive the response.
 */
function settlePendingApprovals(session: Session): Session {
  let changed = false;
  const blocks = session.blocks.flatMap((block) => {
    if (!block.approval || block.approval.decided) return [block];
    changed = true;
    if (block.role === "approval") return [];
    const status = block.tool?.status?.toLowerCase() ?? "";
    const toolFinished =
      status === "completed" ||
      status === "success" ||
      status === "failed" ||
      status === "error" ||
      status === "cancelled" ||
      status === "canceled";
    return [
      {
        ...block,
        streaming: false,
        ...(block.tool && !toolFinished
          ? { tool: { ...block.tool, status: "cancelled" } }
          : {}),
        approval: { ...block.approval, decided: "cancelled" as const },
      },
    ];
  });
  return changed ? { ...session, blocks } : session;
}

/**
 * A terminal provider failure also settles work whose final tool event was
 * lost with the transport. Leaving those calls `in_progress` hides the real
 * failure behind a neutral completed-turn summary.
 */
function failStreaming(session: Session): Session {
  const openTools = new Set(
    session.blocks.flatMap((block) => {
      if (block.role !== "tool" && block.role !== "approval") return [];
      const status = block.tool?.status?.toLowerCase() ?? "";
      return block.streaming ||
        status === "in_progress" ||
        status === "pending" ||
        status === "running"
        ? [block.id]
        : [];
    }),
  );
  const stopped = stopStreaming(session);
  return {
    ...stopped,
    blocks: stopped.blocks.map((block) => {
      const open = openTools.has(block.id);
      const pendingApproval = !!block.approval && !block.approval.decided;
      if (!open && !pendingApproval) return block;
      return {
        ...block,
        streaming: false,
        ...(block.tool && open
          ? { tool: { ...block.tool, status: "failed" } }
          : {}),
        ...(block.approval && !block.approval.decided
          ? { approval: { ...block.approval, decided: "cancelled" as const } }
          : {}),
      };
    }),
  };
}

/**
 * Harnesses without a structured plan event return their plan as the final
 * assistant message. Convert only that final message after the turn has
 * actually ended; progress commentary earlier in the turn must stay normal
 * assistant text.
 */
export function promoteLastAssistantToPlan(
  session: Session,
  key?: string,
): Session {
  let lastUser = -1;
  for (let index = session.blocks.length - 1; index >= 0; index -= 1) {
    if (session.blocks[index].role === "user") {
      lastUser = index;
      break;
    }
  }

  if (
    session.blocks.some(
      (block, index) => index > lastUser && block.role === "plan",
    )
  ) {
    return session;
  }

  let assistant = -1;
  for (let index = session.blocks.length - 1; index > lastUser; index -= 1) {
    const block = session.blocks[index];
    if (block.role === "assistant" && block.text.trim()) {
      assistant = index;
      break;
    }
  }
  if (assistant < 0) return session;

  const blocks = session.blocks.slice();
  const block = blocks[assistant];
  if (!isReviewablePlan(block.text)) return session;
  blocks[assistant] = {
    ...block,
    role: "plan",
    streaming: false,
    plan: {
      ...(key ? { key } : {}),
      status: "ready",
      originalText: block.text,
      edited: false,
    },
  };
  return { ...session, blocks };
}

function stopBlockProgress(block: Block): Block {
  if (block.agentRun?.transcript) {
    const transcript = block.agentRun.transcript.map((child) => {
      const stopped = stopBlockProgress(child);
      if (stopped.tool && ["in_progress", "pending", "running"].includes(stopped.tool.status ?? ""))
        return { ...stopped, tool: { ...stopped.tool, status: "cancelled" } };
      return stopped;
    });
    if (transcript.some((entry, index) => entry !== block.agentRun!.transcript![index]))
      block = { ...block, agentRun: { ...block.agentRun, transcript } };
  }
  let stopped = block.streaming ? sealStream(block) : block;
  if (stopped.orchestration?.status === "planning") {
    stopped = {
      ...stopped,
      orchestration: {
        ...stopped.orchestration,
        status: "invalid",
        error: "Planning was interrupted. Generate the assignments again.",
      },
    };
  }
  if (stopped.role === "plan" && stopped.plan?.status === "streaming") {
    stopped = {
      ...stopped,
      plan: {
        ...stopped.plan,
        status: "ready",
        originalText: stopped.text,
        edited: false,
      },
    };
  }
  const current = stopped.taskList;
  if (!current?.items.some((item) => item.status === "in_progress")) {
    return stopped;
  }
  const items = current.items.map((item) =>
    item.status === "in_progress"
      ? { ...item, status: "pending" as const }
      : item,
  );
  return {
    ...stopped,
    text: taskListText(items),
    taskList: { ...current, items },
  };
}

function stampTurnDuration(blocks: Block[], endedAt: number): Block[] {
  let lastUser = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].role === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser < 0) return blocks;
  const user = blocks[lastUser];
  if (user.durationMs != null) return blocks;
  const startedAt = userTurnStartTimes(blocks).get(user.id);
  if (startedAt == null) return blocks;
  const next = blocks.slice();
  next[lastUser] = {
    ...user,
    durationMs: Math.max(0, endedAt - startedAt),
  };
  return next;
}

/** Status pings repeat; keep one row per run instead of stacking identical lines. */
function appendStatus(session: Session, text: string): Session {
  const trimmed = text.trim();
  if (!trimmed) return session;
  const last = [...session.blocks]
    .reverse()
    .find((block) => block.role !== "reasoning");
  if (last?.role === "system" && last.text === trimmed) return session;
  return appendBlock(session, {
    id: crypto.randomUUID(),
    role: "system",
    text: trimmed,
  });
}

function upsertKeyedStatus(
  session: Session,
  key: string,
  text: string,
): Session {
  const trimmed = text.trim();
  const turnStart = lastMatchingBlock(
    session.blocks,
    (block) => block.role === "user",
  );
  const index = lastMatchingBlock(
    session.blocks,
    (block, at) => at > turnStart && block.statusKey === key,
  );
  if (index < 0) {
    if (!trimmed) return session;
    return appendBlock(session, {
      id: crypto.randomUUID(),
      role: "system",
      text: trimmed,
      statusKey: key,
    });
  }
  if (session.blocks[index].text === trimmed) return session;
  const blocks = session.blocks.slice();
  if (trimmed) blocks[index] = { ...blocks[index], text: trimmed };
  else blocks.splice(index, 1);
  return { ...session, blocks };
}

function appendImage(
  session: Session,
  event: Extract<HarnessEvent, { type: "image.generated"; path: string }>,
): Session {
  if (event.attachment && session.blocks.some(block => block.role === "image" &&
    block.attachments?.some(file => file.id === event.attachment!.id))) return session;
  return appendBlock(session, {
    id: crypto.randomUUID(),
    role: "image",
    text: "",
    ...(event.attachment ? { attachments: [event.attachment] } : {}),
    image: {
      path: event.path,
      name: event.name,
      mimeType: event.mimeType,
      size: event.size,
      ...(event.alt ? { alt: event.alt } : {}),
    },
  });
}

function appendBlock(session: Session, block: Block): Session {
  if (
    block.role === "assistant" || block.role === "image" || block.role === "plan"
  ) {
    const startedAt = block.startedAt ?? block.sentAt ?? Date.now();
    block = { ...block, startedAt, sentAt: block.sentAt ?? startedAt };
  }
  return {
    ...session,
    blocks: [
      ...(block.role === "system" && !block.interjection
        ? session.blocks
        : sealLastStream(session.blocks)),
      block,
    ],
  };
}

/** Only ordinary status rows leave an open prose stream intact. */
function patchStreaming(
  session: Session,
  role: "assistant" | "reasoning",
  input: string | readonly string[],
  streaming: boolean,
): Session {
  if (
    role === "reasoning" &&
    (typeof input === "string" ? !input : input.every((text) => !text))
  )
    return session;
  let index = session.blocks.length - 1;
  while (
    index >= 0 &&
    session.blocks[index].role === "system" &&
    !session.blocks[index].interjection
  )
    index--;
  const last = session.blocks[index];
  // A completion closes one provider message. The next delta is a new message
  // even when no tool or status row landed between them; joining the two can
  // turn separate Markdown blocks into text such as `commitConnect`.
  if (last?.role === role && last.streaming) {
    // Fold against the existing text in order: providers can mix tokens and
    // full snapshots, so concatenating the incoming chunks would duplicate text.
    const nextText =
      typeof input === "string"
        ? joinStreamText(last.text, input)
        : input.reduce(joinStreamText, last.text);
    if (nextText === last.text && last.streaming === streaming) return session;
    const blocks = session.blocks.slice();
    blocks[index] = {
      ...last,
      text: nextText,
      streaming,
      ...(role === "assistant" && last.startedAt == null
        ? { startedAt: last.sentAt ?? Date.now() }
        : {}),
      ...(role === "assistant" && nextText !== last.text
        ? { sentAt: Date.now() }
        : {}),
    };
    return { ...session, blocks };
  }
  const blocks = sealLastStream(session.blocks);
  blocks.push({
    id: crypto.randomUUID(),
    role,
    text: typeof input === "string" ? input : input.reduce(joinStreamText, ""),
    streaming,
    // Keep the response's first token time stable while its latest content time moves.
    startedAt: Date.now(),
    ...(role === "assistant" ? { sentAt: Date.now() } : {}),
  });
  return { ...session, blocks };
}

function attachApproval(
  session: Session,
  event: Extract<HarnessEvent, { type: "approval.requested" }>,
): Session {
  const index = findToolForApproval(session, event);
  if (index >= 0) {
    const blocks = session.blocks.slice();
    const prev = blocks[index];
    const preview = mergeToolPreview(event.preview, prev.tool?.preview);
    const label =
      finalToolLabel(
        session,
        event.kind ?? prev.tool?.kind,
        preferLabel(event.title, prev.tool?.title, prev.text),
        preview,
      ) || prev.text;
    blocks[index] = {
      ...prev,
      text: label || prev.text,
      tool: prev.tool
        ? {
            ...prev.tool,
            kind: event.kind ?? prev.tool.kind,
            title: label || prev.tool.title,
            ...(preview ? { preview } : {}),
          }
        : event.callId
          ? {
              callId: event.callId,
              title: label,
              kind: event.kind,
              ...(preview ? { preview } : {}),
            }
          : prev.tool,
      approval: { requestId: event.requestId },
    };
    return { ...session, blocks };
  }
  const preview = event.preview;
  const label =
    finalToolLabel(session, event.kind, preferLabel(event.title), preview) ||
    kindTitle(event.kind);
  return appendBlock(session, {
    id: crypto.randomUUID(),
    role: "tool",
    text: label,
    tool: {
      ...(event.callId ? { callId: event.callId } : {}),
      title: label,
      kind: event.kind,
      ...(preview ? { preview } : {}),
    },
    approval: { requestId: event.requestId },
  });
}

function findToolForApproval(
  session: Session,
  event: Extract<HarnessEvent, { type: "approval.requested" }>,
): number {
  if (event.callId) {
    const byId = session.blocks.findIndex(
      (block) => block.tool?.callId === event.callId,
    );
    if (byId >= 0) return byId;
  }
  const needle = normalizeLabel(event.title);
  const unmatched: number[] = [];
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    const block = session.blocks[i];
    if (block.role !== "tool" || block.approval) continue;
    unmatched.push(i);
    const label = normalizeLabel(block.text || block.tool?.title || "");
    if (needle && label === needle) return i;
  }
  return unmatched.length === 1 ? unmatched[0] : -1;
}

function normalizeLabel(value: string): string {
  return value
    .replace(/[→`]/g, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s*·.*$/, "")
    .trim()
    .toLowerCase();
}

function upsertTool(
  session: Session,
  patch: {
    callId: string;
    title?: string;
    kind?: string;
    status?: string;
    detail?: string;
    preview?: ToolPreview;
    paths?: string[];
    streaming: boolean;
    agentModel?: string;
    background?: boolean;
  },
): Session {
  if (!session.blocks.some((block) => block.tool?.callId === patch.callId)) {
    const nested = updateAgentTool(session.blocks, patch.callId, (block) =>
      upsertTool({ ...session, blocks: [block] }, patch).blocks[0]);
    if (nested !== session.blocks) return { ...session, blocks: nested };
    // An unchanged nested call still belongs there.
    let found = false;
    updateAgentTool(session.blocks, patch.callId, (block) => { found = true; return block; });
    if (found) return session;
  }
  const index = findToolIndex(session, patch);
  const previous = index < 0 ? undefined : session.blocks[index];
  const status = patch.status ?? previous?.tool?.status;
  const finished = status != null && [
    "completed", "success", "failed", "error", "cancelled", "canceled",
  ].includes(status.toLowerCase());
  const streaming = patch.streaming && !finished;
  const startedAt = previous?.startedAt ?? (streaming ? Date.now() : undefined);
  const durationMs = previous?.durationMs ?? (
    finished && startedAt != null ? Math.max(0, Date.now() - startedAt) : undefined
  );
  if (index < 0) {
    const detail = patch.kind === "agent" ? patch.detail : capToolDetail(patch.detail);
    const preview = fillPreview(patch.preview, detail, patch.kind, patch.title);
    const label = finalToolLabel(
      session,
      patch.kind,
      displayLabel(patch),
      preview,
    );
    return appendBlock(session, {
      id: crypto.randomUUID(),
      role: "tool",
      text: label,
      streaming,
      ...(startedAt != null ? { startedAt } : {}),
      ...(patch.agentModel
        ? { agentRun: { name: label, model: patch.agentModel, steps: [] } }
        : {}),
      tool: {
        callId: patch.callId,
        title: label,
        kind: patch.kind,
        status: patch.status,
        ...(detail ? { detail } : {}),
        ...(preview ? { preview } : {}),
        ...(patch.paths ? { paths: patch.paths } : {}),
        ...(patch.background ? { background: true } : {}),
      },
    });
  }
  const prev = session.blocks[index];
  const detail = ((patch.kind ?? prev.tool?.kind) === "agent" ? patch.detail : capToolDetail(patch.detail)) ?? prev.tool?.detail;
  const preview = fillPreview(
    mergeToolPreview(patch.preview, prev.tool?.preview),
    detail,
    patch.kind ?? prev.tool?.kind,
    patch.title,
  );
  const label = finalToolLabel(
    session,
    patch.kind ?? prev.tool?.kind,
    displayLabel(patch, prev),
    preview,
  );
  const kind = patch.kind ?? prev.tool?.kind;
  const paths = patch.paths ?? prev.tool?.paths;
  const agentName = prev.agentRun && prev.agentRun.name !== prev.text && !isWeakToolTitle(prev.agentRun.name)
    ? prev.agentRun.name : label;
  if (
    prev.text === label &&
    prev.streaming === streaming &&
    prev.startedAt === startedAt &&
    prev.durationMs === durationMs &&
    prev.tool?.title === label &&
    prev.tool?.kind === kind &&
    prev.tool?.status === status &&
    prev.tool?.detail === detail &&
    prev.tool?.paths === paths &&
    (!patch.agentModel || prev.agentRun?.model === patch.agentModel) &&
    (!prev.agentRun || prev.agentRun.name === agentName) &&
    samePreview(prev.tool?.preview, preview)
  ) {
    return session;
  }
  const blocks = session.blocks.slice();
  blocks[index] = {
    ...prev,
    text: label,
    streaming,
    ...(startedAt != null ? { startedAt } : {}),
    ...(durationMs != null ? { durationMs } : {}),
    ...(patch.agentModel || prev.agentRun
      ? {
          agentRun: {
            steps: prev.agentRun?.steps ?? [],
            ...prev.agentRun,
            name: agentName,
            ...(patch.agentModel ? { model: patch.agentModel } : {}),
          },
        }
      : {}),
    tool: {
      ...prev.tool,
      callId: patch.callId,
      title: label,
      kind,
      status,
      ...(detail ? { detail } : {}),
      ...(preview ? { preview } : {}),
      ...(paths ? { paths } : {}),
      ...(prev.tool?.background ? { background: true } : {}),
    },
  };
  return { ...session, blocks };
}

const MAX_TOOL_DETAIL_CHARS = 8_000;

function capToolDetail(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (text.length <= MAX_TOOL_DETAIL_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_DETAIL_CHARS)}\n…`;
}

function samePreview(a?: ToolPreview, b?: ToolPreview): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.kind === b.kind &&
    a.path === b.path &&
    a.query === b.query &&
    a.fileName === b.fileName &&
    a.additions === b.additions &&
    a.deletions === b.deletions &&
    a.contentOnly === b.contentOnly &&
    a.startLine === b.startLine &&
    a.output === b.output &&
    a.lines === b.lines
  );
}

function fillPreview(
  preview: ToolPreview | undefined,
  _detail: string | undefined,
  kind?: string,
  title?: string,
): ToolPreview | undefined {
  if (
    preview?.contentOnly ||
    preview?.lines?.some((line) => line.kind === "add" || line.kind === "del")
  ) {
    return preview;
  }
  if (preview) return { ...preview, lines: undefined };
  if (isFileTool(kind, title, preview)) {
    return stubFilePreview(kind, title);
  }
  return undefined;
}

function findToolIndex(
  session: Session,
  patch: { callId: string; title?: string },
): number {
  if (patch.callId) {
    const byId = session.blocks.findIndex(
      (block) => block.tool?.callId === patch.callId,
    );
    if (byId >= 0) return byId;
  }
  const needle = normalizeLabel(patch.title || "");
  if (!needle) return -1;
  return session.blocks.findIndex((block) => {
    if (block.role !== "tool" || !block.approval || block.tool?.callId) {
      return false;
    }
    return normalizeLabel(block.text || block.tool?.title || "") === needle;
  });
}

function sealLastStream(blocks: Block[]): Block[] {
  let index = blocks.length - 1;
  while (
    index >= 0 &&
    blocks[index].role === "system" &&
    !blocks[index].interjection
  )
    index--;
  const last = blocks[index];
  if (
    !last?.streaming ||
    (last.role !== "assistant" && last.role !== "reasoning")
  ) {
    return blocks.slice();
  }
  const next = blocks.slice();
  next[index] = sealStream(last);
  return next;
}

/** Close a stream; timed thoughts and tools also record how long they ran. */
function sealStream(block: Block): Block {
  if (
    (block.role === "reasoning" || block.role === "tool") &&
    block.startedAt != null &&
    block.durationMs == null
  ) {
    return {
      ...block,
      streaming: false,
      durationMs: Math.max(0, Date.now() - block.startedAt),
    };
  }
  return { ...block, streaming: false };
}

function displayLabel(
  patch: { title?: string; kind?: string },
  prev?: Block,
): string {
  return (
    preferLabel(patch.title, prev?.tool?.title, prev?.text) ||
    kindTitle(patch.kind ?? prev?.tool?.kind)
  );
}

function finalToolLabel(
  session: Session,
  kind: string | undefined,
  title: string | undefined,
  preview?: ToolPreview,
): string {
  const path = preview?.path
    ? displayPath(preview.path, session.cwd)
    : preview?.fileName;
  return (
    composeToolTitle({
      kind,
      title,
      path,
      query: preview?.query,
      previewKind: preview?.kind,
      cwd: session.cwd,
    }) ||
    title?.trim() ||
    kindTitle(kind)
  );
}

function preferLabel(...parts: (string | undefined)[]): string {
  const filled = parts
    .filter((part): part is string => !!part?.trim())
    .map((part) => part.trim())
    .filter((part) => !isCallId(part));
  const strong = filled.filter((part) => !isWeakToolTitle(part));
  const compactStrong = strong.filter((part) => compactLabel(part) === part);
  compactStrong.sort((a, b) => b.length - a.length);
  if (compactStrong[0]) return compactStrong[0];
  // A long command is still more useful than an earlier "Shell" placeholder.
  if (strong[0]) return strong[0];
  const compact = filled.filter((part) => compactLabel(part) === part);
  compact.sort((a, b) => b.length - a.length);
  return compact[0] ?? filled[0] ?? "";
}

function compactLabel(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  if (trimmed.includes("\n") || trimmed.length > 240) return undefined;
  return trimmed;
}

function kindTitle(kind?: string): string {
  const key = kind?.trim().toLowerCase() ?? "";
  switch (key) {
    case "read":
      return "Read";
    case "edit":
      return "Edit";
    case "delete":
      return "Delete";
    case "move":
      return "Move";
    case "search":
      return "Find";
    case "execute":
    case "shell":
    case "bash":
      return "Shell";
    case "skill":
      return "Skill";
    case "agent":
    case "task":
    case "subagent":
      return "Subagent";
    case "think":
      return "Think";
    case "fetch":
      return "Fetch";
    case "other":
    case "":
      return "Working";
    default:
      return key.replace(/^_/, "").replace(/[_-]+/g, " ");
  }
}

function isCallId(value: string): boolean {
  const text = value.trim();
  return (
    /^(call[-_]?|tool[-_])[a-z0-9_-]+$/i.test(text) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
  );
}

function finishRole(session: Session, role: Block["role"]): Session {
  return {
    ...session,
    blocks: session.blocks.map((block) =>
      block.role === role && block.streaming ? sealStream(block) : block,
    ),
  };
}
