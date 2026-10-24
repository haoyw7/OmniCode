import type { HarnessId } from "../../../contracts/session";
import { HOST_PROVIDER_LOGIN_CAPABILITY, type HostProviderLoginStatus } from "../../../contracts/providerLogin";
import { loadRemoteHostDescriptor } from "../../connections/model/remoteHostMetadata";
import { remoteRequest } from "../../connections/model/connections";
import { sharedHostEnvironment, sharedHostMachineId } from "../../connections/model/remoteProjects";
import { loginProviderAccount } from "./providerAccountCredentials";
import { supportsProviderAccounts } from "./providerAccounts";
import { supportsHarnessLogin } from "../../../integrations/harness/core/authSupport";
import { translate } from "../../../shared/i18n/language";

const inflight = new Map<string, Promise<void>>();

/** A browser observes the Host-owned login; it never launches a provider. */
export function loginHarness(harness: HarnessId, accountId?: string): Promise<void> {
  const key = `${harness}:${accountId ?? "default"}`;
  const current = inflight.get(key);
  if (current) return current;
  const login = supportsProviderAccounts(harness)
    ? loginProviderAccount(harness, accountId ?? "default")
    : loginSingleProfile(harness, accountId);
  const run = login.finally(() => { if (inflight.get(key) === run) inflight.delete(key); });
  inflight.set(key, run);
  return run;
}

async function loginSingleProfile(harness: HarnessId, accountId?: string): Promise<void> {
  if (harness === "workbuddy") throw new Error(translate("Manage this login in WorkBuddy on the execution machine"));
  if (!supportsHarnessLogin(harness)) throw new Error(translate("This provider does not offer a single browser sign-in flow."));
  const machineId = sharedHostMachineId(), environmentId = sharedHostEnvironment();
  if (!machineId || !environmentId) throw new Error(translate("Connect to the shared Host to sign in."));
  const descriptor = await loadRemoteHostDescriptor(machineId, environmentId);
  if (!descriptor.capabilities.includes(HOST_PROVIDER_LOGIN_CAPABILITY)) throw new Error(translate("Update the Host to sign in to this provider."));
  let status = await remoteRequest<HostProviderLoginStatus>(machineId, "providers.loginStart", {
    provider: harness, operationId: crypto.randomUUID(), ...(accountId ? { accountId } : {}),
  });
  const deadline = Date.now() + 11 * 60_000;
  while (status.status === "running" && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1_000));
    status = await remoteRequest<HostProviderLoginStatus>(machineId, "providers.loginStatus", { id: status.id });
  }
  if (status.status !== "succeeded") throw new Error(status.error || translate("Provider sign-in timed out"));
}
