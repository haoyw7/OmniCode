import { buildBrainPrompt } from "../../thread/prompt";
import { fullBotPolicy } from "../../../../src/features/bots/model/botView";
export function brain(actions: string[], text: string) {
  const now = Date.parse("2026-10-09T09:00:00Z");
  return buildBrainPrompt({
    config: {
      id: "eval-assistant",
      name: "MonoCode Eval",
      timezone: "UTC",
      policy: fullBotPolicy(),
      watches: [],
      reminders: [],
      habits: [],
      persona: { preset: "engineer", style: "" },
    } as any,
    launcher: "isolated-eval-control",
    actions,
    wakeup: { id: "eval-wakeup", kind: "user", text, createdAt: now } as any,
    messages: [],
    ledger: [],
    now,
    fresh: true,
  });
}
