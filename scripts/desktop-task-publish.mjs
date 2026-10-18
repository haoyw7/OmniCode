import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { prepareDesktopUpdate, readDesktopLanConfig } from "./publish-desktop-update.mjs";
import { buildWindowsDesktop } from "./desktop-windows-build.mjs";
import { runBuildProcess } from "./desktop-build-process.mjs";
import { isEvaluationInput } from "./production-inputs.mjs";

const rootInputs = new Set([
  "index.html",
  "quick-composer.html",
  "vite.config.ts",
  "tsconfig.json",
  "tsconfig.node.json",
  "package.json",
  "package-lock.json",
  "Cargo.toml",
  "Cargo.lock",
  "rust-toolchain",
  "rust-toolchain.toml",
  "LICENSE",
  "NOTICE",
  "scripts/production-inputs.mjs",
]);

function isBuildInput(path) {
  if (isEvaluationInput(path)) return false;
  if (/(^|\/)(?:__tests__|tests?|node_modules|target|build|gen)\//.test(path))
    return false;
  if (/\.(?:test|spec)\.[^/]+$/.test(path)) return false;
  if (path.endsWith(".md")) {
    return (
      path === "CHANGELOG.md" ||
      path.startsWith("src/instructions/") ||
      path.startsWith("host/workflows/skill/")
    );
  }
  if (
    path ===
    "src/integrations/workflow/dynamic-workflow/compiler/libs.generated.ts"
  )
    return false;
  return (
    rootInputs.has(path) ||
    (path.startsWith("src/") && !path.startsWith("src/mobile/")) ||
    ["src-tauri/", "crates/", "host/", "public/", "vendor/", ".cargo/"].some(
      (prefix) => path.startsWith(prefix),
    ) ||
    /^scripts\/(?:desktop-|publish-desktop-update\.|turn-publish\.)/.test(path)
  );
}

export async function sourceFingerprint(root) {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  const hash = createHash("sha256");
  for (const path of [
    ...new Set(files.split("\0").filter(isBuildInput)),
  ].sort()) {
    try {
      const content = await readFile(join(root, path));
      hash.update(JSON.stringify(path));
      hash.update(createHash("sha256").update(content).digest());
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return hash.digest("hex");
}

export async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// A prerelease of the next patch sorts above the checkout's stable version,
// while a future official release of that patch still sorts above the LAN build.
export function nextLanVersion(base, previous, now = Date.now()) {
  if (!/^\d+\.\d+\.\d+$/.test(base))
    throw new Error("LAN builds require a stable source version");
  const core = base.split(".").map(Number);
  core[2]++;
  const match = previous?.match(/^(\d+)\.(\d+)\.(\d+)(?:-lan\.(\d+))?$/);
  if (previous && !match)
    throw new Error("Unrecognized published version; refusing to replace it");
  if (match) {
    const prior = match.slice(1, 4).map(Number);
    const difference =
      core.map((n, i) => n - prior[i]).find((n) => n !== 0) ?? 0;
    if (difference < 0 || (difference === 0 && !match[4])) {
      throw new Error(
        "A newer desktop version is published; update the source version first",
      );
    }
  }
  const counter = Math.max(now, Number(match?.[4] ?? 0) + 1);
  return `${core.join(".")}-lan.${counter}`;
}

export async function buildDesktop(root, version) {
  const config = join(root, "build/desktop-publish/tauri.lan.conf.json");
  await mkdir(dirname(config), { recursive: true });
  const lan = await readDesktopLanConfig(root);
  await writeFile(
    config,
    JSON.stringify({ version, plugins: { updater: lan.plugins.updater } }),
  );
  await runBuildProcess(
    "npm",
    ["run", "build:linux", "--", "--config", config, "--ci"],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
}

export async function buildAllDesktops(
  root,
  version,
  assertUnchanged,
  { linux = buildDesktop, windows = buildWindowsDesktop } = {},
) {
  const timed = async (platform, build) => {
    const started = performance.now();
    console.log(`[desktop:${platform}] Build started (${version})`);
    let succeeded = false;
    try {
      const result = await build();
      succeeded = true;
      return result;
    } finally {
      console.log(
        `[desktop:${platform}] Build ${succeeded ? "completed" : "failed"} after ${((performance.now() - started) / 1000).toFixed(1)}s`,
      );
    }
  };
  // Wait for both even on failure: releasing the publication lock while one
  // builder is still working would let the next invocation overlap it.
  const results = await Promise.allSettled([
    timed("linux", () => linux(root, version)),
    timed("windows", () => windows(root, version, { assertUnchanged })),
  ]);
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
  await assertUnchanged();
  return results[1].value;
}

export async function deployDesktopUpdate({ output, directory, beforeCommit }) {
  let privileged = false;
  try {
    await access(directory, constants.W_OK);
  } catch (error) {
    if (error.code !== "EACCES") throw error;
    privileged = true;
  }
  const run = (command, args) =>
    execFileSync(
      privileged ? "sudo" : command,
      privileged ? ["-n", command, ...args] : args,
      { stdio: "pipe" },
    );
  const temporary = join(directory, `.monocode-latest-${randomUUID()}.json`);
  try {
    run("cp", [
      "-R",
      "--no-preserve=ownership",
      join(output, "monocode-desktop"),
      directory,
    ]);
    run("install", ["-m", "644", join(output, "latest.json"), temporary]);
    await beforeCommit();
    run("mv", [temporary, join(directory, "latest.json")]);
  } finally {
    run("rm", ["-f", temporary]);
  }
}

export async function verifyDeployment({ root, directory, manifest }) {
  const config = await readDesktopLanConfig(root);
  const endpoint = config.plugins.updater.endpoints[0];
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || !isDeepStrictEqual(await response.json(), manifest)) {
    throw new Error(`Desktop update feed verification failed: ${endpoint}`);
  }
  for (const url of new Set(
    Object.values(manifest.platforms).map((entry) => entry.url),
  )) {
    const file = join(directory, decodeURIComponent(new URL(url).pathname));
    const info = await stat(file);
    const download = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(10_000),
    });
    if (
      !download.ok ||
      Number(download.headers.get("content-length")) !== info.size ||
      !info.size
    ) {
      throw new Error(`Desktop package verification failed: ${url}`);
    }
  }
}

export async function publishCompletedTask({
  root,
  directory = process.env.MONOCODE_DESKTOP_UPDATE_DIR || "/var/www/html",
  expectedFingerprint,
  build = buildAllDesktops,
  prepare = prepareDesktopUpdate,
  deploy = deployDesktopUpdate,
  verify = verifyDeployment,
}) {
  const stateFile = join(root, "build/desktop-publish/last-success.json");
  const fingerprint = await sourceFingerprint(root);
  if (expectedFingerprint && fingerprint !== expectedFingerprint) {
    throw new Error(
      "Sources changed after the turn ended. Nothing was published.",
    );
  }
  const previous = await readJson(stateFile);
  const latest = await readJson(join(directory, "latest.json"));
  if (
    previous?.fingerprint === fingerprint &&
    isDeepStrictEqual(previous.manifest, latest)
  ) {
    await verify({ root, directory, manifest: latest });
    return { skipped: true, manifest: latest };
  }
  const config = await readJson(join(root, "src-tauri/tauri.conf.json"));
  const version = nextLanVersion(config.version, latest?.version);
  const output = join(root, "build/desktop-publish", `site-${version}`);
  const assertUnchanged = async () => {
    if ((await sourceFingerprint(root)) !== fingerprint) {
      throw new Error(
        "Sources changed during the build/publication. Nothing was published; finish the task and run desktop:publish again.",
      );
    }
  };
  const artifacts = await build(root, version, assertUnchanged);
  await assertUnchanged();
  const manifest = await prepare({ root, version, output, ...artifacts });
  await assertUnchanged();
  await deploy({ output, directory, beforeCommit: assertUnchanged });
  if (
    !isDeepStrictEqual(await readJson(join(directory, "latest.json")), manifest)
  ) {
    throw new Error(
      "Another desktop release replaced this publication. Retry after all builds finish.",
    );
  }
  await verify({ root, directory, manifest });
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(
    `${stateFile}.tmp`,
    `${JSON.stringify({ fingerprint, manifest }, null, 2)}\n`,
  );
  await rename(`${stateFile}.tmp`, stateFile);
  return { skipped: false, manifest };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.platform !== "linux" || process.arch !== "x64")
      throw new Error(
        "Desktop LAN publication must run on the Linux x64 update server (Windows builds use SSH)",
      );
    const args = process.argv.slice(2);
    if (
      args.length &&
      (args.length !== 2 ||
        args[0] !== "--expected-fingerprint" ||
        !/^[a-f0-9]{64}$/.test(args[1]))
    ) {
      throw new Error("Usage: desktop:publish [--expected-fingerprint SHA256]");
    }
    const root = fileURLToPath(new URL("../", import.meta.url));
    const key = join(
      homedir(),
      ".local/share/monocode/desktop-updates/signing.key",
    );
    const config = await readJson(join(root, "src-tauri/tauri.conf.json"));
    await access(key, constants.R_OK);
    if (
      (await readFile(`${key}.pub`, "utf8")).trim() !==
      config.plugins.updater.pubkey
    ) {
      throw new Error(
        "The local desktop signing key does not match the configured public key",
      );
    }
    const { skipped, manifest } = await publishCompletedTask({
      root,
      expectedFingerprint: args[1],
    });
    console.log(
      `${skipped ? "Already published" : "Published"} OmniCode ${manifest.displayVersion ?? manifest.version}:\nLinux: ${manifest.platforms["linux-x86_64-deb"].url}\nWindows: ${manifest.platforms["windows-x86_64-nsis"].url}`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
