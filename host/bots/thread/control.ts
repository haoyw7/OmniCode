import { randomUUID } from "node:crypto";
import { enforceBotRouting } from "./routing";
import { currentMachineIO, localMachineIO, machineFs, machinePath, withMachineIO } from "../../machine-io";
import { parseProjectMachine, projectMachineKey } from "../../../src/integrations/harness/core/machine";
import type { BotThreadRuntime } from "./index";
import { signature } from "./store";
import { createHabit, deleteHabit, updateHabit } from "./habits";
import { assertReplyAttachmentAccess, publishReplyAttachments } from "./attachments";
import {
  addMemoryEntry,
  archiveMemoryEntries,
  fitMemoryBudget,
  memoryDate,
  memoryEntry,
  redactSecrets,
  removeMemoryEntry,
  searchMemory,
  sinceDate,
  supersedeMemoryEntry,
  topicName,
} from "./memory";
import {
  actionPermission,
  checkPolicy,
  fields,
  id,
  object,
  workspacePermission,
} from "./policy";
import { searchChat } from "./chatSearch";
import {
  MAX_PLAYBOOKS,
  PLAYBOOK_PREFIX,
  assignedPlaybookPrompt,
  playbookDocument,
  playbookName,
} from "./playbooks";
import { WorkspaceCommands } from "../../workspace-commands";
import { hostWorktrees, withValidatedHostWorktree } from "../../git-worktrees";
import { summary } from "../../store";
import { HOST_RESOURCE_BUSY_MESSAGE, withHostResources } from "../resources";
import type {
  BotAction,
  BotPermission,
} from "../../../src/features/bots/model/botView";
import type { HostCommand, HostSession } from "../../../src/contracts/protocol";

