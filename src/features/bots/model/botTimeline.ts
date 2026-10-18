import type { BotMessage } from "./botView";

/** Keep the newest card for each exact session in the chronological UI only.
 * The complete action history remains in the synchronized messages. */
export function compactBotTimeline(messages: readonly BotMessage[]): BotMessage[] {
  const latest = new Map<string, number>();
  const key = (message: Extract<BotMessage, { kind: "session-card" }>) =>
    JSON.stringify([message.ref.environmentId, message.ref.projectId, message.ref.sessionId]);
  messages.forEach((message, index) => {
    if (message.kind === "session-card") latest.set(key(message), index);
  });
  return messages.filter((message, index) =>
    message.kind !== "session-card" || latest.get(key(message)) === index);
}
