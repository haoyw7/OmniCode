import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareDeepseekBridge } from "./deepseek-bridge";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});

async function fixture(version = "0.2.1-rc.2") {
  const root = await mkdtemp(join(tmpdir(), "omnicode-dsh-profile-"));
  directories.push(root);
  const binary = join(root, "dsh fixture.mjs");
  await writeFile(binary, `console.log(${JSON.stringify(version)})`);
  vi.stubEnv("DSH_HOME", join(root, "DSH home"));
  return {
    root,
    binary,
    profile: join(root, "DSH home", "profiles", "omnicode-v1"),
  };
}

describe("DeepSeek bridge preparation", () => {
  it("is repeatable, handles spaces, and preserves existing credentials and other profiles", async () => {
    const { root, binary, profile } = await fixture();
    await mkdir(join(root, "DSH home", "profiles", "web"), { recursive: true });
    const credential = join(root, "DSH home", ".credentials.yaml");
    await writeFile(credential, "fixture-credential");
    const results = await Promise.all([
      prepareDeepseekBridge(binary, root),
      prepareDeepseekBridge(binary, root),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].args).toEqual([
      "--profile",
      "omnicode-v1",
      "--patch",
      join(profile, "omnicode.patch.yml"),
    ]);
    expect(await readFile(credential, "utf8")).toBe("fixture-credential");
    expect(await readdir(join(root, "DSH home", "profiles"))).toContain("web");
    expect(await readFile(join(profile, "bridge.mjs"), "utf8")).toContain(
      "agent/assistant-stream",
    );
    await prepareDeepseekBridge(binary, root);
    expect((await readdir(profile)).some((name) => name.endsWith(".tmp"))).toBe(
      false,
    );
  });

  it("refuses an occupied profile and leaves it untouched", async () => {
    const { root, binary, profile } = await fixture();
    await mkdir(profile, { recursive: true });
    await writeFile(join(profile, "package.json"), '{"name":"user-profile"}');
    await expect(prepareDeepseekBridge(binary, root)).rejects.toThrow(
      "not owned",
    );
    expect(await readdir(profile)).toEqual(["package.json"]);
  });

  it("does not adopt a nonempty directory without an ownership manifest", async () => {
    const { root, binary, profile } = await fixture();
    await mkdir(profile, { recursive: true });
    await writeFile(join(profile, "bridge.mjs"), "user plugin");
    await expect(prepareDeepseekBridge(binary, root)).rejects.toThrow(
      "not owned",
    );
    expect(await readFile(join(profile, "bridge.mjs"), "utf8")).toBe(
      "user plugin",
    );
  });

  it("rejects incompatible CLI versions before preparing a profile", async () => {
    const { root, binary, profile } = await fixture("0.3.0");
    await expect(prepareDeepseekBridge(binary, root)).rejects.toThrow(
      "requires dsh 0.2.1-rc.2",
    );
    await expect(readdir(profile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("prepares the same DSH home that the selected Host session will use", async () => {
    const { root, binary } = await fixture();
    const launch = await prepareDeepseekBridge(binary, root, {
      ...process.env,
      DSH_HOME: "relative session home",
    });
    const profile = join(
      root,
      "relative session home",
      "profiles",
      "omnicode-v1",
    );
    expect(launch.args.at(-1)).toBe(join(profile, "omnicode.patch.yml"));
    expect(
      JSON.parse(await readFile(join(profile, "package.json"), "utf8"))
        .omnicodeBridge,
    ).toBe(1);
  });
});
