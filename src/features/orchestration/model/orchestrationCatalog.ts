import { HARNESSES } from "../../../contracts/session";
import { modelsFor } from "../../../integrations/harness/core/modelCatalog";
import { isHarnessAvailable, probeHarnessAvailability } from "../../providers/model/harnessAvailability";
import { refreshHostModelCatalogs } from "../../providers/model/hostModelCatalog";
import { validateOrchestrationSettings } from "../../../domain/orchestrationPlan";

/** Discover worker choices only when the user sends an orchestration request. */
export async function discoverOrchestrationSettings() {
  await probeHarnessAvailability();
  const installed = HARNESSES.filter(isHarnessAvailable);
  await refreshHostModelCatalogs(installed);
  return validateOrchestrationSettings({
    maxWorkers: 2,
    choices: installed
      .filter(isHarnessAvailable)
      .flatMap((harness) =>
        modelsFor(harness).map(({ id, name }) => ({
          harness,
          model: id,
          name,
        })),
      ),
  });
}
