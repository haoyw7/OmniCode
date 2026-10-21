import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, invalidateAfterChange } from "../../../shared/lib/queryClient";
import { version } from "../../../../package.json";
import { parseDeepseekAccount, type DeepseekAccount } from "../../../integrations/harness/providers/deepseek/deepseekAccount";
import { knownRemoteMachine, remoteRequest, useRemoteMachines } from "../../connections/model/connections";
import { loadRemoteHostDescriptor } from "../../connections/model/remoteHostMetadata";
import { parseRemotePath } from "../../connections/model/remoteProjects";
import { providerUsageHost } from "./providerUsageSource";
import { RATE_LIMIT_POLL_MS } from "./rateLimits";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { useTranslation } from "../../../shared/i18n/useTranslation";

export type DeepseekAccountState = {
  account?: DeepseekAccount;
  loading: boolean;
  error?: string;
};

export function useDeepseekAccount(
  refreshKey: number,
  { project, autoRefresh = false }: { project?: string; autoRefresh?: boolean } = {},
): DeepseekAccountState {
  const { language } = useTranslation();
  const visible = useSurfaceVisibility();
  const remote = project ? parseRemotePath(project) : undefined;
  const shared = providerUsageHost();
  const usesSharedHost = !remote || remote.environmentId === shared?.environmentId;
  const { machines } = useRemoteMachines(visible && !usesSharedHost);
  const machine = remote ? machines.find(entry => entry.environmentId === remote.environmentId) : undefined;
  const target = usesSharedHost ? shared
    : machine && { machineId: machine.id, environmentId: machine.environmentId };
  const machineId = target?.machineId, environmentId = target?.environmentId;
  const source = JSON.stringify([remote?.environmentId, machineId, environmentId]);
  const queryKey = ["deepseekAccount", source, language] as const;
  const read = useQuery({
    queryKey, enabled: visible && !!machineId && !!environmentId,
    refetchInterval: visible && autoRefresh ? RATE_LIMIT_POLL_MS : false,
    queryFn: async ({ signal }) => {
      const descriptor = await loadRemoteHostDescriptor(machineId!, environmentId!);
      signal.throwIfAborted();
      if (!descriptor.capabilities.includes("providerAccounts.deepseek.v1"))
        throw new Error("Update and restart the Host to view the DeepSeek account.");
      try {
        const account = parseDeepseekAccount(await remoteRequest(machineId!, "providerAccounts.deepseek", {
          client: { version, locale: language, timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 },
        }));
        signal.throwIfAborted();
        const host = usesSharedHost ? providerUsageHost() : { machineId: knownRemoteMachine(environmentId!)?.id, environmentId };
        if (!host || host.machineId !== machineId || host.environmentId !== environmentId) throw new Error("Host changed");
        return account;
      } catch {
        throw new Error("Unable to read the DeepSeek account. Check that DSH is installed and configured on Host, then refresh.");
      }
    },
  }, queryClient);
  const previousRefresh = useRef(refreshKey);
  useEffect(() => { if (!visible) void queryClient.cancelQueries({ queryKey }); }, [visible, source, language]);
  useEffect(() => {
    if (previousRefresh.current === refreshKey) return;
    previousRefresh.current = refreshKey;
    void invalidateAfterChange(queryKey);
  }, [refreshKey, source, language]);
  if (!target) return { loading: false, error: usesSharedHost ? "Connect to the shared Host to view the DeepSeek account." : "Connect to the conversation's Host to view the DeepSeek account." };
  return { loading: read.isFetching, account: read.isSuccess ? read.data : undefined, error: read.error ? read.error.message : undefined };
}
