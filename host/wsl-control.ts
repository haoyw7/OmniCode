import type { MachineIO } from "./machine-io";

export async function wslControlLauncher(io: MachineIO): Promise<string> {
  return io.path.join(io.path.dirname(await io.nodePath()), "monocode-control");
}

/** Generated app paths change; provider/user strings are left intact. */
export async function wslSessionEnvironment(io: MachineIO, source: Record<string, string>): Promise<Record<string, string>> {
  const env = { ...source };
  if (env.MONOCODE_WORKFLOW_CLI) env.MONOCODE_WORKFLOW_CLI = await wslControlLauncher(io);
  if (env.MONOCODE_WORKFLOW_SKILL_DIR) env.MONOCODE_WORKFLOW_SKILL_DIR = await io.hostPath(env.MONOCODE_WORKFLOW_SKILL_DIR);
  for (const key of ["TMPDIR", "TMP", "TEMP"]) {
    if (env[key] && /^(?:[a-z]:[\\/]|\\\\)/i.test(env[key])) env[key] = await io.hostPath(env[key]);
  }
  return env;
}
