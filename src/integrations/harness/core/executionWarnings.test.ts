import { expect, it } from "vitest";
import { executionWarningText, isConfigurationExecutionWarning } from "./executionWarnings";

it("translates application framing while preserving provider and configuration values", () => {
  const t = (key: string, values?: Record<string, string | number>) => `translated:${key.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name]))}`;
  expect(executionWarningText("Using the provider installed inside WSL: pi", t)).toBe("translated:Using the provider installed inside WSL: pi");
  expect(executionWarningText("MCP: User Server 中文", t)).toBe("translated:Disabled Windows-only MCP server: User Server 中文");
  expect(executionWarningText("Hook: SessionStart", t)).toBe("translated:Disabled Windows-only hook: SessionStart");
  expect(executionWarningText("External provider message", t)).toBe("External provider message");
});

it("moves only MCP and hook compatibility notices out of conversations", () => {
  expect(["MCP: node_repl", "Hook: notify", "Using the provider installed inside WSL: pi", "Imported history"]
    .filter(warning => !isConfigurationExecutionWarning(warning))).toEqual(["Using the provider installed inside WSL: pi", "Imported history"]);
});
