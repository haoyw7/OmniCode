import type { BotRpc } from "./botRpc";
import type { SessionReference } from "./botView";
import { botErrorMessage } from "./botErrors";
import { translate } from "../../../shared/i18n/language";
import { withToast } from "../../../shared/ui/primitives/Sonner";

export function delegateSession(
  rpc: BotRpc,
  ref: SessionReference,
): Promise<unknown> {
  return withToast(
    () =>
      rpc("assistant.control", {
        action: "delegateSession",
        commandId: crypto.randomUUID(),
        ...ref,
      }),
    {
      loading: translate("Handing over to assistant…"),
      success: translate("Conversation handed over to assistant"),
      error: (error) => translate(delegateErrorMessage(error)),
    },
  );
}

const HOST_TOO_OLD =
  "This Host is too old to take over conversations. Update OmniCode on that Host and try again.";

/** Hosts from before hand-over validate these fields as another control and reject them. */
function delegateErrorMessage(error: unknown): string {
  const message = botErrorMessage(error);
  return /unknown input field/i.test(message) ? HOST_TOO_OLD : message;
}
