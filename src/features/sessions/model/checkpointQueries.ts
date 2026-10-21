import { queryOptions } from "@tanstack/react-query";
import { sessionCheckpointStatus } from "./checkpoint";

export const checkpointKeys = {
  status: (sessionId: string, cwd: string, turnId?: string) =>
    ["checkpoint", "status", sessionId, cwd, turnId ?? null] as const,
};

export const checkpointStatusQuery = (sessionId: string, cwd: string, turnId?: string) => queryOptions({
  queryKey: checkpointKeys.status(sessionId, cwd, turnId),
  queryFn: ({ signal }) => {
    signal.throwIfAborted();
    return turnId
      ? sessionCheckpointStatus(sessionId, cwd, undefined, turnId)
      : sessionCheckpointStatus(sessionId, cwd);
  },
  retry: 3,
  retryDelay: (attempt) => 500 * 2 ** attempt,
});
