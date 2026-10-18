type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Localize only Host-owned framing, never provider IDs or configuration names. */
export function executionWarningText(warning: string, t: Translate): string {
  const fallback = "Using the provider installed inside WSL: ";
  if (warning.startsWith(fallback)) return t("Using the provider installed inside WSL: {provider}", { provider: warning.slice(fallback.length) });
  if (warning.startsWith("MCP: ")) return t("Disabled Windows-only MCP server: {name}", { name: warning.slice(5) });
  if (warning.startsWith("Hook: ")) return t("Disabled Windows-only hook: {name}", { name: warning.slice(6) });
  return warning;
}