import { BOT_ACTIONS } from "../../../src/features/bots/model/botActions";
export { BOT_ACTIONS } from "../../../src/features/bots/model/botActions";
export const MAX_PENDING_REMINDERS = 50;
const MAX_REMINDER_DELAY = 10080;
const aliases: Record<string, string> = {
  "files.list": "list_dir",
  "files.read": "read_text_file",
  "files.search": "search_project",
  "files.create": "create_path",
  "files.write": "write_text_file",
  "files.move": "move_path",
  "files.copy": "copy_path",
  "files.rename": "rename_path",
  "files.delete": "delete_path",
};
const mutationFields: Record<string, string[]> = {
  "sessions.create": ["harness", "model", "modelSettings", "runtimeMode", "executionCwd", "workspace", "sharedReason"],
  "sessions.integrate": ["verification"],
  "sessions.send": ["text", "attachments", "intent", "playbooks"],
  "sessions.steer": ["text", "runId", "playbooks"],
  "sessions.configure": ["model", "modelSettings", "runtimeMode"],
  "sessions.compact": [],
  "sessions.cancel": ["runId"],
  "sessions.approve": ["runId", "requestId", "decision"],
  "sessions.answer": ["runId", "requestId", "reply"],
  "sessions.queue": [
    "action",
    "messageId",
    "beforeId",
    "text",
    "editor",
    "runId",
    "playbooks",
  ],
  "sessions.update": ["title", "archived", "pinned", "linkedWorkItem"],
  "sessions.delete": [],
  "orchestration.command": [
    "action",
    "proposalBlockId",
    "expectedRevision",
    "edit",
    "orchestrationId",
    "taskId",
  ],
  "orchestration.worker": [
    "leadId",
    "taskId",
    "orchestrationId",
    "action",
    "input",
    "playbooks",
  ],
};
const inRoot = (path: string, root: string) => {
  const rel = machinePath.relative(root, path);
  return (
    rel === "" ||
    (!machinePath.isAbsolute(rel) &&
      rel !== ".." &&
      !rel.startsWith("../") &&
      !rel.startsWith("..\\"))
  );
};
function readableResult(
  assistant: BotThreadRuntime,
  old: BotAction,
): unknown {
  if (old.action === "reply.attachments") {
    assertReplyAttachmentAccess(assistant, old.input);
    return old.result;
  }
  const policy = assistant.store.get()!.policy;
  const actionPermissionKey =
    old.action === "workspace.run" ||
    old.action.startsWith("git.") ||
    Object.hasOwn(aliases, old.action)
      ? workspacePermission(aliases[old.action] ?? String(old.input.command))
      : undefined;
  const read: BotPermission = actionPermissionKey?.startsWith("files.")
    ? "files.read"
    : actionPermissionKey?.startsWith("git.")
      ? "git.read"
      : old.action.startsWith("projects.")
        ? "projects.read"
        : old.action === "agents.list" || old.action === "models.list"
          ? "catalog.read"
          : "sessions.read";
  checkPolicy(
    policy,
    read,
    old.targetRef?.projectId ??
      (typeof old.input.projectId === "string"
        ? old.input.projectId
        : undefined),
  );
  const allowed = (project: string) =>
    policy.allowedProjects === "all" ||
    policy.allowedProjects.includes(project);
  if (old.action === "projects.list" && Array.isArray(old.result))
    return old.result.filter((p) => allowed(p.id));
  if (old.action === "projects.createChat" && old.result && typeof old.result === "object" && "id" in old.result)
    checkPolicy(policy, "projects.read", String(old.result.id));
  if (
    (old.action === "sessions.list" || old.action === "sessions.activity") &&
    old.result &&
    typeof old.result === "object"
  ) {
    const result = old.result as { sessions: { projectId: string }[] };
    return {
      ...result,
      sessions: result.sessions.filter((s) => allowed(s.projectId)),
    };
  }
  return old.result;
}
/** One-shot follow-ups the assistant promises; governed by the scheduled-check trigger. */
function reminderAction(
  assistant: BotThreadRuntime,
  requestId: string,
  action: string,
  input: Record<string, unknown>,
): unknown {
  const store = assistant.store,
    config = store.get()!;
  if (action === "reminders.list") {
    fields(input, []);
    return (config.reminders ?? []).filter((r) => r.state === "pending");
  }
  if (!config.triggers.schedule)
    throw new Error("Scheduled follow-ups are disabled");
  const sig = signature({ action, input, assistantId: config.id });
  const previous = store.action(requestId);
  if (previous) {
    if (previous.signature !== sig)
      throw new Error("Request ID was already used with different input");
    if (previous.state === "failed")
      throw new Error(previous.error ?? "The previous operation failed");
    return previous.result;
  }
  const wakeup = assistant.currentWakeup(),
    now = Date.now();
  const reminders = config.reminders ?? [];
  let result: unknown, next: typeof reminders;
  if (action === "reminders.create") {
    fields(input, ["delayMinutes", "dueAt", "prompt"]);
    const prompt = id(input.prompt, "reminder", 2000);
    if ((input.delayMinutes === undefined) === (input.dueAt === undefined))
      throw new Error("Give either delayMinutes or dueAt");
    const dueAt =
      input.delayMinutes !== undefined
        ? now + Number(input.delayMinutes) * 60000
        : Number(input.dueAt);
    if (
      !Number.isSafeInteger(dueAt) ||
      dueAt < now + 60000 - 1000 ||
      dueAt > now + MAX_REMINDER_DELAY * 60000
    )
      throw new Error("Reminders must be between 1 minute and 7 days away");
    if (
      reminders.filter((r) => r.state === "pending").length >=
      MAX_PENDING_REMINDERS
    )
      throw new Error("Too many pending reminders");
    const reminder = {
      id: randomUUID(),
      dueAt,
      prompt,
      createdAt: now,
      createdBy: wakeup.id,
      rootCauseId: wakeup.rootCauseId,
      state: "pending" as const,
    };
    next = [
      ...reminders.filter(
        (r) => r.state === "pending" || r.dueAt > now - 86400000,
      ),
      reminder,
    ];
    result = { reminderId: reminder.id, dueAt };
  } else if (action === "reminders.cancel") {
    fields(input, ["reminderId"]);
    const reminderId = id(input.reminderId, "reminder ID");
    if (!reminders.some((r) => r.id === reminderId && r.state === "pending"))
      throw new Error("Reminder is not pending");
    next = reminders.map((r) =>
      r.id === reminderId ? { ...r, state: "cancelled" as const } : r,
    );
    result = { cancelled: true };
  } else throw new Error("Unsupported assistant action");
  const actionId = randomUUID();
  store.host.transaction(() => {
    store.update({
      reminders: next,
      activity: { action, at: now },
    });
    store.putAction({
      id: actionId,
      requestId,
      signature: sig,
      action,
      input,
      rootCauseId: wakeup.rootCauseId,
      origin: {
        kind: "assistant",
        assistantId: config.id,
        botId: store.botId,
        threadId: store.threadId,
        assistantName: config.name,
        actionId,
        wakeupId: wakeup.id,
      },
      state: "completed",
      result,
    });
  });
  return result;
}
/** The recorded result of an own action, or undefined when the request is new. */
function replayed(
  assistant: BotThreadRuntime,
  requestId: string,
  sig: string,
): { result: unknown } | undefined {
  const previous = assistant.store.action(requestId);
  if (!previous) return undefined;
  if (previous.signature !== sig)
    throw new Error("Request ID was already used with different input");
  if (previous.state === "failed")
    throw new Error(previous.error ?? "The previous operation failed");
  return { result: previous.result };
}
/** Applies an action on the assistant's own state and logs it in one transaction. */
function recordOwnAction(
  assistant: BotThreadRuntime,
  requestId: string,
  sig: string,
  action: string,
  input: Record<string, unknown>,
  result: unknown,
  apply: () => void,
): unknown {
  const store = assistant.store,
    config = store.get()!,
    wakeup = assistant.currentWakeup(),
    actionId = randomUUID();
  store.host.transaction(() => {
    apply();
    store.update({ activity: { action, at: Date.now() } });
    store.putAction({
      id: actionId,
      requestId,
      signature: sig,
      action,
      input,
      rootCauseId: wakeup.rootCauseId,
      origin: {
        kind: "assistant",
        assistantId: config.id,
        botId: store.botId,
        threadId: store.threadId,
        assistantName: config.name,
        actionId,
        wakeupId: wakeup.id,
      },
      state: "completed",
      result,
    });
  });
  return result;
}
/** Topic notes are read on demand, so they only need a sanity cap. */
const MAX_TOPIC_BYTES = 64 * 1024;
/**
 * The assistant's own notebook, like reminders: no project scope, so it is
 * governed by assistant control rather than a project permission.
 */
