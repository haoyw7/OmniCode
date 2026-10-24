import type { McpServer, McpConnection } from "../../../contracts/mcp";


export const MCP_PROVIDER_LABELS: Record<McpConnection["provider"], string> = {
  claude: "Claude Code",
  claude_desktop: "Claude Desktop",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
  pi: "Pi",
};

/** Claude's list output is for humans; keep only names and health text. */
export function parseClaudeMcpList(output: string): McpServer[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Za-z0-9_-]+):\s+(.+)$/);
    if (!match) return [];
    const detail = match[2];
    const parts = detail.split(/ - | — /);
    const status = parts[parts.length - 1];
    return [{ name: match[1], status }];
  });
}
