import type { SubmissionOutcome } from "../contracts/session";
import type { CommandOutcome } from "../contracts/protocol";
import { isDefinitiveCommandRejection } from "./commandOutbox";
import type { HttpPort } from "./ports";

/** Background managed work observes a bounded command result, never a hidden
 * transcript. Multiple callers share the same outstanding completion promise. */
export class CommandOutcomeClient<Target> {
  private readonly pending = new Map<string, Promise<SubmissionOutcome>>();

  constructor(private readonly http: HttpPort<Target>) {}

  wait(target: Target, sessionId: string, commandId: string): Promise<SubmissionOutcome> {
    const key = JSON.stringify([this.http.key(target), sessionId, commandId]);
    const current = this.pending.get(key);
    if (current) return current;
    const request = this.observe(target, sessionId, commandId).finally(() => {
      if (this.pending.get(key) === request) this.pending.delete(key);
    });
    this.pending.set(key, request);
    return request;
  }

  private async observe(target: Target, sessionId: string, commandId: string): Promise<SubmissionOutcome> {
    let failures = 0;
    while (true) {
      let delay = 500;
      try {
        const response = await this.http.request<CommandOutcome>(target, "commands.outcome", { sessionId, commandId });
        if (!response || response.sessionId !== sessionId || response.commandId !== commandId)
          throw Object.assign(new Error("Host returned a different conversation."), { status: 400 });
        if (response.outcome) return response.outcome;
        failures = 0;
      } catch (error) {
        if (isDefinitiveCommandRejection(error) || (error && typeof error === "object" && "status" in error &&
          (error.status === 401 || error.status === 403))) throw error;
        delay = Math.min(15_000, 1_000 * 2 ** Math.min(failures++, 4));
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
