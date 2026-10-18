import type { MachineIO } from "./machine-io";

export async function wslControlLauncher(io: MachineIO): Promise<string> {
  return io.path.join(io.path.dirname(await io.nodePath()), "omnicode-control");
}

/** Generated app paths change; provider/user strings are left intact. */
export async function wslSessionEnvironment(io: MachineIO, source: Record<string, string>): Promise<Record<string, string>> {
  const env = { ...source };
  if (env.OMNICODE_WORKFLOW_CLI) env.OMNICODE_WORKFLOW_CLI = await wslControlLauncher(io);
  if (env.OMNICODE_WORKFLOW_SKILL_DIR) env.OMNICODE_WORKFLOW_SKILL_DIR = await io.hostPath(env.OMNICODE_WORKFLOW_SKILL_DIR);
  for (const key of ["TMPDIR", "TMP", "TEMP"]) {
    if (env[key] && /^(?:[a-z]:[\\/]|\\\\)/i.test(env[key])) env[key] = await io.hostPath(env[key]);
  }
  return env;
}
