import { useMemo } from "react";
import { useRemoteMachines } from "../../connections/model/connections";
import {
  sharedHostEnvironment,
  sharedHostMachineId,
} from "../../connections/model/remoteProjects";
import { useTranslation } from "../../../shared/i18n/useTranslation";

export function useDesktopBotsHosts() {
  const { t } = useTranslation();
  const { machines } = useRemoteMachines();
  const localId = sharedHostMachineId();
  const environmentId = sharedHostEnvironment();
  return useMemo(() => {
    const choices = [...machines];
    if (localId && environmentId && !choices.some((m) => m.id === localId))
      choices.unshift({
        id: localId,
        environmentId,
        name: t("Local"),
        endpoint: "",
      });
    return choices;
  }, [machines, localId, environmentId, t]);
}
