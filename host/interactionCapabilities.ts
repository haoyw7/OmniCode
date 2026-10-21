import { assertInteractionBindings, type SessionInteractionCapabilities } from "../src/integrations/harness/core/capabilities";
import type { HostProvider } from "./providers";

export function hostProviderCapabilities(provider: HostProvider): SessionInteractionCapabilities {
  return { ...provider.interactionCapabilities, queue: true };
}

/** Kept separate from provider registration so inspecting a binding loads no drivers. */
export function validateHostProvider(provider: HostProvider): void {
  const capabilities = provider.interactionCapabilities;
  if (capabilities.turns.rewindLastTurn) throw new Error("Host has no rewind execution binding");
  assertInteractionBindings(capabilities, {
    send: provider.send, cancel: provider.cancel, steer: provider.steer, compact: provider.compact,
    respond: provider.answer, keepOpen: provider.keepQuestionOpen, stop: provider.stopBackgroundTask,
  });
}
