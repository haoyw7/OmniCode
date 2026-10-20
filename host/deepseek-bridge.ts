import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import source from "../src/integrations/harness/providers/deepseek/bridge/bridge.mjs?raw";
import { providerLaunch } from "./process";

export const DEEPSEEK_VERSION = "0.2.1-rc.2";
export const DEEPSEEK_PROFILE = "omnicode-v1";
const preparations = new Map<
  string,
  Promise<{ path: string; args: string[]; cwd: string; deepseekHome: string }>
>();

/** Prepare only our reserved profile; credentials and sessions stay in the existing DSH home. */
export async function prepareDeepseekBridge(
  path: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const home =
    env[process.platform === "win32" ? "USERPROFILE" : "HOME"] || homedir();
  const override = env.DSH_HOME?.trim() || join(home, ".dsh");
  const expanded =
    override === "~"
      ? home
      : /^~[/\\]/.test(override)
        ? join(home, override.slice(2))
        : override;
  const root = resolve(cwd, expanded, "profiles", DEEPSEEK_PROFILE);
  // Only identical process environments can share a runtime. Never return or
  // log their values: project variables may include credentials.
  const runtimeKey = createHash("sha256").update(JSON.stringify([
    path, root, Object.entries(env).sort(([a], [b]) => a.localeCompare(b)),
  ])).digest("hex");
  // Profile writes are shared even when the resulting runtimes need different
  // environments; concurrent first use must not race ownership/file creation.
  const key = `${path}\0${root}`;
  const pending = preparations.get(key);
  if (pending) return { ...await pending, runtimeKey };
  const task = prepare(path, cwd, root, env);
  preparations.set(key, task);
  try {
    return { ...await task, runtimeKey };
  } finally {
    if (preparations.get(key) === task) preparations.delete(key);
  }
}

async function prepare(
  path: string,
  cwd: string,
  root: string,
  env: NodeJS.ProcessEnv,
) {
  const launch = await providerLaunch(path, ["--version"]);
  const output = await promisify(execFile)(launch.command, launch.args, {
    cwd,
    env,
    timeout: 20_000,
    windowsHide: true,
  });
  if (output.stdout.trim() !== DEEPSEEK_VERSION)
    throw new Error(
      `DeepSeek Harness bridge requires dsh ${DEEPSEEK_VERSION}; found ${output.stdout.trim()}`,
    );
  await mkdir(root, { recursive: true });
  const manifest = join(root, "package.json");
  try {
    const existing = JSON.parse(await readFile(manifest, "utf8"));
    if (existing.omnicodeBridge !== 1)
      throw new Error(
        "DeepSeek Harness profile omnicode-v1 is not owned by OmniCode",
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if ((await readdir(root)).length)
      throw new Error(
        "DeepSeek Harness profile omnicode-v1 is not owned by OmniCode",
      );
  }
  const files: Record<string, string> = {
    "package.json": JSON.stringify(
      {
        name: "dsh-profile-omnicode-v1",
        private: true,
        dependencies: {},
        omnicodeBridge: 1,
        dsh: {
          profile: {
            bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-acp-app"],
          },
        },
      },
      null,
      2,
    ),
    "cordis.patch.yml": "[]\n",
    "bridge.mjs": source,
    "omnicode.patch.yml": JSON.stringify(
      [
        { id: "acp", disabled: true },
        { id: "hmr", disabled: true },
        {
          insert: [
            {
              id: "omnicode-ask-user",
              name: "@deepseek-ai/dsh-tool-ask-user",
              config: { mode: "timed", timeout: 120 },
            },
            {
              id: "omnicode-auto-review",
              name: "@deepseek-ai/dsh-experimental-auto-review",
            },
            { id: "omnicode-bridge", name: "./bridge.mjs" },
          ],
        },
      ],
      null,
      2,
    ),
  };
  for (const [name, content] of Object.entries(files)) {
    const target = join(root, name);
    try {
      if ((await readFile(target, "utf8")) === content) continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, target);
  }
  return {
    path,
    cwd: root,
    deepseekHome: dirname(dirname(root)),
    args: [
      "--profile",
      DEEPSEEK_PROFILE,
      "--patch",
      join(root, "omnicode.patch.yml"),
    ],
  };
}
