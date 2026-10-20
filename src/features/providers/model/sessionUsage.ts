import {
  latestTurnNeedsHarnessLogin,
  supportsHarnessLogin,
} from "../../../integrations/harness/core/authSupport";
import type { HarnessId, Session } from "../../sessions/model/session";
import { conversationProviderAccountId } from "./providerAccounts";
import { parseDeepseekModelRoute } from "../../../integrations/harness/providers/deepseek/deepseekModelId";

export type UsageSession = {
  id?: string;
  harness: HarnessId;
  model?: string;
  authRequired?: boolean;
  nativeSession?: boolean;
  /** Pinned account of a started conversation; absent for a draft. */
  providerAccountId?: string;
};

/** The usage identity of a conversation: its harness, model and account. */
export function usageSessionFor(session: Session): UsageSession {
  return {
    id: session.id,
    harness: session.harness,
    model: session.model,
    authRequired: latestTurnNeedsHarnessLogin(session.blocks),
    nativeSession: !!session.nativeSession,
    providerAccountId: conversationProviderAccountId(session),
  };
}

/** Usage providers keep their account controls available even before signing in. */
export function hasSessionUsage(session: UsageSession): boolean {
  if (session.harness === "deepseek")
    return !!session.model && parseDeepseekModelRoute(session.model)?.[0] === "deepseek-account";
  return session.harness === "claude" || session.harness === "codex" ||
    session.harness === "opencode" || session.harness === "pi" || session.harness === "workbuddy" ||
    !!(session.authRequired && supportsHarnessLogin(session.harness));
}
