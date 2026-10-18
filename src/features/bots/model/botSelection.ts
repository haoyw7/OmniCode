import type { BotScope } from "./bots";
export const BOT_SELECTION_EVENT = "monocode:bot-selection";
const key = (environmentId: string) => `monocode.bot-selection:${environmentId}`;
export function readBotSelection(environmentId: string): BotScope | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(key(environmentId)) ?? "null");
    if (value && typeof value.botId === "string" && typeof value.threadId === "string") return value;
  } catch { /* Selection is optional when storage is unavailable. */ }
}
export function selectBotThread(environmentId: string, scope: BotScope) {
  try { localStorage.setItem(key(environmentId), JSON.stringify(scope)); } catch { /* Keep the in-memory selection. */ }
  window.dispatchEvent(new CustomEvent(BOT_SELECTION_EVENT, { detail: { environmentId, ...scope } }));
}

export const botNotificationTarget = (environmentId: string, windowLabel: string, scope: BotScope) =>
  `bot:${JSON.stringify([environmentId, windowLabel, scope.botId, scope.threadId])}`;
export function parseBotNotificationTarget(target: string) {
  if (!target.startsWith("bot:")) return;
  try {
    const value = JSON.parse(target.slice(4));
    if (Array.isArray(value) && value.length === 4 && value.every((part) => typeof part === "string"))
      return { environmentId: value[0] as string, windowLabel: value[1] as string, botId: value[2] as string, threadId: value[3] as string };
  } catch { /* Ignore notifications belonging to another handler. */ }
}
