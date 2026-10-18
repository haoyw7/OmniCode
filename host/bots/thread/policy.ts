import {
  BOT_PERMISSIONS,
  type BotPermission,
  type BotPolicy,
} from "../../../src/features/bots/model/botView";
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object");
  return value as Record<string, unknown>;
}
export function fields(
  value: Record<string, unknown>,
  allowed: string[],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("Unknown input field");
}
export function id(value: unknown, label = "ID", max = 128): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    value.includes("\0")
  )
    throw new Error(`Invalid ${label}`);
  return value;
}
export function validatePolicy(value: unknown): BotPolicy {
  const v = object(value);
  fields(v, [
    "permissions",
    "allowedProjects",
    "followedSessions",
    "followedProjects",
    "excludedSessionIds",
  ]);
  const permissions = object(v.permissions);
  fields(permissions, [...BOT_PERMISSIONS]);
  for (const setting of Object.values(permissions))
    if (typeof setting !== "boolean") throw new Error("Invalid permission");
  if (
    v.allowedProjects !== "all" &&
    (!Array.isArray(v.allowedProjects) || v.allowedProjects.length > 1000)
  )
    throw new Error("Invalid project scope");
  const followedSessions = v.followedSessions;
  if (
    followedSessions !== undefined &&
    (!Array.isArray(followedSessions) || followedSessions.length > 10000)
  )
    throw new Error("Invalid conversation grants");
  const followedProjects = v.followedProjects;
  if (
    followedProjects !== undefined &&
    followedProjects !== "all" &&
    (!Array.isArray(followedProjects) || followedProjects.length > 1000)
  )
    throw new Error("Invalid followed projects");
  const excludedSessionIds = v.excludedSessionIds;
  if (
    excludedSessionIds !== undefined &&
    (!Array.isArray(excludedSessionIds) || excludedSessionIds.length > 10000)
  )
    throw new Error("Invalid conversation exclusions");
  return {
    ...(followedProjects === undefined
      ? {}
      : {
          followedProjects:
            followedProjects === "all"
              ? ("all" as const)
              : (followedProjects as unknown[]).map((value) =>
                  id(value, "project"),
                ),
        }),
    ...(excludedSessionIds === undefined
      ? {}
      : {
          excludedSessionIds: (excludedSessionIds as unknown[]).map((value) =>
            id(value, "session"),
          ),
        }),
    ...(followedSessions === undefined
      ? {}
      : {
          followedSessions: (followedSessions as unknown[]).map((value) => {
            const ref = object(value);
            fields(ref, ["projectId", "sessionId"]);
            return {
              projectId: id(ref.projectId, "project"),
              sessionId: id(ref.sessionId, "session"),
            };
          }),
        }),
    permissions: Object.fromEntries(
      BOT_PERMISSIONS.map((key) => [key, permissions[key] === true]),
    ) as BotPolicy["permissions"],
    allowedProjects:
      v.allowedProjects === "all"
        ? "all"
        : (v.allowedProjects as unknown[]).map((v) => id(v, "project")),
  };
}
export function checkPolicy(
  policy: BotPolicy,
  permission: BotPermission,
  projectId?: string,
): void {
  if (!policy.permissions[permission])
    throw new Error(`Permission denied: ${permission}`);
  if (
    projectId &&
    policy.allowedProjects !== "all" &&
    !policy.allowedProjects.includes(projectId)
  )
    throw new Error("Project scope denied");
}
const commands: Record<string, BotPermission> = {};
for (const key of [
  "list_dir",
  "list_project_files",
  "read_text_file",
  "read_binary_file",
  "read_file_preview",
  "stat_files",
  "search_project",
])
  commands[key] = "files.read";
for (const key of [
  "write_text_file",
  "create_path",
  "rename_path",
  "delete_path",
  "copy_path",
  "move_path",
])
  commands[key] = "files.write";
for (const key of [
  "git_diff_index",
  "git_diff_files",
  "git_diff_stats",
  "git_file_diff",
  "git_base_diff_files",
  "git_base_file_diff",
  "git_head_message",
  "git_pr_status",
  "git_history",
  "git_commit_files",
  "git_commit_file_diff",
  "git_staged_context",
  "git_range_context",
  "git_branches",
  "git_worktrees",
])
  commands[key] = "git.read";
for (const key of [
  "git_stage_contents",
  "git_stage_file",
  "git_unstage_file",
  "git_discard_file",
  "git_discard_all",
  "git_stage_all",
  "git_unstage_all",
  "git_commit",
  "git_checkout",
  "git_create_branch",
  "git_stash",
])
  commands[key] = "git.write";
for (const key of ["git_push", "git_pull", "git_sync", "git_pr_create"])
  commands[key] = "git.publish";
export function workspacePermission(command: string): BotPermission {
  if (!Object.hasOwn(commands, command))
    throw new Error("Unsupported workspace command");
  return commands[command];
}
export function actionPermission(action: string): BotPermission {
  if (["agents.list", "models.list"].includes(action)) return "catalog.read";
  if (action === "projects.list") return "projects.read";
  if (action === "projects.open") return "projects.open";
  if (
    [
      "sessions.list",
      "sessions.get",
      "sessions.activity",
      "orchestration.get",
    ].includes(action)
  )
    return "sessions.read";
  if (["sessions.send", "sessions.steer"].includes(action))
    return "sessions.send";
  if (action === "sessions.compact") return "sessions.configure";
  if (action === "sessions.update") return "sessions.metadata";
  if (action.startsWith("orchestration.")) return "orchestration.control";
  if ((BOT_PERMISSIONS as readonly string[]).includes(action))
    return action as BotPermission;
  throw new Error("Unsupported assistant action");
}
