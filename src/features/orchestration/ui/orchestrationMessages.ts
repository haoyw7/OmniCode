import type { TranslationValues } from "../../../shared/i18n/language";

type Translator = (text: string, values?: TranslationValues) => string;
const hostMessages = new Set([
  "Host restarted before confirmation completed. Inspect the retained work and prepare a new proposal.",
  "Host restarted while preparing assignments. Review and retry the proposal.",
  "Host restarted. This turn was interrupted; inspect its work before continuing.",
  "No worker models are available on this Host",
  "This worker is managed by its lead. Use desktop orchestration controls.",
  "Use desktop orchestration controls before changing this run.",
  "This checkout is controlled by an orchestrator. Stop its run before independent work.",
  "This proposal is not ready to retry",
  "This session cannot control that orchestration",
  "The proposal changed in another client. Refresh before editing or confirming.",
  "Wait for or stop the current run before confirming another proposal",
  "Review a ready proposal before confirming",
  "This action belongs to a replaced orchestration run",
  "Only a paused orchestration can resume",
  "Task does not belong to this run",
  "Host is stopping",
  "Stop orchestration before changing this project's branches or worktrees",
  "Wait for or stop the current turn before preparing assignments",
  "Planning was interrupted. Generate the assignments again.",
  "The provider failed while planning assignments",
  "Connect to the Host before controlling this run.",
  "The Host has not confirmed this request. Retry it before continuing.",
  "Wait for the proposal to finish before confirming.",
]);

/** Host-owned explanations are localized at display time; unknown text passes through. */
export function localizeOrchestrationMessage(
  text: string,
  t: Translator,
): string {
  const normalized = text.replace(/^Error: /, "");
  for (const prefix of [
    "Host rejected request: ",
    "Retained worker requires review: ",
  ]) {
    if (normalized.startsWith(prefix))
      return t(`${prefix}{message}`, {
        message: localizeOrchestrationMessage(
          normalized.slice(prefix.length),
          t,
        ),
      });
  }
  return hostMessages.has(normalized) ? t(normalized) : text;
}
