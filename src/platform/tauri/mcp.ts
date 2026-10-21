import { invoke } from "@tauri-apps/api/core";

/** MCP discovery and CLI health are local native commands, not Host FS RPCs. */
export function invokeMcp<T>(
  command: "mcp_discover" | "claude_mcp_list" | "pi_mcp_list",
  args: { cwd: string },
): Promise<T> {
  return invoke<T>(command, args);
}
