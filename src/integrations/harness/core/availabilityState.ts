import type { HarnessId } from "../../../features/sessions/model/session";

/**
 * The probed installer state for every harness. Kept free of the binary
 * resolvers so the model layer can consult it without loading the whole
 * harness integration graph.
 */
export type HarnessAvailability = Record<HarnessId, boolean>;

let availability: HarnessAvailability = {
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
};
let version = 0;
let probedAt = 0;
/** True while `availability` holds the previous run's probe result. */
let restoredFromCache = false;

const AVAILABILITY_KEY = "monocode.harnessAvailability";
const listeners = new Set<() => void>();

export function emitHarnessAvailability() {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeHarnessAvailability(
  onStoreChange: () => void,
): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function getHarnessAvailabilitySnapshot(): number {
  return version;
}

/** True once a probe finished, or a cached result from a previous run loaded. */
export function hasProbedHarnessAvailability(): boolean {
  return probedAt > 0 || restoredFromCache;
}

export function isHarnessAvailable(id: HarnessId): boolean {
  return availability[id];
}

export function setHarnessAvailability(next: HarnessAvailability): void {
  availability = next;
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
  if (probedAt > 0 || !parsed || typeof parsed !== "object") return;
  const cached = parsed as Record<string, unknown>;
  const next = { ...availability };
  for (const id of Object.keys(next) as (keyof HarnessAvailability)[]) {
    if (typeof cached[id] === "boolean") next[id] = cached[id];
  }
  availability = next;
  restoredFromCache = true;
  emitHarnessAvailability();
}

/** When the probe last finished, or `0` before the first probe. */
export function harnessAvailabilityProbedAt(): number {
  return probedAt;
}

export function markHarnessAvailabilityProbed(): void {
  probedAt = Date.now();
}

hydrateCachedHarnessAvailability();
