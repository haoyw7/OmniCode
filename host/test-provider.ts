import type { HarnessInteractionCapabilities } from "../src/integrations/harness/core/capabilities";

/** Existing test doubles opt into precisely the methods installed by each test. */
export function testProviderCapabilities(provider: {
  send?: unknown; cancel?: unknown; steer?: unknown; compact?: unknown;
  answer?: unknown; keepQuestionOpen?: unknown; stopBackgroundTask?: unknown;
}): HarnessInteractionCapabilities {
  return {
    turns: {
      send: typeof provider.send === "function", cancel: typeof provider.cancel === "function",
      steer: typeof provider.steer === "function", compact: typeof provider.compact === "function",
      rewindLastTurn: false,
    },
    questions: {
      respond: typeof provider.answer === "function", keepOpen: typeof provider.keepQuestionOpen === "function",
      lateReply: typeof provider.send === "function" && typeof provider.answer === "function",
    },
    backgroundTasks: { stop: typeof provider.stopBackgroundTask === "function" },
  };
}
