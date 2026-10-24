import type { ContextBreakdown, ContextCategory, ContextToolUsage } from "../../../contracts/session";




/** Validate optional JSON from older local stores before exposing it to renderers. */
export function restoreContextBreakdown(value: unknown): ContextBreakdown | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const count = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (!count(row.used) || !count(row.window) || row.window <= 0 || !count(row.updatedAt) || !Array.isArray(row.categories)) return undefined;
  const categories = row.categories.filter((category): category is ContextCategory => !!category &&
    typeof category.name === "string" && count(category.tokens) && ["used", "free", "buffer", "deferred"].includes(category.kind));
  if (!categories.length) return undefined;
  const tools = Array.isArray(row.tools) ? row.tools.filter((tool): tool is ContextToolUsage => !!tool &&
    typeof tool.name === "string" && count(tool.tokens) && (tool.group === "mcp" || tool.group === "system") &&
    (tool.server === undefined || typeof tool.server === "string") &&
    (tool.deferred === undefined || typeof tool.deferred === "boolean")) : [];
  return { used: row.used, window: row.window, updatedAt: row.updatedAt, estimated: row.estimated !== false, categories,
    ...(tools.length ? { tools } : {}),
    ...(count(row.toolResultTokens) ? { toolResultTokens: row.toolResultTokens } : {}),
    ...(count(row.autoCompactThreshold) ? { autoCompactThreshold: row.autoCompactThreshold } : {}),
    ...(typeof row.autoCompactEnabled === "boolean" ? { autoCompactEnabled: row.autoCompactEnabled } : {}),
  };
}
