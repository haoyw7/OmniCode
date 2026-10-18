import type {
  BotRouting,
  TaskAction,
} from "../../../src/integrations/harness/core/botAutonomy";

const phrases: Record<BotRouting, string[]> = {
  "reuse-last": [
    "接着上次那个继续",
    "继续刚才的",
    "接着上个继续",
    "继续上一个",
    "continue the last task",
    "continue where we left off",
    "resume the previous task",
  ],
  new: [
    "这事儿单独开一条",
    "这事单独开一条",
    "新开一个",
    "另起一条",
    "start a new task",
    "start a separate task",
    "open a new session",
  ],
};

/** Only user-authored edges count; quoted replies do not become commands. */
export function detectBotRouting(raw: string): BotRouting | undefined {
  const text = raw
    .replace(/^(?:>[^\n]*(?:\r?\n|$))+\s*/, "")
    .trim()
    .replace(/[。.!！?？]+$/, "")
    .trim()
    .toLowerCase();
  const matches: { mode: BotRouting; at: number }[] = [];
  for (const [mode, aliases] of Object.entries(phrases))
    for (const phrase of aliases) {
      for (const at of new Set([
        text.startsWith(phrase) ? 0 : -1,
        text.endsWith(phrase) ? text.length - phrase.length : -1,
      ])) {
        if (
          at < 0 ||
          /(?:不要|不用|别|do not|don't|not)\s*$/i.test(text.slice(0, at))
        )
          continue;
        if (
          /^[a-z]/.test(phrase) &&
          ((at > 0 && /[a-z]/.test(text[at - 1])) ||
            /[a-z]/.test(text[at + phrase.length] ?? ""))
        )
          continue;
        matches.push({ mode: mode as BotRouting, at });
      }
    }
  // A final explicit correction wins when both ends contain a directive.
  return matches.sort((a, b) => b.at - a.at)[0]?.mode;
}

export function enforceBotRouting(
  wakeup: { id: string; routing?: BotRouting; routingSessionId?: string },
  action: string,
  sessionId: string | undefined,
  actions: readonly TaskAction[],
): void {
  if (!wakeup.routing) return;
  if (wakeup.routing === "reuse-last") {
    if (!wakeup.routingSessionId)
      throw new Error(
        "routing-reuse-unavailable: no previous task; explain this to the user instead of creating a task",
      );
    if (action === "sessions.create" || sessionId !== wakeup.routingSessionId)
      throw new Error(
        `routing-reuse-required: continue session ${wakeup.routingSessionId}; use steer or queue while running`,
      );
  } else if (
    action !== "sessions.create" &&
    !actions.some(
      (entry) =>
        entry.action === "sessions.create" &&
        entry.origin.wakeupId === wakeup.id &&
        entry.targetRef?.sessionId === sessionId &&
        ["accepted", "completed"].includes(entry.state),
    )
  ) {
    throw new Error(
      "routing-new-required: create a new session for this input before sending; do not send to an existing task",
    );
  }
}
