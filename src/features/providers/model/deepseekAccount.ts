import { useEffect, useState } from "react";
import { version } from "../../../../package.json";
import { parseDeepseekAccount, type DeepseekAccount } from "../../../integrations/harness/providers/deepseek/deepseekAccount";
import { knownRemoteMachine, remoteRequest, useRemoteMachines } from "../../connections/model/connections";
import { loadRemoteHostDescriptor } from "../../connections/model/remoteHostMetadata";
import { parseRemotePath } from "../../connections/model/remoteProjects";
import { providerUsageHost } from "./providerUsageSource";
import { RATE_LIMIT_POLL_MS } from "../../../domain/rateLimits";
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
  const [pollKey, setPollKey] = useState(0);
  useEffect(() => {
    if (!visible || !autoRefresh) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setPollKey(key => key + 1);
    }, RATE_LIMIT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, visible]);
  const [state, setState] = useState<DeepseekAccountState & { source: string }>({ source, loading: true });
  useEffect(() => {
    if (!visible) return;
    if (!machineId || !environmentId) {
      setState({ source, loading: false, error: usesSharedHost
        ? "Connect to the shared Host to view the DeepSeek account."
        : "Connect to the conversation's Host to view the DeepSeek account." });
      return;
    }
    let current = true;
    setState({ source, loading: true });
    void (async () => {
      try {
        const descriptor = await loadRemoteHostDescriptor(machineId, environmentId);
        if (!current) return;
        if (!descriptor.capabilities.includes("providerAccounts.deepseek.v1")) {
          setState({ source, loading: false, error: "Update and restart the Host to view the DeepSeek account." });
          return;
        }
        const account = parseDeepseekAccount(await remoteRequest(machineId, "providerAccounts.deepseek", {
          client: { version, locale: language, timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 },
        }));
        const host = usesSharedHost ? providerUsageHost()
          : { machineId: knownRemoteMachine(environmentId)?.id, environmentId };
        if (current && host?.machineId === machineId && host.environmentId === environmentId)
          setState({ source, loading: false, account });
      } catch {
        if (current) setState({ source, loading: false, error: "Unable to read the DeepSeek account. Check that DSH is installed and configured on Host, then refresh." });
      }
    })();
    return () => { current = false; };
  }, [machineId, environmentId, source, usesSharedHost, visible, language, refreshKey, pollKey]);
  return state.source === source ? state : { loading: !!target };
}
