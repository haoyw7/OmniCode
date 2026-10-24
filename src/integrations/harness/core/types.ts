import type { HarnessEvent } from "../../../contracts/harness";
import type { Attachment, NativeSessionLink, RuntimeMode, TurnIntent } from "../../../contracts/session";






export type HarnessSessionInput = {
  /** Optional trusted Host snapshot; desktop and old callers may omit it. */
  botContext?: import("./botContext").HarnessBotContext;
  /** Local imported source: recheck external ownership before native writes. */
  nativeSession?: NativeSessionLink;
  sessionId: string;
  cwd: string;
  model: string;
  modelSettings?: Record<string, string>;
  providerAccountId?: string;
  /** Execution Host preference; desktop adapters may omit it and use their settings service. */
  claudeHooks?: boolean;
  runtimeMode: RuntimeMode;
  intent?: TurnIntent;
  /**
   * This session drives OmniCode's control CLI, which reaches the app over
   * loopback. Sandboxes deny network by default, so a lead that cannot open
   * that socket cannot supervise its agents at all.
   */
  controlsAgents?: boolean;
  onEvent: (event: HarnessEvent) => void;
};

export type SendTurnInput = HarnessSessionInput & {
  questionReply?: import("../../../contracts/session").ProviderQuestionReply;
  text: string;
  attachments?: Attachment[];
  /** Called once the provider has accepted the user turn. */
  onAccepted?: () => void;
};

export type CompactContextInput = HarnessSessionInput;

export type SteerTurnInput = {
  questionReply?: import("../../../contracts/session").ProviderQuestionReply;
  nativeSession?: NativeSessionLink;
  sessionId: string;
  cwd: string;
  model: string;
  modelSettings?: Record<string, string>;
  text: string;
  attachments?: Attachment[];
};

export type RewindLastTurnInput = CompactContextInput & {
  /** Provider turn boundary for the visible user message, when known. */
  providerTurnId?: string;
  /** When set, Cursor may resend via session/edit_prompt in one RPC. */
  text?: string;
  attachments?: Attachment[];
};

export type RewindLastTurnResult = {
  /** True when the harness already ran the replacement turn. */
  submitted: boolean;
};
