import { useEffect, useState } from "react";
import { version } from "../../../../package.json";
import { parseDeepseekAccount, type DeepseekAccount } from "../../../integrations/harness/providers/deepseek/deepseekAccount";
import { remoteRequest } from "../../connections/model/connections";
import { loadRemoteHostDescriptor } from "../../connections/model/remoteHostMetadata";
import { providerUsageHost } from "./providerUsageSource";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { useTranslation } from "../../../shared/i18n/useTranslation";

export type DeepseekAccountState = {
  account?: DeepseekAccount;
  loading: boolean;
  error?: string;
};

export function useDeepseekAccount(refreshKey: number): DeepseekAccountState {
  const { language } = useTranslation();
  const visible = useSurfaceVisibility();
  const target = providerUsageHost();
  const machineId = target?.machineId, environmentId = target?.environmentId;
  const source = JSON.stringify([machineId, environmentId]);
  const [state, setState] = useState<DeepseekAccountState & { source: string }>({ source, loading: true });
  useEffect(() => {
    if (!visible) return;
    if (!machineId || !environmentId) {
      setState({ source, loading: false, error: "Connect to the shared Host to view the DeepSeek account." });
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
        const host = providerUsageHost();
        if (current && host?.machineId === machineId && host.environmentId === environmentId)
          setState({ source, loading: false, account });
      } catch {
        if (current) setState({ source, loading: false, error: "Unable to read the DeepSeek account. Check that DSH is installed and configured on Host, then refresh." });
      }
    })();
    return () => { current = false; };
  }, [machineId, environmentId, source, visible, language, refreshKey]);
  return state.source === source ? state : { loading: !!target };
}
