import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { wslRuntimeDirectory, WslRequestError } from "./wsl";

let directory: string;
const files = ["SHA256SUMS", "ARCH", "VERSION", "bin/node", "bin/omnicode-control",
  "control-cli.mjs", "wsl-exec.mjs", "wsl-exec-protocol.mjs"];

async function runtime(path: string) {
  for (const file of files) {
    await mkdir(dirname(join(path, file)), { recursive: true });
    await writeFile(join(path, file), "fixture");
  }
  return path;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "omnicode-wsl-runtime-"));
  vi.stubEnv("OMNICODE_WSL_RUNTIME", "");
  vi.spyOn(process, "cwd").mockReturnValue(directory);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

it("accepts a complete configured runtime", async () => {
  const path = await runtime(join(directory, "configured"));
  expect(await wslRuntimeDirectory(path)).toBe(path);
});

it("rejects the old launcher name before starting WSL", async () => {
  const path = await runtime(join(directory, "legacy"));
  await rename(join(path, "bin/omnicode-control"), join(path, "bin/monocode-control"));
  await expect(wslRuntimeDirectory(path)).rejects.toMatchObject({
    name: "WslRequestError", delivered: false,
    message: "The WSL execution runtime is incomplete or outdated. Update or reinstall OmniCode.",
  });
});

it.each(files)("rejects a runtime missing %s", async (file) => {
  const path = await runtime(join(directory, "incomplete"));
  await rm(join(path, file));
  await expect(wslRuntimeDirectory(path)).rejects.toThrow("incomplete or outdated");
});

it("does not accept a directory in place of the control launcher", async () => {
  const path = await runtime(join(directory, "incomplete"));
  await rm(join(path, "bin/omnicode-control"));
  await mkdir(join(path, "bin/omnicode-control"));
  await expect(wslRuntimeDirectory(path)).rejects.toThrow("incomplete or outdated");
});

it("falls back from an incomplete environment runtime to a complete development runtime", async () => {
  const stale = await runtime(join(directory, "stale"));
  await rm(join(stale, "bin/omnicode-control"));
  vi.stubEnv("OMNICODE_WSL_RUNTIME", stale);
  const development = await runtime(join(directory, "build/wsl-host"));
  expect(await wslRuntimeDirectory()).toBe(development);
  await expect(wslRuntimeDirectory(stale)).rejects.toThrow("incomplete or outdated");
});

it("reports an absent runtime separately from an incomplete one", async () => {
  await expect(wslRuntimeDirectory(join(directory, "absent"))).rejects.toBeInstanceOf(WslRequestError);
  await expect(wslRuntimeDirectory(join(directory, "absent"))).rejects.toThrow(
    "The WSL execution runtime is missing from this installation.",
  );
});
