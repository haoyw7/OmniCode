import { loadRemoteHostDescriptor } from '../../connections/model/remoteHostMetadata';
import { sharedHostMachineId, sharedHostEnvironment } from '../../connections/model/remoteProjects';
import { type HarnessId, HARNESSES } from "../../../contracts/session";

import { emitHarnessAvailability, harnessAvailabilityProbedAt, markHarnessAvailabilityProbed, setHarnessAvailability, type HarnessAvailability } from "./harnessAvailabilityState";

export {
  getHarnessAvailabilitySnapshot,
  hasProbedHarnessAvailability,
  isHarnessAvailable,
  subscribeHarnessAvailability,
} from "./harnessAvailabilityState";

/**
 * We only ever check whether the binary exists, never whether it is
 * authenticated, so the hint must not blame a login.
 */
const CLI: Record<HarnessId, { name: string; install?: string }> = {
  deepseek: { name: "DeepSeek Harness (dsh)", install: "npm install -g @deepseek-ai/dsh@0.2.1-rc.2" },
  workbuddy: { name: "WorkBuddy" },
  claude: { name: "Claude Code CLI" },
  codex: { name: "Codex CLI" },
  cursor: { name: "Cursor CLI" },
  grok: {
    name: "Grok Build CLI",
    install: "curl -fsSL https://x.ai/cli/install.sh | bash",
  },
  opencode: { name: "OpenCode CLI" },
  pi: { name: "Pi CLI", install: "npm i -g @earendil-works/pi-coding-agent" },
  omp: { name: "omp CLI", install: "curl -fsSL https://omp.sh/install | sh" },
  fx: { name: "fx CLI", install: "curl -fsSL https://fx.sh/setup.sh | bash" },
  hermes: {
    name: "Hermes Agent CLI",
    install:
      "Install from hermes-agent.nousresearch.com, then run hermes model",
  },
  antigravity: { name: "Antigravity ACP server (agy_acp_server.par)" },
};

let inflight: Promise<void> | null = null;

/**
 * A probe stats ~100 paths across the resolvers. The model picker and the
 * providers pane both probe on open, so without a TTL every open pays for it
 * again to learn what it already knows. Installing a CLI mid-session is rare,
 * and `force` covers it.
 */
const PROBE_TTL_MS = 30_000;

export function harnessUnavailableHint(id: HarnessId): string {
  const { name, install } = CLI[id];
  const how = install ? ` (\`${install}\`)` : "";
  return `${name} not found${how}. Install it, or restart OmniCode if it is already installed.`;
}

export function probeHarnessAvailability(
  options?: { force?: boolean },
): Promise<void> {
  if (inflight) return inflight;
  const lastProbe = harnessAvailabilityProbedAt();
  if (!options?.force && lastProbe > 0 && Date.now() - lastProbe < PROBE_TTL_MS) {
    return Promise.resolve();
  }
  const machineId = sharedHostMachineId(), environmentId = sharedHostEnvironment();
  if (!machineId || !environmentId) return Promise.resolve();
  inflight = loadRemoteHostDescriptor(machineId, environmentId).then(descriptor => {
    if (machineId !== sharedHostMachineId() || environmentId !== sharedHostEnvironment()) return;
    const available = new Set(descriptor.providers);
    setHarnessAvailability(Object.fromEntries(HARNESSES.map(id => [id, available.has(id)])) as HarnessAvailability);
    emitHarnessAvailability();
    markHarnessAvailabilityProbed();
  }).finally(() => { inflight = null; });
  return inflight;
}
