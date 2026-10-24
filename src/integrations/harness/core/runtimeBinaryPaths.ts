import type { HarnessId } from '../../../contracts/session';


export type ConfigurableBinaryProvider = HarnessId;


export type StoredBinaryPaths = Partial<Record<ConfigurableBinaryProvider, string>>;


let runtimeBinaryPaths: StoredBinaryPaths = {};


export function runtimeProviderBinaryPath(
  provider: ConfigurableBinaryProvider,
): string | null {
  const path = runtimeBinaryPaths[provider];
  return typeof path === "string" && path.trim() ? path.trim() : null;
}
/** Only the runtime owner supplies active paths; adapters never read UI preferences. */
export function configureRuntimeBinaryPaths(paths: StoredBinaryPaths): void {
  runtimeBinaryPaths = { ...paths };
}
