import { invoke } from "@tauri-apps/api/core";
import type { McpConnection } from "./mcp";

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

export function mcpServerKey(
  server: Pick<McpConnection, "provider" | "scope" | "configPath" | "name">,
) {
  return `${server.provider}:${server.scope}:${server.configPath}:${server.name}`;
}

const inspections = new Map<string, Promise<McpInspection>>();

/** Inspecting starts the server, so results are reused until a forced refresh. */
export function inspectMcpServer(
  cwd: string,
  server: McpConnection,
  force = false,
) {
  const key = `${cwd}\n${mcpServerKey(server)}`;
  let request = inspections.get(key);
  if (!request || force) {
    request = invoke<McpInspection>("mcp_inspect", {
      cwd,
      provider: server.provider,
      scope: server.scope,
      configPath: server.configPath,
      name: server.name,
    });
    inspections.set(key, request);
    const current = request;
    request.catch(() => {
      if (inspections.get(key) === current) inspections.delete(key);
    });
  }
  return request;
}

export function clearMcpInspections() {
  inspections.clear();
}

/** Flatten a tool's input schema into displayable parameters. */
export function schemaParameters(schema: McpJsonSchema | undefined) {
  const required = new Set(schema?.required ?? []);
  return Object.entries(schema?.properties ?? {}).map(([name, property]) => ({
    name,
    type: schemaType(property),
    description: property.description,
    required: required.has(name),
  }));
}

function schemaType(schema: McpJsonSchema): string {
  if (schema.enum?.length)
    return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  const type = Array.isArray(schema.type)
    ? schema.type.join(" | ")
    : schema.type;
  if (type === "array" && schema.items) return `${schemaType(schema.items)}[]`;
  return type ?? "any";
}
