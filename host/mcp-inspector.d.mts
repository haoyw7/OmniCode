import type { McpInspection } from "../src/contracts/mcp";

type Lookup = (key: string) => string | undefined;
type Transport = { request(method: string, params: unknown): Promise<unknown>; notify(method: string, params: unknown): Promise<void>; close(): void | Promise<void> };
export type McpServerSpec =
  | { kind: "stdio"; command: string; args: string[]; env: [string, string][]; cwd?: string }
  | { kind: "http"; url: string; headers: [string, string][]; sse: boolean };

export function expandVars(raw: string, lookup: Lookup): string;
export function parseSpec(config: Record<string, unknown>, lookup: Lookup): McpServerSpec;
export function inspect(transport: Transport, clientVersion?: string): Promise<McpInspection>;
export function inspectServer(input: { config: Record<string, unknown>; projectDir?: string; clientVersion?: string }): Promise<McpInspection>;
