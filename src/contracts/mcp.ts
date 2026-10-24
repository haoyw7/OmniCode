export type McpServer = { name: string; status: string };

export type McpNativeState =
  | "connected"
  | "needs-auth"
  | "failed"
  | "disabled"
  | "connecting"
  | "disconnected"
  | "closed"
  | "checking"
  | "unavailable"
  | "not-loaded"
  | "overridden";

export type McpProvider =
  "claude" | "claude_desktop" | "codex" | "cursor" | "opencode" | "pi";
export type McpScope = "local" | "project" | "user";

export type McpConnection = {
  provider: McpProvider;
  name: string;
  scope: McpScope;
  configPath: string;
  transport: string;
  enabled?: boolean;
  nativeState?: McpNativeState;
  toolCount?: number;
  statusDetail?: string;
};

/** Selected metadata returned by Pi's `mcp list --json`, never raw config. */
export type PiMcpList = {
  servers: {
    name: string;
    scope: string;
    source: string;
    enabled: boolean;
    state: string;
    toolCount: number;
    resources?: number | null;
    resourceTemplates?: number | null;
    override?: string | null;
    error?: string | null;
  }[];
  errors: string[];
  note?: string | null;
};

export type McpJsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, McpJsonSchema>;
  required?: string[];
  items?: McpJsonSchema;
  enum?: unknown[];
};

export type McpTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: McpJsonSchema;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
  };
};

export type McpResource = {
  uri?: string;
  uriTemplate?: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
};

export type McpPrompt = {
  name: string;
  title?: string;
  description?: string;
  arguments?: { name: string; description?: string; required?: boolean }[];
};

/** Lists are null when the server does not declare that capability. */
export type McpInspection = {
  serverName: string | null;
  serverVersion: string | null;
  protocolVersion: string | null;
  instructions: string | null;
  tools: McpTool[] | null;
  resources: McpResource[] | null;
  resourceTemplates: McpResource[] | null;
  prompts: McpPrompt[] | null;
  errors: string[];
};

export const HOST_MCP_CAPABILITY = "mcp.v1";

type McpServerRef = { provider: McpProvider; scope: McpScope; configPath: string; name: string };

/** Slow MCP operations run as Host jobs so provider CLIs, OAuth login and
 * server inspection outlive a single HTTP request. */
export type McpOperation =
  | { operation: "add"; provider: McpProvider; scope: McpScope; name: string; config: string }
  | { operation: "remove"; name: string; scope: McpScope }
  | { operation: "login"; provider: McpProvider; name: string }
  | ({ operation: "inspect" } & McpServerRef)
  | { operation: "claudeList" }
  | { operation: "piList" };

export type McpJobRequest = McpOperation & { requestId: string; projectId: string; cwd?: string };

export type McpJobResult =
  | { operation: "add" | "remove" | "login" }
  | { operation: "inspect"; inspection: McpInspection }
  | { operation: "claudeList"; output: string }
  | { operation: "piList"; report: PiMcpList };

export type McpJobView =
  | { status: "running" }
  | { status: "completed"; result: McpJobResult }
  | { status: "failed"; error: string }
  | { status: "cancelled" };
