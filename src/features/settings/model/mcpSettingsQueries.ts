import { invokeMcp } from "../../../platform/tauri/mcp";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { parseClaudeMcpList, type McpConnection } from "./mcp";
import { piMcpHealth, type PiMcpList } from "../../../integrations/harness/providers/pi/piMcp";

export type McpServerRow = McpConnection & { status: string };
export type McpSettingsSnapshot = {
  servers: McpServerRow[];
  error: string;
  claudeError: string;
  piError: string;
};
type Discovery = { servers: McpServerRow[]; revision: number };
type HealthOptions = { claudeHealth?: boolean; piHealth?: boolean };

let revision = 0;
const queuedRefreshes = new Map<string, Promise<McpSettingsSnapshot>>();
export const mcpKeys = {
  all: ["mcpSettings"] as const,
  discovery: (cwd: string) => ["mcpSettings", cwd, "discovery"] as const,
  health: (cwd: string, version: number, provider: string) => ["mcpSettings", cwd, "health", version, provider] as const,
};

export function mcpSettingsQuery(cwd: string) {
  return queryOptions({
    queryKey: mcpKeys.discovery(cwd),
    staleTime: Infinity,
    gcTime: Infinity,
    retryOnMount: false,
    queryFn: async (): Promise<Discovery> => {
      const configured = await invokeMcp<McpConnection[]>("mcp_discover", { cwd });
      return {
        revision: ++revision,
        servers: configured.map((server) => ({
          ...server,
          ...(server.provider === "pi" ? { nativeState: server.enabled === false ? "disabled" as const : "checking" as const } : {}),
          status: server.enabled === false ? "Disabled" : server.provider === "pi" ? "Checking connection…" : "Configured",
        })),
      };
    },
  });
}

export const mcpClaudeHealthQuery = (cwd: string, version: number) => queryOptions({
  queryKey: mcpKeys.health(cwd, version, "claude"),
  staleTime: Infinity,
  queryFn: () => invokeMcp<string>("claude_mcp_list", { cwd }),
});
export const mcpPiHealthQuery = (cwd: string, version: number) => queryOptions({
  queryKey: mcpKeys.health(cwd, version, "pi"),
  staleTime: Infinity,
  queryFn: () => invokeMcp<PiMcpList>("pi_mcp_list", { cwd }),
});

function snapshot(
  discovery: Discovery | undefined,
  error: unknown,
  claude?: string,
  claudeError?: unknown,
  pi?: PiMcpList,
  piError?: unknown,
): McpSettingsSnapshot {
  const health = new Map(parseClaudeMcpList(claude ?? "").map((server) => [server.name, server.status]));
  const servers: McpServerRow[] = (discovery?.servers ?? []).map((server) => {
    if (server.provider === "pi") {
      if (pi) return { ...server, ...piMcpHealth(server, pi) };
      if (piError && server.enabled !== false) return { ...server, nativeState: "unavailable", status: "Status unavailable" };
    }
    return { ...server, status: server.enabled === false ? "Disabled"
      : server.provider === "claude" ? health.get(server.name) ?? server.status : server.status };
  });
  for (const [name, status] of health) {
    if (!servers.some((server) => server.provider === "claude" && server.name === name)) {
      servers.push({ provider: "claude", name, scope: "local", configPath: "", transport: "", status });
    }
  }
  return {
    servers,
    error: error ? String(error) : "",
    claudeError: claudeError ? String(claudeError) : "",
    piError: piError ? String(piError) : pi ? [...pi.errors, ...(pi.note ? [pi.note] : [])].join("\n") : "",
  };
}

export function getCachedMcpSettings(cwd: string): McpSettingsSnapshot | undefined {
  const discovery = queryClient.getQueryState<Discovery>(mcpKeys.discovery(cwd));
  if (!discovery?.data && !discovery?.error) return undefined;
  const version = discovery.data?.revision ?? 0;
  const claude = queryClient.getQueryState<string>(mcpClaudeHealthQuery(cwd, version).queryKey);
  const pi = queryClient.getQueryState<PiMcpList>(mcpPiHealthQuery(cwd, version).queryKey);
  return snapshot(discovery.data, discovery.error, claude?.data, claude?.error, pi?.data, pi?.error);
}

/** Discovery renders immediately; each requested health query runs independently. */
export function useMcpSettings(cwd: string, enabled = true, options: HealthOptions = {}) {
  const discovery = useQuery({ ...mcpSettingsQuery(cwd), enabled }, queryClient);
  const version = discovery.data?.revision ?? 0;
  const healthEnabled = enabled && !!discovery.data && !discovery.isError;
  const claude = useQuery({
    ...mcpClaudeHealthQuery(cwd, version),
    enabled: healthEnabled && options.claudeHealth !== false,
  }, queryClient);
  const pi = useQuery({
    ...mcpPiHealthQuery(cwd, version),
    enabled: healthEnabled && (options.piHealth === true || (options.piHealth !== false && !!discovery.data?.servers.some((server) => server.provider === "pi"))),
  }, queryClient);
  return {
    ...snapshot(discovery.data, discovery.error, claude.data, claude.error, pi.data, pi.error),
    loading: enabled && discovery.isPending,
    fetching: discovery.isFetching,
  };
}

/** Imperative prefetch/refresh for mutations and non-rendering consumers. */
export function loadMcpSettings(cwd: string, force = false, options: HealthOptions = {}): Promise<McpSettingsSnapshot> {
  const queryOptions = mcpSettingsQuery(cwd);
  const query = queryClient.getQueryCache().find({ queryKey: queryOptions.queryKey, exact: true });
  if (force && query?.state.fetchStatus === "fetching") {
    const queued = queuedRefreshes.get(cwd);
    if (queued) return queued;
    const next = query.promise!.catch(() => undefined).then(() =>
      queryClient.getQueryCache().find({ queryKey: queryOptions.queryKey, exact: true }) === query
        ? loadMcpSettings(cwd, true, options) : snapshot(undefined, undefined));
    queuedRefreshes.set(cwd, next);
    void next.finally(() => { if (queuedRefreshes.get(cwd) === next) queuedRefreshes.delete(cwd); });
    return next;
  }
  if (force) void queryClient.invalidateQueries({ queryKey: queryOptions.queryKey, exact: true, refetchType: "none" });
  return queryClient.fetchQuery(queryOptions).then((discovery) => {
    // A cleared/replaced query must not start health for an obsolete discovery.
    if (queryClient.getQueryData(queryOptions.queryKey)?.revision === discovery.revision) {
      if (options.claudeHealth !== false) {
        void queryClient.fetchQuery(mcpClaudeHealthQuery(cwd, discovery.revision)).catch(() => {});
      }
      if (options.piHealth === true || (options.piHealth !== false && discovery.servers.some((server) => server.provider === "pi"))) {
        void queryClient.fetchQuery(mcpPiHealthQuery(cwd, discovery.revision)).catch(() => {});
      }
    }
    return getCachedMcpSettings(cwd) ?? snapshot(discovery, undefined);
  }).catch((error) => getCachedMcpSettings(cwd) ?? snapshot(undefined, error));
}

export function clearMcpSettingsCache() {
  queryClient.removeQueries({ queryKey: mcpKeys.all });
  queuedRefreshes.clear();
}
