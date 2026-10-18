import { HOST_WORKSPACE_STATUS, HostWorkspaceJournal, mobileWorkspaceLocation, type WorkspaceLocation } from "../features/connections/model/hostWorkspace";
import type { MobileClient } from "./client";
import { translate } from "../shared/i18n/language";

let current: HostWorkspaceJournal | undefined;
let activation = 0;
const windowId = crypto.randomUUID();
const notify = () => window.dispatchEvent(new Event(HOST_WORKSPACE_STATUS));

export function stopMobileWorkspace(): void {
  activation++;
  current = undefined;
  notify();
}

export async function initializeMobileWorkspace(client: MobileClient): Promise<WorkspaceLocation | undefined> {
  const environmentId = client.connection?.environmentId;
  const epoch = ++activation;
  current = undefined;
  notify();
  if (!environmentId) return;
  if (!client.hasCapability("workspaces.read")) {
    const status = client.getConnectionStatus();
    const cached = localStorage.getItem(`monocode.host-workspace.v1:${encodeURIComponent(environmentId)}:cache:mobile`);
    if (!cached || status.reason === "identity" || status.reason === "authentication" || status.state === "connected")
      throw new Error(translate("Update Host to share workspace state."));
  }
  const journal = new HostWorkspaceJournal(environmentId, windowId, "mobile", (method, params) => {
    if (client.connection?.environmentId !== environmentId) return Promise.reject(new Error("Host identity changed"));
    return client.rpc(method, params);
  }, localStorage);
  await journal.flush().catch(() => undefined);
  const result = await journal.read();
  if (epoch !== activation || client.connection?.environmentId !== environmentId) return;
  current = journal;
  notify();
  return mobileWorkspaceLocation(result, environmentId);
}

export async function saveMobileWorkspace(client: MobileClient, location: WorkspaceLocation): Promise<void> {
  if (current?.environmentId !== client.connection?.environmentId || current?.environmentId !== location.environmentId) return;
  // A phone writes only its location, never the desktop's panes or file layout.
  const save = current.save({ location }, true);
  notify();
  await save;
  notify();
}

export async function flushMobileWorkspace(client: MobileClient): Promise<void> {
  if (current?.environmentId === client.connection?.environmentId) {
    try { await current?.flush(); } finally { notify(); }
  }
}

export const mobileWorkspacePending = () => current?.pending ?? false;