function memoryAction(
  assistant: BotThreadRuntime,
  requestId: string,
  action: string,
  input: Record<string, unknown>,
): unknown {
  const store = assistant.store,
    config = store.get()!,
    timeZone = config.timezone ?? "UTC",
    now = new Date();
  const doc = () =>
    input.topic === undefined
      ? "memory"
      : `topic:${topicName(id(input.topic, "topic", 80))}`;
  if (action === "memory.read") {
    fields(input, ["topic"]);
    const name = doc();
    return {
      text: store.memoryDoc(name).text,
      ...(name === "memory" ? { topics: store.memoryTopics() } : {}),
    };
  }
  if (action === "memory.search") {
    fields(input, ["query", "since", "limit"]);
    const query =
      input.query === undefined ? "" : id(input.query, "query", 500);
    const limit = input.limit === undefined ? 20 : Number(input.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new Error("limit must be between 1 and 50");
    return searchMemory(
      [
        { file: "memory", text: store.memoryDoc("memory").text },
        ...store.memoryTopics().map((topic) => ({
          file: `topic:${topic}`,
          text: store.memoryDoc(`topic:${topic}`).text,
        })),
        { file: "archive", text: store.memoryDoc("archive").text },
      ],
      query,
      {
        limit,
        ...(input.since === undefined
          ? {}
          : { since: sinceDate(id(input.since, "since", 20), now, timeZone) }),
      },
    );
  }
  const sig = signature({ action, input, assistantId: config.id });
  const replay = replayed(assistant, requestId, sig);
  if (replay) return replay.result;
  const date = memoryDate(now, timeZone),
    name = doc(),
    current = store.memoryDoc(name);
  const entry = () =>
    memoryEntry(
      id(input.fact, "fact", 4000),
      date,
      input.until === undefined ? undefined : id(input.until, "until", 20),
    );
  let text: string, result: Record<string, unknown>, keep: string | undefined;
  if (action === "memory.add") {
    fields(input, ["fact", "until", "topic"]);
    keep = entry();
    const added = addMemoryEntry(current.text, keep);
    text = added.text;
    result = { added: added.added };
  } else if (action === "memory.replace") {
    fields(input, ["find", "fact", "until", "topic"]);
    keep = entry();
    text = supersedeMemoryEntry(
      current.text,
      id(input.find, "find", 1000),
      keep,
      date,
    );
    result = { replaced: true };
  } else if (action === "memory.remove") {
    fields(input, ["find", "topic"]);
    const removed = removeMemoryEntry(
      current.text,
      id(input.find, "find", 1000),
    );
    text = removed.text;
    result = { removed: removed.removed };
  } else throw new Error("Unsupported assistant action");
  let archived: string[] = [];
  if (name === "memory") {
    const fitted = fitMemoryBudget(text, keep, date);
    text = fitted.text;
    archived = fitted.moved;
    if (archived.length) result = { ...result, archived: archived.length };
  } else if (new TextEncoder().encode(text).length > MAX_TOPIC_BYTES)
    throw new Error("Topic note is full; remove or replace older entries");
  return recordOwnAction(
    assistant,
    requestId,
    sig,
    action,
    // The log keeps what memory keeps: no credentials.
    Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        typeof value === "string" ? redactSecrets(value) : value,
      ]),
    ),
    result,
    () => {
      store.writeMemoryDoc(name, text, current.revision);
      if (archived.length)
        store.writeMemoryDoc(
          "archive",
          archiveMemoryEntries(store.memoryDoc("archive").text, archived, date),
        );
    },
  );
}
/** Procedures the assistant keeps, governed like memory by assistant control. */
function playbookAction(
  assistant: BotThreadRuntime,
  requestId: string,
  action: string,
  input: Record<string, unknown>,
): unknown {
  const store = assistant.store,
    config = store.get()!;
  if (action === "playbooks.list") {
    fields(input, []);
    return store.playbooks().map(({ body: _body, ...summary }) => summary);
  }
  if (action === "playbooks.read") {
    fields(input, ["name"]);
    const name = playbookName(input.name);
    const found = store.playbooks().find((p) => p.name === name);
    if (!found) throw new Error("No playbook with that name");
    return found;
  }
  const sig = signature({ action, input, assistantId: config.id });
  const replay = replayed(assistant, requestId, sig);
  if (replay) return replay.result;
  const today = memoryDate(new Date(), config.timezone ?? "UTC");
  let text: string, name: string, result: Record<string, unknown>;
  if (action === "playbooks.save") {
    fields(input, ["name", "description", "body", "verified"]);
    name = playbookName(input.name);
    const existing = store.playbooks();
    const previous = existing.find((p) => p.name === name);
    if (!previous && existing.length >= MAX_PLAYBOOKS)
      throw new Error("Too many playbooks; merge or delete old ones first");
    if (input.verified !== undefined && typeof input.verified !== "boolean")
      throw new Error("verified must be true or false");
    text = playbookDocument(
      {
        name,
        description: input.description,
        body: input.body,
        verified: input.verified as boolean | undefined,
      },
      previous,
      today,
    );
    result = { name, created: !previous };
  } else if (action === "playbooks.delete") {
    fields(input, ["name"]);
    name = playbookName(input.name);
    text = "";
    result = { deleted: store.playbooks().some((p) => p.name === name) };
  } else throw new Error("Unsupported assistant action");
  return recordOwnAction(
    assistant,
    requestId,
    sig,
    action,
    Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        typeof value === "string" ? redactSecrets(value) : value,
      ]),
    ),
    result,
    () => {
      store.writeMemoryDoc(`${PLAYBOOK_PREFIX}${name}`, text);
    },
  );
}
/**
 * Recurring calendar tasks the assistant keeps for the user, governed like
 * reminders by the scheduled-check trigger.
 */
