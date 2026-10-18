import type { HarnessBotCapabilities, HarnessBotContext } from "../core/botContext";

/** Adapter support, independent of an installed CLI's unrelated user MCP config. */
export function providerBotCapabilities(provider: string, context?: Pick<HarnessBotContext, "agentsMcp">): HarnessBotCapabilities {
  const nativeSystem = ["codex", "claude", "pi", "omp"].includes(provider);
  const nativeMcp = !!context?.agentsMcp && ["codex", "claude"].includes(provider);
  return {
    systemInstructions: nativeSystem ? "native" : "context-block",
    mcp: nativeMcp ? "native" : "unavailable",
    toolBridge: "control-cli",
    limitations: [
      ...(!nativeSystem ? ["This adapter delivers Bot instructions in a marked user context block; native system priority is unavailable."] : []),
      nativeMcp
        ? "Bot delegation uses the configured native MCP server. Other Host actions use the scoped control CLI."
        : context?.agentsMcp
          ? "This adapter has no per-run Host MCP configuration channel; Bot delegation and other Host actions use the scoped control CLI. User MCP settings remain unchanged."
          : "The Host MCP bridge is not configured; Host actions use the scoped control CLI.",
      "Host action permissions are enforced by the control service. They do not restrict the provider's built-in tools or user MCP servers.",
    ],
  };
}
