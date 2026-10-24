/** JSON-only state shared by clients connected to a verified Host identity. */
export type HostStateValue = null | boolean | number | string | HostStateValue[] | { [key: string]: HostStateValue };

export const HOST_CLIENT_STATE_CAPABILITY = "clientState.v1";

export type HostPreferences = {
  revision: number;
  values: Record<string, HostStateValue>;
  imported: boolean;
};

export type HostWorkspaceKind = "desktop" | "mobile";
export type HostWorkspace = {
  revision: number;
  windowId: string;
  kind: HostWorkspaceKind;
  snapshot: HostStateValue;
  updatedAt: number;
};

/** A discoverable connection definition. Device credentials and endpoints stay local. */
export type HostConnectionDefinition = {
  id: string;
  name: string;
  kind: "http" | "ssh";
  environmentId?: string;
  hostname?: string;
  port?: number;
};
export type HostConnections = { revision: number; connections: HostConnectionDefinition[] };

/** A named execution environment: project folders on one machine plus the
 * variables added to provider processes whose working directory is inside
 * one of those folders. Values can be secrets, so only this computer's
 * desktop may read or change them. */
export type HostEnvironmentDefinition = {
  id: string;
  name: string;
  /** Omitted for this computer. */
  machine?: { kind: "wsl"; distribution: string };
  /** Absolute folder paths on that machine. */
  folders: string[];
  variables: Record<string, string>;
};
export type HostEnvironments = { revision: number; environments: HostEnvironmentDefinition[] };


