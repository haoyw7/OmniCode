import { queryOptions } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
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

/** Inspecting starts the server, so reuse results until an explicit refresh. */
export const mcpInspectionQuery = (cwd: string, server: McpConnection) => queryOptions({
  queryKey: ["mcpInspection", cwd, mcpServerKey(server)], staleTime: Infinity,
  queryFn: () => invoke<McpInspection>("mcp_inspect", { cwd, provider: server.provider, scope: server.scope, configPath: server.configPath, name: server.name }),
});
export async function inspectMcpServer(cwd: string, server: McpConnection, force = false) {
  const options = mcpInspectionQuery(cwd, server);
  if (force) await queryClient.cancelQueries({ queryKey: options.queryKey });
  return queryClient.fetchQuery({ ...options, staleTime: force ? 0 : Infinity });
}
export function clearMcpInspections() {
  queryClient.removeQueries({ queryKey: ["mcpInspection"] });
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
