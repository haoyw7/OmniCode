import { useEffect, useState } from "react";
import { loadRemoteHostDescriptor } from "./remoteHostMetadata";
import { REMOTE_PROJECTS_CHANGED, sharedHostEnvironment, sharedHostMachineId } from "./remoteProjects";

/** Capability absence and an unavailable connection both disable new actions. */
export function useSharedHostCapability(capability: string | undefined): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let generation = 0;
    const refresh = () => {
      const current = ++generation;
      setAvailable(false);
      const machineId = sharedHostMachineId(), environmentId = sharedHostEnvironment();
      if (!capability || !machineId || !environmentId) return;
      void loadRemoteHostDescriptor(machineId, environmentId).then(
        descriptor => { if (generation === current) setAvailable(descriptor.capabilities.includes(capability)); },
        () => { /* The current Host is unavailable. */ },
      );
    };
    refresh();
    window.addEventListener(REMOTE_PROJECTS_CHANGED, refresh);
    return () => { ++generation; window.removeEventListener(REMOTE_PROJECTS_CHANGED, refresh); };
  }, [capability]);
  return available;
}
