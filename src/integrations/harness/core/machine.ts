/** Execution location is separate from the Host that owns the conversation. */
export type ProjectMachine = { kind: "wsl"; distribution: string };

export function parseProjectMachine(value: unknown): ProjectMachine | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid project machine");
  const machine = value as Record<string, unknown>;
  if (machine.kind !== "wsl" || typeof machine.distribution !== "string" ||
      !machine.distribution.trim() || machine.distribution.length > 128 || /[\x00-\x1f\x7f/\\]/.test(machine.distribution))
    throw new Error("Invalid WSL distribution");
  return { kind: "wsl", distribution: machine.distribution };
}

export const projectMachineKey = (machine?: ProjectMachine): string => machine ? `wsl:${machine.distribution}` : "local";
