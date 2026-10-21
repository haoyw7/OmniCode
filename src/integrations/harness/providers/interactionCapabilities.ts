import type { HarnessInteractionCapabilities } from "../core/capabilities";

// Pure declarations shared by desktop adapters and Host bindings. No CLI probing.
export const PROVIDER_INTERACTION_CAPABILITIES = {
  codex: {
    turns: { send: true, cancel: true, steer: true, compact: true, rewindLastTurn: true },
    questions: { respond: true, keepOpen: true, lateReply: true }, backgroundTasks: { stop: false },
  },
  claude: {
    turns: { send: true, cancel: true, steer: true, compact: true, rewindLastTurn: false },
    questions: { respond: true, keepOpen: false, lateReply: false }, backgroundTasks: { stop: true },
  },
  cursor: {
    turns: { send: true, cancel: true, steer: true, compact: false, rewindLastTurn: false },
    questions: { respond: true, keepOpen: false, lateReply: false }, backgroundTasks: { stop: false },
  },
  grok: {
    turns: { send: true, cancel: true, steer: false, compact: true, rewindLastTurn: false },
    questions: { respond: true, keepOpen: false, lateReply: false }, backgroundTasks: { stop: false },
  },
  opencode: {
    turns: { send: true, cancel: true, steer: true, compact: true, rewindLastTurn: true },
    questions: { respond: true, keepOpen: false, lateReply: false }, backgroundTasks: { stop: false },
  },
  pi: {
    turns: { send: true, cancel: true, steer: true, compact: true, rewindLastTurn: true },
    questions: { respond: true, keepOpen: false, lateReply: false }, backgroundTasks: { stop: false },
  },
  omp: {
    turns: { send: true, cancel: true, steer: true, compact: true, rewindLastTurn: true },
    questions: { respond: true, keepOpen: false, lateReply: false }, backgroundTasks: { stop: false },
  },
  deepseek: {
    turns: { send: true, cancel: true, steer: true, compact: false, rewindLastTurn: false },
    questions: { respond: true, keepOpen: true, lateReply: true }, backgroundTasks: { stop: true },
  },
  fx: {
    turns: { send: true, cancel: true, steer: false, compact: false, rewindLastTurn: false },
    questions: { respond: false, keepOpen: false, lateReply: false }, backgroundTasks: { stop: false },
  },
  hermes: {
    turns: { send: true, cancel: true, steer: true, compact: false, rewindLastTurn: false },
    questions: { respond: false, keepOpen: false, lateReply: false }, backgroundTasks: { stop: false },
  },
  antigravity: {
    turns: { send: true, cancel: true, steer: false, compact: false, rewindLastTurn: false },
    questions: { respond: false, keepOpen: false, lateReply: false }, backgroundTasks: { stop: false },
  },
} satisfies Record<string, HarnessInteractionCapabilities>;
