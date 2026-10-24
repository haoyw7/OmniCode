import type { InboxItem } from "../../../contracts/session";
import inboxInstructions from "../../../instructions/inbox.md?raw";
import type { InboxAskContext } from "../../../contracts/inbox";
import { inboxAskPrompt as prepareInboxAskPrompt } from "../../../domain/inboxPrompt";

export function inboxAskKey(item: InboxItem): string {
  if (item.provider === "linear" || item.provider === "jira") {
    return `${item.provider}:${item.id}`;
  }
  // Items without a usable link (e.g. a provider that omitted the URL) must
  // still produce a stable key: this runs during render, so it cannot throw.
  try {
    const url = new URL(item.url);
    return `${item.provider}:${url.host.toLowerCase()}:${url.pathname.replace(/\/$/, "").toLowerCase()}`;
  } catch {
    const repo = item.repo.trim().toLowerCase() || "unknown";
    return `${item.provider}:${repo}:${item.kind}:${item.number}`;
  }
}

export function inboxAskPrompt(
  context: InboxAskContext | undefined,
  text: string,
): string {
  return prepareInboxAskPrompt(context, text, inboxInstructions);
}
