import type { HarnessId } from "../../../features/sessions/model/session";
import { createStore } from "zustand/vanilla";

/**
 * The probed installer state for every harness. Kept free of the binary
 * resolvers so the model layer can consult it without loading the whole
 * harness integration graph.
 */
export type HarnessAvailability = Record<HarnessId, boolean>;

const initialAvailability: HarnessAvailability = {
  deepseek: false,
  claude: false,
  codex: false,
  cursor: false,
  grok: false,
  opencode: false,
  pi: false,
  omp: false,
  fx: false,
  hermes: false,
  antigravity: false,
  workbuddy: false,
};
const availabilityStore = createStore(() => ({ availability: initialAvailability, version: 0, probedAt: 0, restoredFromCache: false }));

const AVAILABILITY_KEY = "omnicode.harnessAvailability";

export function emitHarnessAvailability() {
  availabilityStore.setState(state => ({ version: state.version + 1 }));
}

export function subscribeHarnessAvailability(
  onStoreChange: () => void,
): () => void {
  return availabilityStore.subscribe((next, previous) => {
    if (next.version !== previous.version) onStoreChange();
  });
}

export function getHarnessAvailabilitySnapshot(): number {
  return availabilityStore.getState().version;
}

/** True once a probe finished, or a cached result from a previous run loaded. */
export function hasProbedHarnessAvailability(): boolean {
  const { probedAt, restoredFromCache } = availabilityStore.getState();
  return probedAt > 0 || restoredFromCache;
}

export function isHarnessAvailable(id: HarnessId): boolean {
  return availabilityStore.getState().availability[id];
}

export function setHarnessAvailability(next: HarnessAvailability): void {
  availabilityStore.setState({ availability: next });
  try {
    localStorage.setItem(AVAILABILITY_KEY, JSON.stringify(next));
  } catch {
    // private mode / quota / no storage
  }
}

/**
 * Seed availability from the previous run so provider tabs and the default
 * new-session harness are right before the first probe finishes. The probe
 * still runs: `probedAt` stays `0` until it does.
 */
export function hydrateCachedHarnessAvailability(): void {
  let parsed: unknown;
  try {
    const raw = localStorage.getItem(AVAILABILITY_KEY);
    if (!raw) return;
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (availabilityStore.getState().probedAt > 0 || !parsed || typeof parsed !== "object") return;
  const cached = parsed as Record<string, unknown>;
  const next = { ...availabilityStore.getState().availability };
  for (const id of Object.keys(next) as (keyof HarnessAvailability)[]) {
    if (typeof cached[id] === "boolean") next[id] = cached[id];
  }
  availabilityStore.setState({ availability: next, restoredFromCache: true });
  emitHarnessAvailability();
}

/** When the probe last finished, or `0` before the first probe. */
export function harnessAvailabilityProbedAt(): number {
  return availabilityStore.getState().probedAt;
}

export function markHarnessAvailabilityProbed(): void {
  availabilityStore.setState({ probedAt: Date.now() });
}

hydrateCachedHarnessAvailability();
