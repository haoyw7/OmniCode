import type {
  BotPermission,
  BotPolicy,
  BotWatch,
} from "./botView";

export function isExplicitlyWatchedSession(
  policy: BotPolicy,
  projectId: string,
  sessionId: string,
): boolean {
  return !!policy.followedSessions?.some(
    (ref) => ref.projectId === projectId && ref.sessionId === sessionId,
  );
}

/** Configured permission switches and project scope remain authoritative. */
export function hasBotPermission(
  policy: BotPolicy,
  permission: BotPermission,
  projectId?: string,
): boolean {
  return (
    !!policy.permissions[permission] &&
    (!projectId ||
      policy.allowedProjects === "all" ||
      policy.allowedProjects.includes(projectId))
  );
}

/** Empty event filters cover managed conversations, never grant new access. */
export function watchIncludesSession(
  watch: BotWatch,
  projectId: string,
  sessionId: string,
  managed = false,
): boolean {
  return (
    watch.enabled &&
    (!watch.projectIds.length || watch.projectIds.includes(projectId)) &&
    (watch.sessionIds.includes(sessionId) ||
      (!watch.sessionIds.length && managed))
  );
}

export function isWatchedSession(
  policy: BotPolicy,
  watches: BotWatch[],
  projectId: string,
  sessionId: string,
): boolean {
  return (
    !policy.excludedSessionIds?.includes(sessionId) &&
    (isExplicitlyWatchedSession(policy, projectId, sessionId) ||
      policy.followedProjects === "all" ||
      !!policy.followedProjects?.includes(projectId) ||
      watches.some((watch) =>
        watchIncludesSession(watch, projectId, sessionId),
      ))
  );
}

/** Re-following a scope clears previous exceptions only inside that scope. */
export function followSessionProjects(
  policy: BotPolicy,
  projectIds: "all" | string[],
  sessions: { id: string; projectId: string }[],
): BotPolicy {
  const selected = new Set(projectIds === "all" ? [] : projectIds);
  const restored = new Set(
    sessions.filter((s) => selected.has(s.projectId)).map((s) => s.id),
  );
  return {
    ...policy,
    followedProjects: projectIds === "all" ? "all" : [...selected],
    excludedSessionIds:
      projectIds === "all"
        ? []
        : policy.excludedSessionIds?.filter((id) => !restored.has(id)),
  };
}

export function followSession(
  policy: BotPolicy,
  projectId: string,
  sessionId: string,
): BotPolicy {
  return {
    ...policy,
    followedSessions: isExplicitlyWatchedSession(policy, projectId, sessionId)
      ? policy.followedSessions
      : [...(policy.followedSessions ?? []), { projectId, sessionId }],
    excludedSessionIds: policy.excludedSessionIds?.filter(
      (id) => id !== sessionId,
    ),
  };
}

/** Removing the last explicit watch must not turn it into a project-wide watch. */
export function removeWatchedSession(
  policy: BotPolicy,
  watches: BotWatch[],
  sessionId: string,
) {
  return {
    policy: {
      ...policy,
      followedSessions: policy.followedSessions?.filter(
        (ref) => ref.sessionId !== sessionId,
      ),
      excludedSessionIds: [
        ...new Set([...(policy.excludedSessionIds ?? []), sessionId]),
      ],
    },
    watches: watches.map((watch) => ({
      ...watch,
      sessionIds: watch.sessionIds.filter((id) => id !== sessionId),
    })),
  };
}
