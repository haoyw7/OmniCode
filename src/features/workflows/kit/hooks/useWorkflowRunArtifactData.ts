import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { invalidateAfterChange, queryClient } from "../../../../shared/lib/queryClient";
import { translate } from "../../../../shared/i18n/language";
import { workflowQueryScope } from "../../model/workflowQueryKeys";
import { WORKFLOW_ARTIFACT_LIMITS } from "../_shims/protocol.js";
import type { ArtifactItem } from "../app-shell/workflow-artifacts/presets/index.js";
import { logger } from "../logger.js";
import { useV4Conversation } from "../v4/V4ConversationContext.js";

const MAX_PAGES_PER_DRAIN = 16;
type ArtifactData = { items: readonly ArtifactItem[]; unavailable: boolean };
const EMPTY_ITEMS: readonly ArtifactItem[] = [];

/** Journal rows are authoritative; live itemCount is only a refresh signal. */
export function useWorkflowRunArtifactData(options: {
  sessionId: string;
  runId: string;
  artifactId: string;
  itemCount?: number;
  enabled?: boolean;
}) {
  const { workflowRunArtifactData } = useV4Conversation();
  const { artifactId, runId, sessionId } = options;
  const enabled = options.enabled !== false && !!sessionId && !!runId && !!artifactId;
  const queryKey = [...workflowQueryScope(workflowRunArtifactData), "items", sessionId, runId, artifactId] as const;
  const key = JSON.stringify(queryKey);
  const query = useQuery({
    queryKey,
    enabled,
    gcTime: 0,
    staleTime: Infinity,
    queryFn: async ({ signal }): Promise<ArtifactData> => {
      const previous = queryClient.getQueryData<ArtifactData>(queryKey)?.items ?? EMPTY_ITEMS;
      const items = new Map(previous.map(item => [item.sequence, item]));
      let cursor = previous.at(-1)?.sequence;
      try {
        for (let page = 0; page < MAX_PAGES_PER_DRAIN; page++) {
          signal.throwIfAborted();
          const result = await workflowRunArtifactData({
            sessionId, runId, artifactId,
            ...(cursor === undefined ? {} : { afterSequence: cursor }),
            limit: WORKFLOW_ARTIFACT_LIMITS.defaultItemsPerPage,
          });
          signal.throwIfAborted();
          for (const item of result.items) items.set(item.sequence, item);
          if (!result.hasMore || result.items.length === 0) {
            return { items: [...items.values()].sort((a, b) => a.sequence - b.sequence), unavailable: false };
          }
          const next = result.items.at(-1)?.sequence;
          if (next === undefined || (cursor !== undefined && next <= cursor)) break;
          cursor = next;
        }
        throw new Error(translate("Workflow artifact data is incomplete."));
      } catch (caught) {
        if (signal.aborted) throw caught;
        const message = caught instanceof Error ? caught.message : String(caught);
        if (message.includes("capabilityUnsupported") || message.includes("ArtifactItems")) {
          return { items: previous, unavailable: true };
        }
        logger.warn("[workflow-artifacts] 读取看板条目失败", { artifactId, error: message, runId, sessionId });
        throw caught;
      }
    },
  }, queryClient);

  const lastSignal = useRef<{ key: string; count: number } | undefined>(undefined);
  const count = options.itemCount ?? 0;
  useEffect(() => {
    const previous = lastSignal.current;
    lastSignal.current = enabled ? { key, count } : undefined;
    if (!enabled) {
      if (!queryClient.getQueryCache().find({ queryKey, exact: true })?.isActive()) queryClient.removeQueries({ queryKey, exact: true });
      return;
    }
    if (previous?.key !== key || previous.count === count) return;
    let disposed = false;
    // A new signal while draining must be followed up. Replaced effects cancel
    // only the queued refresh, so rapid signals coalesce without parallel reads.
    const pending = queryClient.getQueryCache().find({ queryKey, exact: true });
    void (async () => {
      if (pending?.state.fetchStatus === "fetching") await pending.promise?.catch(() => {});
      if (!disposed) await invalidateAfterChange(queryKey);
    })();
    return () => { disposed = true; };
  }, [key, count, enabled]);

  return {
    items: enabled ? query.data?.items ?? EMPTY_ITEMS : EMPTY_ITEMS,
    loading: enabled && query.isFetching,
    unavailable: enabled && !!query.data?.unavailable,
    error: enabled && query.error ? String(query.error).replace(/^Error: /, "") : null,
  };
}
