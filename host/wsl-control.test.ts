import { expect, it } from "vitest";
import { WslMachineIO, withMachineIO } from "./machine-io";
import { HostControl } from "./control";
import { wslControlLauncher, wslSessionEnvironment } from "./wsl-control";

it("uses the daemon's immutable runtime launcher and maps shared Host paths", async () => {
  const requests: Array<{ op: string; params: Record<string, unknown> }> = [];
  const node = "/home/test/.monocode/remote/host/build-abc/bin/node";
  const io = new WslMachineIO("Ubuntu", { request: async <T>(op: string, params = {}) => {
    requests.push({ op, params });
    if (op === "env.info") return { node } as T;
    if (op === "exec") return { code: 0, stdout: Buffer.from("/mnt/c/Host Data/skills\n").toString("base64"), stderr: "", signal: null } as T;
    throw new Error(`Unexpected operation ${op}`);
  } });
  const control = new HostControl(async () => ({}));
  try {
    expect(await wslControlLauncher(io)).toBe("/home/test/.monocode/remote/host/build-abc/bin/monocode-control");
    expect(await withMachineIO(io, () => control.launcher("C:\\Host Data\\control", "C:\\app\\host.mjs", "C:\\node.exe")))
      .toBe("/home/test/.monocode/remote/host/build-abc/bin/monocode-control");
    const source = { MONOCODE_WORKFLOW_CLI: "C:\\Host Data\\control.cmd", MONOCODE_WORKFLOW_SKILL_DIR: "C:\\Host Data\\skills", CUSTOM: "C:\\user-choice", TMPDIR: "/tmp/worker" };
    expect(await wslSessionEnvironment(io, source)).toEqual({ ...source,
      MONOCODE_WORKFLOW_CLI: "/home/test/.monocode/remote/host/build-abc/bin/monocode-control",
      MONOCODE_WORKFLOW_SKILL_DIR: "/mnt/c/Host Data/skills" });
    expect(source.MONOCODE_WORKFLOW_CLI).toBe("C:\\Host Data\\control.cmd");
    expect(requests.filter(({ op }) => op === "exec")).toEqual([
      { op: "exec", params: expect.objectContaining({ command: "wslpath", args: ["-a", "C:\\Host Data\\skills"] }) },
    ]);
    expect(requests.some(({ op }) => op.startsWith("fs."))).toBe(false);
  } finally { await control.close(); }
});
