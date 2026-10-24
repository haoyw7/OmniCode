import { HOST_PROTOCOL_VERSION, type HostCommand, type HostDescriptor } from "../contracts/protocol";
import { isRemoteProvider } from "../contracts/provider";

export function requireHostDescriptor(value: HostDescriptor): HostDescriptor {
  if (value?.protocolVersion !== HOST_PROTOCOL_VERSION || typeof value.environmentId !== "string"
    || !value.environmentId || !Array.isArray(value.providers) || !value.providers.every(isRemoteProvider))
    throw new Error("This machine is running an incompatible OmniCode Host");
  // Capabilities are additive. Older Hosts without a capability list remain
  // readable, but never enable an action they did not advertise.
  return Array.isArray(value.capabilities) && value.capabilities.every(item => typeof item === "string")
    ? value : { ...value, capabilities: [] };
}

/** Upgrade persisted outbox entries only; live commands use executionCwd. */
export function migrateSavedHostCommand(command: HostCommand): HostCommand {
  if (command.type !== "create" || !("worktreeCwd" in command)) return command;
  const { worktreeCwd, ...current } = command;
  return { ...current, executionCwd: current.executionCwd ?? (typeof worktreeCwd === "string" ? worktreeCwd : undefined) };
}
