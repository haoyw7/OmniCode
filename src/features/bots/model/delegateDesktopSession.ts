import {
  remoteMachineFor,
  remoteRequest,
} from "../../connections/model/connections";
import {
  ensureSharedProject,
  remoteProjectFor,
  sharedHostMachineId,
} from "../../connections/model/remoteProjects";
import { delegateSession } from "./delegateSession";
import { botErrorMessage } from "./botErrors";
import { translate } from "../../../shared/i18n/language";
import { toast } from "sonner";

/** Both desktop menus resolve the owning Host, never the assistant's selected tab. */
export async function delegateDesktopSession(
  cwd: string,
  sessionId: string,
): Promise<void> {
  let remote = remoteProjectFor(cwd);
  let machineId: string | undefined;
  try {
    if (remote?.local && !remote.projectId)
      remote = await ensureSharedProject(cwd);
    if (!remote) throw new Error("Connect to a Host first.");
    machineId = remote.local
      ? sharedHostMachineId()
      : (await remoteMachineFor(remote.environmentId))?.id;
    if (!machineId)
      throw new Error("Cannot reach the Host. Check the connection and retry.");
  } catch (error) {
    toast.error(translate(botErrorMessage(error)));
    return;
  }
  await delegateSession(
    (method, params) => remoteRequest(machineId!, method, params),
    {
      environmentId: remote.environmentId,
      projectId: remote.projectId,
      sessionId,
    },
  ).catch(() => {
    /* The shared action reports the failure. */
  });
}
