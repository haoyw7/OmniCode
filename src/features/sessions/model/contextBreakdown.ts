import type { ContextCategory, ContextUsage } from "../../../contracts/session";


const labels: Record<string, string> = {
  "system prompt": "System prompt", "system tools": "System tools",
  "system tools (deferred)": "System tools (deferred)", "mcp tools": "MCP tools",
  "mcp tools (deferred)": "MCP tools (deferred)", "mcp server instructions": "MCP server instructions",
  "skills": "Skills", "messages": "Messages", "tool results": "Tool results",
  "memory files": "Memory files", "custom agents": "Custom agents",
  "autocompact buffer": "Autocompact buffer", "manual compact buffer": "Manual compact buffer",
  "free space": "Free space", "since last update": "Since last update",
};

export type ContextDisplayRow = ContextCategory & {
  label?: string;
  tone: "messages" | "tools" | "mcp" | "muted" | "buffer" | "free";
  percent: number | null;
};

/** Rows share one denominator. Tool-result details are a subset of Messages. */
export function contextBreakdownRows(usage: ContextUsage): ContextDisplayRow[] {
  const snapshot = usage.breakdown;
  if (!snapshot || snapshot.window !== usage.window || usage.used < snapshot.used) return [];
  const rows = snapshot.categories.map((row) => ({ ...row }));
  const results = snapshot.toolResultTokens;
  const message = rows.find((row) => row.kind === "used" && row.name.toLowerCase() === "messages");
  if (message && results !== undefined && results > 0 && results <= message.tokens &&
      !rows.some((row) => row.name.toLowerCase() === "tool results")) {
    message.tokens -= results;
    rows.splice(rows.indexOf(message) + 1, 0, { name: "Tool results", tokens: results, kind: "used" });
  }
  if (!rows.some((row) => row.kind === "buffer") && snapshot.autoCompactEnabled === true &&
      snapshot.autoCompactThreshold !== undefined && snapshot.autoCompactThreshold <= snapshot.window) {
    rows.push({ name: "Autocompact buffer", tokens: snapshot.window - snapshot.autoCompactThreshold, kind: "buffer" });
  }
  const growth = usage.used - snapshot.used;
  if (growth > 0) {
    const delta = rows.find((row) => row.kind === "used" && row.name.toLowerCase() === "since last update");
    if (delta) delta.tokens += growth;
    else rows.push({ name: "Since last update", tokens: growth, kind: "used" });
  }
  const buffer = rows.filter((row) => row.kind === "buffer").reduce((sum, row) => sum + row.tokens, 0);
  const free = Math.max(0, snapshot.window - usage.used - buffer);
  const freeRow = rows.find((row) => row.kind === "free");
  if (freeRow) freeRow.tokens = free;
  else rows.push({ name: "Free space", kind: "free", tokens: free });
  const order = { used: 0, buffer: 1, free: 2, deferred: 3 };
  return rows.sort((a, b) => order[a.kind] - order[b.kind]).map((row) => {
    const key = row.name.toLowerCase();
    return { ...row, label: labels[key],
      tone: row.kind === "buffer" ? "buffer" : row.kind === "free" ? "free"
        : row.kind === "deferred" ? "muted" : key === "messages" || key === "tool results" ? "messages"
        : key === "system tools" ? "tools" : key === "mcp tools" ? "mcp" : "muted",
      percent: row.kind === "deferred" ? null : row.tokens / snapshot.window * 100,
    };
  });
}

export function formatContextTokens(tokens: number): string {
  if (tokens < 1000) return String(Math.round(tokens));
  const divisor = tokens < 1_000_000 ? 1000 : 1_000_000;
  return `${(tokens / divisor).toFixed(1).replace(/\.0$/, "")}${divisor === 1000 ? "k" : "M"}`;
}
