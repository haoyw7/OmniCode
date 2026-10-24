import type { HarnessId } from "../../../contracts/session";
import { HOST_PROVIDER_LOGIN_CAPABILITY } from "../../../contracts/providerLogin";
import { supportsHarnessLogin } from "../../../integrations/harness/core/authSupport";
import { useSharedHostCapability } from "../../connections/model/useSharedHostCapability";
import { supportsProviderAccounts } from "./providerAccounts";

export function useProviderSignInSupport(harness: HarnessId): boolean {
  return useSharedHostCapability(supportsHarnessLogin(harness)
    ? supportsProviderAccounts(harness) ? "providerAccounts.manage.v1" : HOST_PROVIDER_LOGIN_CAPABILITY
    : undefined);
}
