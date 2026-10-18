import type {
  McpConnection,
  McpNativeState,
} from "../../../../features/settings/model/mcp";

/** Selected metadata returned by the desktop Pi CLI bridge, never raw config. */
export type PiMcpList = {
  servers: {
    name: string;
    scope: string;
    source: string;
    enabled: boolean;
    state: string;
    toolCount: number;
    override?: string | null;
    error?: string | null;
  }[];
  errors: string[];
  note?: string | null;
};

const STATUS: Record<McpNativeState, string> = {
  connected: "Connected",
  "needs-auth": "Needs authentication",
  failed: "Connection failed",
  disabled: "Disabled",
  connecting: "Connecting",
  disconnected: "Disconnected",
  closed: "Closed",
  checking: "Checking connection…",
  unavailable: "Status unavailable",
  "not-loaded": "Not loaded by Pi",
  overridden: "Overridden by another configuration",
};

export function piMcpStatus(state: McpNativeState): string {
  return STATUS[state];
}

export function piMcpHealth(server: McpConnection, list: PiMcpList) {
  const native = list.servers.find(
    (entry) =>
      entry.name === server.name &&
      entry.source === server.configPath &&
      (entry.scope === "global" ? "user" : entry.scope) === server.scope,
  );
  let nativeState: McpNativeState;
  if (native) {
    nativeState =
      native.enabled === false
        ? "disabled"
        : Object.prototype.hasOwnProperty.call(STATUS, native.state)
          ? (native.state as McpNativeState)
          : "unavailable";
  } else {
    const other = list.servers.find((entry) => entry.name === server.name);
    // An absent project row can be ignored by Pi's trust policy. A user row
    // replaced by a project definition, or a project overlay, is superseded.
    nativeState =
      other && (server.scope === "user" || other.override === server.configPath)
        ? "overridden"
        : "not-loaded";
  }
  return {
    nativeState,
    status: piMcpStatus(nativeState),
    toolCount: nativeState === "connected" ? native?.toolCount : undefined,
    statusDetail: native?.error ?? undefined,
  };
}
