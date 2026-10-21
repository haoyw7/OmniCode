/** Serializable support, independent of permissions, connectivity and busy state. */
export type HarnessInteractionCapabilities = {
  turns: { send: boolean; cancel: boolean; steer: boolean; compact: boolean; rewindLastTurn: boolean };
  questions: { respond: boolean; keepOpen: boolean; lateReply: boolean };
  backgroundTasks: { stop: boolean };
};

export type SessionInteractionCapabilities = HarnessInteractionCapabilities & { queue: boolean };

export const SESSION_CAPABILITIES_V1 = "sessions.capabilities.v1";

/** Also sanitizes partial/future wire values: only explicit true enables an action. */
export function normalizeInteractionCapabilities(value: unknown): SessionInteractionCapabilities {
  const v = value as Partial<SessionInteractionCapabilities> | null | undefined;
  return {
    turns: {
      send: v?.turns?.send === true, cancel: v?.turns?.cancel === true,
      steer: v?.turns?.steer === true, compact: v?.turns?.compact === true,
      rewindLastTurn: v?.turns?.rewindLastTurn === true,
    },
    questions: {
      respond: v?.questions?.respond === true, keepOpen: v?.questions?.keepOpen === true,
      lateReply: v?.questions?.lateReply === true,
    },
    backgroundTasks: { stop: v?.backgroundTasks?.stop === true },
    queue: v?.queue === true,
  };
}

export const NO_INTERACTION_CAPABILITIES = normalizeInteractionCapabilities(undefined);

/** Check the execution binding, not just the presence of a declaration. */
export function assertInteractionBindings(
  capabilities: HarnessInteractionCapabilities,
  bindings: {
    send?: unknown; cancel?: unknown; steer?: unknown; compact?: unknown;
    rewindLastTurn?: unknown; respond?: unknown; keepOpen?: unknown; stop?: unknown;
  },
): void {
  for (const [name, supported] of Object.entries({
    ...capabilities.turns, respond: capabilities.questions.respond,
    keepOpen: capabilities.questions.keepOpen, stop: capabilities.backgroundTasks.stop,
  })) {
    if (supported && typeof bindings[name as keyof typeof bindings] !== "function")
      throw new Error(`Interaction capability ${name} has no execution binding`);
  }
  if (capabilities.questions.lateReply && !capabilities.turns.send)
    throw new Error("Late question replies require turn submission");
}
