import type { BotActivity } from "./botView";

export type ActivityLabel = { key: string; params?: Record<string, string> };

/** Describes the assistant's current platform action in plain words. */
export function botActivityLabel(
  activity: BotActivity | undefined,
  taskLanguage = false,
): ActivityLabel {
  const action = activity?.action ?? "";
  const project = activity?.projectName;
  const title = activity?.sessionTitle;
  if (taskLanguage && action === "sessions.create") return { key: "Starting work…" };
  if (taskLanguage && ["sessions.send", "sessions.steer", "sessions.queue"].includes(action))
    return project ? { key: "Continuing work in {project}…", params: { project } } : { key: "Continuing the work…" };
  if (taskLanguage && ["sessions.get", "sessions.activity"].includes(action)) return { key: "Checking progress…" };
  if (action === "sessions.create")
    return project
      ? { key: "Starting a conversation in {project}…", params: { project } }
      : { key: "Starting a conversation…" };
  if (action === "sessions.send" || action === "sessions.steer")
    return title
      ? { key: "Handing the task to {title}…", params: { title } }
      : { key: "Handing off the task…" };
  if (action === "sessions.get" || action === "sessions.activity")
    return title
      ? { key: "Reading {title}…", params: { title } }
      : { key: "Reading the conversation…" };
  if (
    action.startsWith("projects.") ||
    action === "sessions.list" ||
    action === "agents.list" ||
    action === "models.list"
  )
    return { key: "Looking through your projects…" };
  if (action.startsWith("files.")) return { key: "Going through the files…" };
  if (action.startsWith("git.")) return { key: "Checking Git status…" };
  if (action.startsWith("orchestration."))
    return { key: "Coordinating the agents…" };
  if (action === "reminders.create") return { key: "Noting a follow-up…" };
  if (action === "chat.search")
    return { key: "Looking back through our chat…" };
  if (action.startsWith("playbooks."))
    return { key: "Going through my playbooks…" };
  if (action.startsWith("memory.")) return { key: "Updating my notes…" };
  return { key: "Working…" };
}