function habitAction(
  assistant: BotThreadRuntime,
  requestId: string,
  action: string,
  input: Record<string, unknown>,
): unknown {
  const store = assistant.store,
    config = store.get()!,
    habits = config.habits ?? [];
  if (action === "habits.list") {
    fields(input, []);
    return habits;
  }
  if (!config.triggers.schedule)
    throw new Error("Scheduled checks are disabled");
  const sig = signature({ action, input, assistantId: config.id });
  const replay = replayed(assistant, requestId, sig);
  if (replay) return replay.result;
  const now = Date.now(),
    timeZone = config.timezone ?? "UTC";
  let next: typeof habits, result: unknown;
  if (action === "habits.create") {
    const created = createHabit(habits, input, now, timeZone);
    next = created.habits;
    result = { habitId: created.habit.id, nextRunAt: created.habit.nextRunAt };
  } else if (action === "habits.update") {
    const { habitId, ...change } = input;
    const target = id(habitId, "habit ID");
    next = updateHabit(habits, target, change, now, timeZone);
    result = { nextRunAt: next.find((habit) => habit.id === target)!.nextRunAt };
  } else if (action === "habits.delete") {
    fields(input, ["habitId"]);
    next = deleteHabit(habits, id(input.habitId, "habit ID"));
    result = { deleted: true };
  } else throw new Error("Unsupported assistant action");
  return recordOwnAction(assistant, requestId, sig, action, input, result, () =>
    store.update({ habits: next }),
  );
}
export async function executeBotAction(
  assistant: BotThreadRuntime,
  requestId: string,
  action: string,
  input: Record<string, unknown>,
  authorized: () => boolean,
): Promise<unknown> {
  object(input);
  const project = typeof input.projectId === "string" ? assistant.engine.store.project(input.projectId) : undefined;
  const machine = project?.machine ?? (action === "projects.open" ? parseProjectMachine(input.machine) : undefined);
  const execute = () => executeMachineBotAction(assistant, requestId, action, input, authorized);
  if (assistant.engine.machines) return assistant.engine.machines.run(machine, execute);
  if (machine) throw new Error("WSL execution is unavailable on this Host");
  return withMachineIO(localMachineIO, execute);
}

