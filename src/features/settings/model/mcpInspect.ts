import type { McpConnection, McpInspection, McpJsonSchema } from "../../../contracts/mcp";
import { inspectHostMcpServer } from "./mcpHost";

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
    request = inspectHostMcpServer(cwd, server);
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
