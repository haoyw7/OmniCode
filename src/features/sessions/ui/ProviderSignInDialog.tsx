import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { errorMessage } from "../../../shared/lib/errorMessage";
import { toast } from "sonner";
import { loginHarness } from "../../../integrations/harness/core/auth";
import { HARNESS_TITLE, type HarnessId } from "../model/session";
import { Modal } from "../../../shared/ui/Modal";
import {
  ProviderSignInPanel,
  type ProviderSignInState,
} from "./ProviderSignInPanel";

type Props = {
  harness: HarnessId;
  onClose: () => void;
};

export function ProviderSignInDialog({ harness, onClose }: Props) {
  return <ProviderSignInContent key={harness} harness={harness} onClose={onClose} />;
}

function ProviderSignInContent({ harness, onClose }: Props) {
  const { t: uiT } = useTranslation();
  const login = useMutation({
    mutationFn: () => loginHarness(harness),
    onError: (reason) => toast.error(errorMessage(reason)),
  }, queryClient);
  const state: ProviderSignInState = login.isPending ? "running" : login.isSuccess ? "complete" : login.isError ? "error" : "idle";
  const error = errorMessage(login.error) ?? null;
  const signIn = () => { if (!login.isPending) login.mutate(); };

  return (
    <Modal
      onClose={onClose}
      title={uiT("Authentication required")}
      description={uiT("Sign in to continue using {value0}.", {
        value0: String(HARNESS_TITLE[harness]),
      })}
      size="sm"
      minimalHeader
    >
      <ProviderSignInPanel
        harness={harness}
        state={state}
        error={error}
        onSignIn={signIn}
        onComplete={onClose}
        completeActionLabel="Continue"
        autoFocus
      />
    </Modal>
  );
}
