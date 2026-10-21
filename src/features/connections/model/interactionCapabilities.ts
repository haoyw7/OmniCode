import {
  normalizeInteractionCapabilities, SESSION_CAPABILITIES_V1,
  type SessionInteractionCapabilities,
} from "../../../integrations/harness/core/capabilities";

type CapabilitySnapshot = {
  interactionCapabilities?: SessionInteractionCapabilities;
  supportsQueue?: boolean;
  canSteer?: boolean;
  session: { harness: string };
};

/** The only provider-based fallback: preserve the pre-v1 remote client behavior. */
export function hostInteractionCapabilities(
  snapshot: CapabilitySnapshot | undefined,
  hostCapabilities?: readonly string[],
): SessionInteractionCapabilities {
  if (snapshot?.interactionCapabilities != null || hostCapabilities?.includes(SESSION_CAPABILITIES_V1))
    return normalizeInteractionCapabilities(snapshot?.interactionCapabilities);
  const provider = snapshot?.session.harness;
  return {
    turns: {
      send: !!snapshot, cancel: !!snapshot, steer: snapshot?.canSteer === true,
      compact: !!provider && ["codex", "claude", "grok", "opencode", "pi", "omp"].includes(provider),
      rewindLastTurn: false,
    },
    questions: {
      respond: !!provider && !["fx", "hermes", "antigravity"].includes(provider),
      keepOpen: provider === "deepseek", lateReply: provider === "codex",
    },
    backgroundTasks: {
      stop: !!provider && ["claude", "deepseek"].includes(provider) &&
        hostCapabilities?.includes("sessions.stopBackgroundTask") === true,
    },
    queue: snapshot?.supportsQueue === true,
  };
}
