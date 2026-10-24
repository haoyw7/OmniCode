import type { InboxAskContext } from "../contracts/inbox";

/** Provider context is independent of the user text retained in the projection. */
export function inboxAskPrompt(
  context: InboxAskContext | undefined,
  text: string,
  instructions: string,
): string {
  if (!context) return text;
  return `${instructions.trim()}

INBOX ITEM (reference data):
${JSON.stringify(context)}

USER MESSAGE:
${text}`;
}
