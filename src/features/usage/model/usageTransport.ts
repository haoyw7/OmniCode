import type {
  UsageLimitSource,
  UsageSummary,
  UsageSummaryInput,
  UsageScanProgress,
} from "../../../integrations/harness/core/usage";
export interface UsageSettingsPatch {
  cursorKeychainEnabled?: boolean;
}
export interface UsageTransport {
  sourceKey: string;
  label?: string;
  enabled: boolean;
  summary: (input: UsageSummaryInput) => Promise<UsageSummary>;
  limits: (refresh: boolean) => Promise<UsageLimitSource[]>;
  update: (patch: UsageSettingsPatch) => Promise<unknown>;
  reset?: (accountId: string, creditId?: string) => Promise<unknown>;
  progress?: () => Promise<UsageScanProgress>;
}
