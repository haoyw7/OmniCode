import { configureRuntimeBinaryPaths, type StoredBinaryPaths } from '../../../integrations/harness/core/runtimeBinaryPaths';
import { ConfigurableBinaryProvider, runtimeProviderBinaryPath } from '../../../integrations/harness/core/runtimeBinaryPaths';
import { activateDesktopProviderBinaryPaths } from "../../../platform/tauri/connections";

const STORAGE_KEY = "omnicode.providerBinaryPaths.v1";

function readProviderBinaryPaths(): StoredBinaryPaths {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value).filter(([, path]) => typeof path === "string"),
    ) as StoredBinaryPaths;
  } catch {
    return {};
  }
}

export async function initializeProviderBinaryPaths(): Promise<void> {
  const active: StoredBinaryPaths = await activateDesktopProviderBinaryPaths(
    readProviderBinaryPaths() as Record<string, string>,
  );
  configureRuntimeBinaryPaths(active);
}

export function loadProviderBinaryPath(
  provider: ConfigurableBinaryProvider,
): string | null {
  const path = readProviderBinaryPaths()[provider];
  return typeof path === "string" && path.trim() ? path.trim() : null;
}

export function providerBinaryPathChangePending(
  provider: ConfigurableBinaryProvider,
): boolean {
  return runtimeProviderBinaryPath(provider) !== loadProviderBinaryPath(provider);
}

export function saveProviderBinaryPath(
  provider: ConfigurableBinaryProvider,
  path: string | null,
): boolean {
  try {
    const stored = readProviderBinaryPaths();
    const value = path?.trim();
    if (value) stored[provider] = value;
    else delete stored[provider];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

configureRuntimeBinaryPaths(readProviderBinaryPaths());
