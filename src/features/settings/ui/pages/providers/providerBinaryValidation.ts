import type { HarnessBinaryInspection } from "../../../../../contracts/providerRuntime";
import { compareSemver, MINIMUM_OPENCODE_VERSION, parseOpenCodeVersion } from "../../../../../integrations/harness/providers/opencode/opencodeProtocol";
import type { ConfigurableBinaryProvider } from "../../../../../integrations/harness/core/runtimeBinaryPaths";

/** Why a resolved CLI cannot be used, or null when it can. */
export function binaryInspectionError(
  provider: ConfigurableBinaryProvider,
  inspection: HarnessBinaryInspection,
): string | null {
  if (inspection.error) return inspection.error;
  if (
    provider === "codex" &&
    !/^codex-cli\s+\d+\.\d+\.\d+/.test(inspection.version ?? "")
  ) {
    return "Codex CLI returned an invalid version.";
  }
  if (provider === "opencode") {
    const version = parseOpenCodeVersion(inspection.version ?? "");
    if (!version) return "OpenCode CLI returned an invalid version.";
    if (compareSemver(version, MINIMUM_OPENCODE_VERSION) < 0) {
      return `OpenCode v${version} is too old. Upgrade to v${MINIMUM_OPENCODE_VERSION} or newer.`;
    }
  }
  return null;
}