async function executeMachineBotAction(
  assistant: BotThreadRuntime,
  requestId: string,
  action: string,
  input: Record<string, unknown>,
  authorized: () => boolean,
): Promise<unknown> {
  id(requestId, "request ID");
  object(input);
  assistant.assertActionEnabled(action);
  const engine = assistant.engine,
    store = assistant.store;
  const config = store.get()!;
  let permission: BotPermission;
  // Delegations own their durable receipts. Caching a running response in the
  // ordinary action ledger would prevent subsequent short polls from settling.
  if (action === "agents.list_bots") {
    fields(input, []);
    return assistant.agentBots(authorized);
  }
  if (action === "agents.ask_bot") {
    fields(input, ["botId", "prompt", "timeoutMs"]);
    return assistant.askBot(requestId, input, authorized);
  }
  if (action === "agents.delegate_bot" || action === "agents.coordinate_bots") {
    if (!authorized()) throw new Error("Assistant control is inactive");
    const result = action === "agents.delegate_bot"
      ? await engine.bots.teams.delegate(assistant, requestId, input)
      : await engine.bots.teams.coordinate(assistant, requestId, input);
    if (!authorized()) throw new Error("Assistant control is inactive");
    return result;
  }
  if (
    action === "workspace.run" ||
    action.startsWith("git.") ||
    Object.hasOwn(aliases, action)
  ) {
    permission = workspacePermission(
      Object.hasOwn(aliases, action)
        ? aliases[action]
        : id(input.command, "workspace command"),
    );
    if (
      (action === "git.read" && permission !== "git.read") ||
      (action === "git.action" && permission !== "git.write") ||
      (action === "git.publish" && permission !== "git.publish")
    )
      throw new Error("Workspace action does not match its permission");
  } else if (action === "actions.get") {
    fields(input, ["requestId"]);
    if (!authorized()) throw new Error("Assistant permission was revoked");
    const old = store.action(id(input.requestId));
    if (!old) return null;
    return {
      requestId: old.requestId,
      state: old.state,
      result: readableResult(assistant, old),
      error: old.error,
    };
  } else if (action === "reply.attachments") {
    return publishReplyAttachments(assistant, requestId, input, authorized);
  } else if (action.startsWith("reminders.")) {
    if (!authorized()) throw new Error("Assistant control was revoked");
    return reminderAction(assistant, requestId, action, input);
  } else if (action.startsWith("memory.")) {
    if (!authorized()) throw new Error("Assistant control was revoked");
    return memoryAction(assistant, requestId, action, input);
  } else if (action === "chat.search") {
    if (!authorized()) throw new Error("Assistant control was revoked");
    fields(input, ["query", "since", "limit"]);
    const timeZone = store.get()!.timezone ?? "UTC";
    const limit = input.limit === undefined ? 20 : Number(input.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new Error("limit must be between 1 and 50");
    return searchChat(
      store.latestMessages(),
      input.query === undefined ? "" : id(input.query, "query", 500),
      {
        timeZone,
        limit,
        ...(input.since === undefined
          ? {}
          : {
              since: sinceDate(
                id(input.since, "since", 20),
                new Date(),
                timeZone,
              ),
            }),
      },
    );
  } else if (action.startsWith("playbooks.")) {
    if (!authorized()) throw new Error("Assistant control was revoked");
    return playbookAction(assistant, requestId, action, input);
  } else if (action.startsWith("habits.")) {
    if (!authorized()) throw new Error("Assistant control was revoked");
    return habitAction(assistant, requestId, action, input);
  } else permission = actionPermission(action);
  let projectId =
    typeof input.projectId === "string" ? id(input.projectId) : undefined;
  let session: HostSession | undefined;
  if (input.sessionId !== undefined) {
    session = engine.store.session(id(input.sessionId));
    if (
      session.session.assistantOwnerId ||
      engine.store.project(session.projectId).kind
    )
      throw new Error("Assistant brain is private");
    if (!projectId || projectId !== session.projectId)
      throw new Error("Session does not belong to this project");
  }
  if (
    input.environmentId !== undefined &&
    input.environmentId !== engine.store.environmentId
  )
    throw new Error("Wrong Host environment");
  if (projectId && engine.store.project(projectId).kind)
    throw new Error("Internal project is private");
  const additional = new Set<BotPermission>();
  const requireAccess = () => {
    if (!authorized()) throw new Error("Assistant control was revoked");
    const targetId = session?.session.id ?? (action === "orchestration.worker" && typeof input.leadId === "string" ? id(input.leadId) : undefined);
    const accessPermission = action === "orchestration.worker" && ["get", "list"].includes(String(input.action)) ? "sessions.read" : permission;
    assistant.checkSessionAccess(accessPermission, projectId, targetId);
    for (const extra of additional)
      assistant.checkSessionAccess(extra, projectId, targetId);
  };
  requireAccess();
  if (
    action === "sessions.queue" &&
    ["edit", "steer"].includes(String(input.action))
  ) {
    additional.add("sessions.send");
    requireAccess();
  }
  if (mutationFields[action])
    fields(input, [
      "projectId",
      "sessionId",
      "environmentId",
      ...mutationFields[action],
    ]);
  const sig = signature({ action, input, assistantId: config.id });
  const previous = store.action(requestId);
  if (previous) {
    if (previous.signature !== sig)
      throw new Error("Request ID was already used with different input");
    if (["executing", "unknown"].includes(previous.state))
      throw new Error(
        "unknown-outcome: inspect the existing effect before continuing",
      );
    // Resource refusal happened before effects. Retrying the same control
    // request is safe after the other run releases its lease.
    if (previous.state === "failed" && previous.error !== HOST_RESOURCE_BUSY_MESSAGE)
      throw new Error(previous.error ?? "The previous operation failed");
    if (previous.state !== "failed") return readableResult(assistant, previous);
  }
  const wakeup = assistant.currentWakeup();
  if (["sessions.create", "sessions.send", "sessions.steer"].includes(action) ||
    (action === "sessions.queue" && ["edit", "steer"].includes(String(input.action))))
    enforceBotRouting(wakeup, action, session?.session.id, store.actions());
  const resourceOwner = assistant.currentRun?.id ?? `assistant-action:${randomUUID()}`;
  const record: BotAction = {
    id: randomUUID(),
    requestId,
    signature: sig,
    action,
    input,
    rootCauseId: wakeup.rootCauseId,
    origin: {
      kind: "assistant",
      assistantId: config.id,
      botId: store.botId,
      threadId: store.threadId,
      assistantName: config.name,
      actionId: "",
      wakeupId: wakeup.id,
    },
    state: "executing",
    createdAt: Date.now(),
    ...(session
      ? {
          targetRef: {
            environmentId: engine.store.environmentId,
            projectId: session.projectId,
            sessionId: session.session.id,
          },
        }
      : {}),
  };
  record.origin.actionId = record.id;
  store.putAction(record);
  store.update({
    activity: {
      action,
      ...(projectId
        ? { projectName: engine.store.project(projectId).name }
        : {}),
      ...(session ? { sessionTitle: session.session.title } : {}),
      at: Date.now(),
    },
  });
  let external = false;
  let recorded = false;
  const persistResult = (result: unknown) => {
    const completed: BotAction = {
      ...record,
      ...(store.action(requestId)?.worktree ? { worktree: store.action(requestId)!.worktree } : {}),
      state: external ? "accepted" : "completed",
      result: result ?? null,
    };
    engine.store.transaction(() => {
      store.putAction(completed);
      if (
        (action === "sessions.create" ||
          action === "sessions.send" ||
          (action === "orchestration.worker" &&
            ["message", "retry", "steer"].includes(String(input.action)))) &&
        session &&
        completed.targetRef
      ) {
        const target = engine.store.session(session.session.id),
          project = engine.store.project(target.projectId);
        store.message({
          id: `card:${record.id}`,
          kind: "session-card",
          actionId: record.id,
          wakeupId: record.origin.wakeupId,
          ref: completed.targetRef,
          title: target.session.title,
          projectName: project.name,
          harness: target.session.harness as never,
          model: target.session.model,
          status: target.session.queuedMessages?.some(
            (q) => q.origin?.actionId === record.id,
          )
            ? "queued"
            : target.status === "running"
              ? "running"
              : "accepted",
        });
      }
    });
    recorded = true;
    return completed.result;
  };
  try {
    let result: unknown;
    if (action === "agents.list" || action === "models.list") {
      fields(input, ["projectId"]);
      result =
        action === "models.list"
          ? await assistant.models(projectId)
          : {
              providers: await assistant.providers(),
              capabilities: BOT_ACTIONS,
            };
    } else if (action === "projects.list") {
      fields(input, []);
      result = engine.store
        .projects()
        .filter(
          (p) =>
            config.policy.allowedProjects === "all" ||
            config.policy.allowedProjects.includes(p.id),
        );
    } else if (action === "projects.createChat") {
      fields(input, []);
      const authorize = () => {
        requireAccess();
        if (store.get()!.policy.allowedProjects !== "all") throw new Error("Project scope denied");
      };
      authorize();
      result = await engine.createChat(undefined, authorize);
    } else if (action === "projects.open") {
      fields(input, ["cwd", "machine"]);
      const cwd = id(input.cwd, "project directory", 4096);
      const known = engine.store.projects().find((p) => p.cwd === cwd && projectMachineKey(p.machine) === currentMachineIO().key);
      if (
        config.policy.allowedProjects !== "all" &&
        (!known || !config.policy.allowedProjects.includes(known.id))
      )
        throw new Error("Project scope denied");
      result = await engine.openProject(cwd, (actual) => {
        requireAccess();
        const policy = store.get()!.policy;
        const known = engine.store.projects().find((p) => p.cwd === actual && projectMachineKey(p.machine) === currentMachineIO().key);
        if (
          policy.allowedProjects !== "all" &&
          (!known || !policy.allowedProjects.includes(known.id))
        )
          throw new Error("Project scope denied");
      });
    } else if (action === "sessions.list" || action === "sessions.activity") {
      fields(input, ["projectId", "cursor", "limit"]);
      const cursor = input.cursor === undefined ? 0 : Number(input.cursor),
        limit = input.limit === undefined ? 50 : Number(input.limit);
      if (
        !Number.isSafeInteger(cursor) ||
        cursor < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        throw new Error("Invalid session page");
      const values = engine.store
        .sessions()
        .filter(
          (s) =>
            !s.session.assistantOwnerId &&
            (!projectId || s.projectId === projectId) &&
            (config.policy.allowedProjects === "all" ||
              config.policy.allowedProjects.includes(s.projectId)),
        );
      result = {
        sessions: values.slice(cursor, cursor + limit).map(summary),
        cursor: cursor + limit,
        hasMore: values.length > cursor + limit,
      };
    } else if (action === "sessions.get" || action === "orchestration.get") {
      fields(input, [
        "projectId",
        "sessionId",
        "environmentId",
        "revision",
        "offset",
        "limit",
        "latest",
      ]);
      if (!session) throw new Error("Choose a session");
      const limit = input.limit === undefined ? 50 : Number(input.limit),
        total = session.session.blocks.length;
      if (input.latest !== undefined && typeof input.latest !== "boolean")
        throw new Error("Invalid transcript page");
      // The latest page lets long conversations be read from the end backwards.
      const offset = input.latest
        ? Math.max(0, total - (Number.isSafeInteger(limit) ? limit : 0))
        : input.offset === undefined ? 0 : Number(input.offset);
      if (
        (input.latest && input.offset !== undefined) ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        throw new Error("Invalid transcript page");
      result =
        action === "orchestration.get"
          ? engine.orchestration.scheduler.run(session.session.id)
            ? engine.orchestration.view(
                engine.orchestration.scheduler.run(session.session.id)!,
              )
            : null
          : input.revision === session.revision
            ? null
            : {
                ...summary(session),
                blocks: session.session.blocks.slice(offset, offset + limit),
                hasMore: total > offset + limit,
                offset,
                total,
                pendingQuestion: session.session.pendingQuestion,
              };
    } else if (action === "sessions.create") {
      if (!projectId) throw new Error("Choose a project");
      if (input.workspace !== undefined && !["isolated", "shared"].includes(String(input.workspace))) throw new Error("Invalid task workspace");
      const { workspace, sharedReason, ...createInput } = input;
      if (workspace === "shared") id(sharedReason, "shared workspace reason", 1000);
      else {
        record.worktree = await engine.botTaskWorktrees.prepare({ botId: store.botId, threadId: store.threadId, requestId }, projectId,
          input.executionCwd, cwd => engine.generateWorktreeName(projectId, cwd, input.harness, wakeup.text.slice(0, 100000)), () => {
            additional.add("git.write"); requireAccess();
          });
        if (record.worktree) createInput.executionCwd = record.worktree.path;
      }
      requireAccess();
      result = await withValidatedHostWorktree(engine.store.project(projectId).cwd, createInput.executionCwd, () => engine.store.transaction(() => {
        requireAccess();
        const accepted = engine.assistantCommand(
          {
            ...createInput,
            type: "create",
            commandId: `assistant:${record.id}`,
            runtimeMode: input.runtimeMode ?? config.targetRuntimeMode,
          },
          record.origin,
        );
        const receipt = accepted as { sessionId: string };
        session = engine.store.session(receipt.sessionId);
        record.targetRef = {
          environmentId: engine.store.environmentId,
          projectId: session.projectId,
          sessionId: session.session.id,
        };
        store.followCreatedSession(session.projectId, session.session.id);
        return persistResult(accepted);
      }));
    } else if (action === "sessions.integrate") {
      if (!session || !store.createdSession(session.session.id)) throw new Error("Only Bot-created tasks can be integrated");
      additional.add("sessions.read"); requireAccess();
      const verification = object(input.verification);
      fields(verification, ["runId", "blockIds", "summary"]);
      if (!Array.isArray(verification.blockIds) || verification.blockIds.length > 100) throw new Error("Invalid verification evidence");
      result = await engine.botTaskWorktrees.integrate(session.session.id, {
        runId: id(verification.runId), summary: id(verification.summary, "verification summary", 4000),
        blockIds: verification.blockIds.map(value => id(value)),
      }, requireAccess);
    } else if (action === "sessions.update") {
      if (!session) throw new Error("Choose a session");
      const {
        projectId: _p,
        sessionId: _s,
        environmentId: _e,
        ...patch
      } = input;
      result = engine.updateSession(session.session.id, patch, persistResult);
    } else if (action === "sessions.delete") {
      if (!session) throw new Error("Choose a session");
      external = true;
      await engine.deleteSession(session.session.id);
      result = { deleted: true };
    } else if (action === "orchestration.worker") {
      const lead = engine.store.session(id(input.leadId));
      if (lead.projectId !== projectId)
        throw new Error("Worker belongs to another project");
      const run = engine.orchestration.scheduler.run(lead.session.id);
      if (
        !run ||
        engine.store.orchestration(lead.session.id)?.id !==
          input.orchestrationId
      )
        throw new Error("Orchestration generation changed");
      const workerAction = id(input.action, "worker action");
      if (
        ![
          "message",
          "steer",
          "respond",
          "answer",
          "retry",
          "cancel",
          "review",
          "finish",
          "get",
          "list",
        ].includes(workerAction)
      )
        throw new Error("Unsupported worker action");
      for (const extra of workerAction === "respond"
        ? ["sessions.approve"]
        : workerAction === "answer"
          ? ["sessions.answer"]
          : ["message", "steer", "retry"].includes(workerAction)
            ? ["sessions.send"]
            : workerAction === "cancel"
              ? ["sessions.cancel"]
              : [])
        additional.add(extra as BotPermission);
      requireAccess();
      const params = object(input.input ?? {});
      if ("taskId" in params && params.taskId !== input.taskId)
        throw new Error("Worker identity mismatch");
      if (
        input.playbooks !== undefined &&
        !["message", "steer", "retry"].includes(workerAction)
      )
        throw new Error("Only worker message, steer and retry accept playbooks");
      const workerInput =
        input.playbooks === undefined
          ? params
          : {
              ...params,
              // Worker text has a smaller scheduler limit than session sends.
              text: assignedPlaybookPrompt(
                params.text, input.playbooks, store.playbooks(), 30_000,
              ),
            };
      external = true;
      result = await engine.orchestration.scheduler.handle(
        lead.session.id,
        `assistant:${record.id}`,
        workerAction,
        { ...workerInput, ...(input.taskId ? { taskId: input.taskId } : {}) },
        () => {
          try {
            requireAccess();
            return true;
          } catch {
            return false;
          }
        },
        record.origin,
      );
      const task = engine.orchestration.scheduler
        .run(lead.session.id)
        ?.tasks.find((t) => t.id === input.taskId);
      if (task) {
        session = engine.store.session(task.sessionId);
        record.targetRef = {
          environmentId: engine.store.environmentId,
          projectId: session.projectId,
          sessionId: session.session.id,
        };
      }
    } else if (action === "sessions.steer") {
      if (!session) throw new Error("Choose a session");
      const text = id(input.text, "message", 1000000);
      const prompt =
        input.playbooks === undefined
          ? text
          : assignedPlaybookPrompt(text, input.playbooks, store.playbooks());
      external = true;
      result = await engine.assistantSteer(
        session.session.id,
        id(input.runId),
        prompt,
        record.origin,
        authorized,
      );
    } else if (mutationFields[action]) {
      if (!session) throw new Error("Choose a session");
      const type =
        action === "orchestration.command"
          ? "orchestration"
          : action.slice("sessions.".length);
      const { playbooks, ...commandInput } = input;
      if (playbooks !== undefined) {
        if (
          action !== "sessions.send" &&
          !(action === "sessions.queue" && input.action === "edit")
        )
          throw new Error("Only sends and queue edits accept playbooks");
        commandInput.text = assignedPlaybookPrompt(
          input.text, playbooks, store.playbooks(),
        );
      }
      const command = {
        ...commandInput,
        type,
        commandId: `assistant:${record.id}`,
      } as unknown as HostCommand;
      external = [
        "send",
        "compact",
        "approve",
        "answer",
        "cancel",
        "orchestration",
        "queue",
      ].includes(type);
      const queuedReason = action === "sessions.send" ? engine.assistantAdmission(session, record.origin) : undefined;
      result = engine.assistantCommand(command, record.origin);
      if (queuedReason) {
        store.message({ id: `queued:${record.id}`, kind: "status", wakeupId: wakeup.id, code: "task-queued", text: queuedReason });
        result = { ...(result as object), queued: true, reason: queuedReason };
      }
    } else {
      fields(input, ["projectId", "command", "args"]);
      if (!projectId) throw new Error("Choose a project");
      const command = Object.hasOwn(aliases, action)
        ? aliases[action]
        : id(input.command);
      const args = object(input.args ?? {}),
        project = engine.store.project(projectId);
      const workspace = new WorkspaceCommands(
        engine.store,
        (p, operate) => {
          requireAccess();
          checkPolicy(store.get()!.policy, permission, p);
          return engine.withIdleProject(p, async () => {
            requireAccess();
            return operate();
          });
        },
        (path) => {
          requireAccess();
          engine.assertWorkspaceWrite(path);
        },
      );
      const worktrees = await hostWorktrees(project.cwd)
        .then((value) => value.worktrees)
        .catch(() => []);
      const roots = await Promise.all(
        [
          project.cwd,
          ...worktrees.filter((w) => !w.missing).map((w) => w.path),
        ].map((p) => machineFs.realpath(p)),
      );
      const paths = [
        args.cwd,
        args.path,
        args.parent,
        args.from,
        args.destParent,
        ...(command === "search_project" ? [object(args.options).cwd] : []),
        ...(Array.isArray(args.paths) ? args.paths : []),
      ].filter((p) => p !== undefined);
      if (!paths.length) throw new Error("Workspace path is required");
      for (const path of paths) {
        const canonical = await workspace.resourcePath(path);
        requireAccess();
        if (!roots.some((root) => inRoot(canonical, root)))
          throw new Error("Workspace path belongs to another project");
      }
      requireAccess();
      if (permission.endsWith(".read")) result = await workspace.run(command, args);
      else {
        // A copy only mutates its destination. Git operations reserve their
        // checkout root because changing the index/branch affects every file.
        const inputs = command === "copy_path" ? [args.destParent]
          : command === "move_path" ? [args.from, args.destParent]
          : command === "create_path" ? [args.parent]
          : command === "rename_path" ? [args.path]
          : [args.cwd ?? args.path];
        const writes = await Promise.all(inputs.map((path) => workspace.resourcePath(path)));
        const reserved = command.startsWith("git_") ? writes.map((path) =>
          roots.filter((root) => inRoot(path, root)).sort((a, b) => b.length - a.length)[0] ?? path) : writes;
        result = await withHostResources(engine.store, resourceOwner, { paths: reserved }, async () => {
          requireAccess();
          external = true;
          return workspace.run(command, args);
        });
      }
    }
    if (!recorded) persistResult(result);
    if (action === "sessions.delete") assistant.refreshCards();
    requireAccess();
    return result;
  } catch (error) {
    if (!recorded)
      store.putAction({
        ...record,
        ...(store.action(requestId)?.worktree ? { worktree: store.action(requestId)!.worktree } : {}),
        state: external ? "unknown" : "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    throw error;
  }
}
