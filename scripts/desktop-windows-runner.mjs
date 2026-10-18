// Copied to the Windows builder; intentionally uses only Node built-ins.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const workspaceCaches = new Set([
  "node_modules",
  "target",
  "build",
  ".monocode-windows-builder",
  "host/im/node_modules",
]);

// Compare contents instead of replacing the whole source tree. Cargo watches
// source mtimes; rewriting unchanged files defeats its existing target cache.
export async function syncWindowsSources(source, workspace, relative = "") {
  const entries = await readdir(source, { withFileTypes: true });
  const names = new Set(entries.map((entry) => entry.name));
  await mkdir(workspace, { recursive: true });
  for (const name of await readdir(workspace)) {
    const path = relative ? `${relative}/${name}` : name;
    if (!names.has(name) && !workspaceCaches.has(path))
      await rm(join(workspace, name), { recursive: true, force: true });
  }
  for (const entry of entries) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (workspaceCaches.has(path))
      throw new Error(
        `Windows source archive contains a reserved cache path: ${path}`,
      );
    const input = join(source, entry.name);
    const output = join(workspace, entry.name);
    let existing;
    try {
      existing = await lstat(output);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (entry.isDirectory()) {
      if (existing && !existing.isDirectory())
        await rm(output, { recursive: true, force: true });
      await syncWindowsSources(input, output, path);
    } else if (entry.isFile()) {
      const bytes = await readFile(input);
      if (existing?.isFile() && bytes.equals(await readFile(output))) continue;
      if (existing) await rm(output, { recursive: true, force: true });
      await copyFile(input, output);
    } else {
      throw new Error(`Windows source archive requires regular files: ${path}`);
    }
  }
}

async function dependencyFingerprint(workspace, npm) {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify([process.version, process.platform, process.arch]),
  );
  for (const path of [
    "package.json",
    "package-lock.json",
    ".npmrc",
    "host/im/package.json",
    "host/im/package-lock.json",
    "host/im/.npmrc",
  ]) {
    hash.update(JSON.stringify(path));
    try {
      hash.update(digest(await readFile(join(workspace, path))));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      hash.update("missing");
    }
  }
  // Reinstall after npm upgrades too, including changes to install policy.
  hash.update(await readFile(join(dirname(npm), "../package.json")));
  return hash.digest("hex");
}

export async function ensureWindowsDependencies(workspace, npm, options, run) {
  const fingerprint = await dependencyFingerprint(workspace, npm);
  const marker = join(workspace, "build/windows-dependencies.json");
  let reusable = false;
  try {
    reusable =
      JSON.parse(await readFile(marker, "utf8")).fingerprint === fingerprint;
    await access(join(workspace, "node_modules/.package-lock.json"));
    await access(join(workspace, "host/im/node_modules/.package-lock.json"));
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    reusable = false;
  }
  if (reusable) {
    console.log(
      "[desktop:windows] Reusing npm dependencies (lockfiles and toolchain unchanged)",
    );
    return;
  }
  // A failed install must never leave an old success marker reusable.
  await rm(marker, { force: true });
  run(process.execPath, [npm, "ci", "--no-audit", "--no-fund"], options);
  await access(join(workspace, "node_modules/.package-lock.json"));
  await access(join(workspace, "host/im/node_modules/.package-lock.json"));
  await mkdir(dirname(marker), { recursive: true });
  await writeFile(marker, JSON.stringify({ fingerprint }));
}

export async function runWindowsBuild(
  {
    repository,
    runId,
    version,
    archiveHash,
    checkOnly = false,
    channel = "lan",
  },
  {
    run = (command, args, options) =>
      execFileSync(command, args, { stdio: "inherit", ...options }),
    npm = join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
  } = {},
) {
  if (
    !/^[a-f0-9-]{36}$/.test(runId) ||
    !["lan", "release"].includes(channel) ||
    !(
      channel === "release" ? /^\d+\.\d+\.\d+$/ : /^\d+\.\d+\.\d+-lan\.\d+$/
    ).test(version)
  )
    throw new Error("Invalid Windows build identity");
  const state = join(repository, "build/windows-lan");
  const inbox = join(state, "inbox", runId);
  const workspace = join(state, "workspace");
  const lock = join(state, "build.lock");
  await mkdir(state, { recursive: true });
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        `Windows publication is already running (or was interrupted). Inspect ${lock} before retrying.`,
      );
    throw error;
  }
  try {
    await writeFile(
      join(lock, "owner.json"),
      JSON.stringify({ pid: process.pid, runId, version }),
    );
    const archive = join(inbox, "source.tar.gz");
    if (digest(await readFile(archive)) !== archiveHash)
      throw new Error("Windows source archive checksum mismatch");
    // Never clean an arbitrary checkout or another tool's directory.
    const marker = join(workspace, ".monocode-windows-builder");
    try {
      await mkdir(workspace);
      await writeFile(marker, "1");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await access(marker);
    }
    const unpacked = join(inbox, "source");
    await rm(unpacked, { recursive: true, force: true });
    await mkdir(unpacked);
    run("tar.exe", ["-xzf", archive, "-C", unpacked]);
    const syncStarted = performance.now();
    await syncWindowsSources(unpacked, workspace);
    await rm(unpacked, { recursive: true, force: true });
    console.log(
      `[desktop:windows] Source synchronization: ${((performance.now() - syncStarted) / 1000).toFixed(1)}s`,
    );
    const env = {
      ...process.env,
      CARGO_TARGET_DIR: join(workspace, "target"),
      RUSTUP_TOOLCHAIN: "stable-x86_64-pc-windows-msvc",
    };
    delete env.TAURI_SIGNING_PRIVATE_KEY;
    delete env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
    const options = { cwd: workspace, env };
    run(process.execPath, ["--version"], options);
    run(process.execPath, [npm, "--version"], options);
    run("cargo.exe", ["--version"], options);
    run("rustc.exe", ["--version"], options);
    const config = join(workspace, "build/tauri.lan.conf.json");
    await mkdir(dirname(config), { recursive: true });
    const releaseConfig = JSON.parse(
      await readFile(
        join(workspace, `src-tauri/tauri.${channel}.conf.json`),
        "utf8",
      ),
    );
    await writeFile(config, JSON.stringify({ ...releaseConfig, version }));
    const receipt = { version, archiveHash, checked: checkOnly, channel };
    if (!checkOnly) {
      const installStarted = performance.now();
      await ensureWindowsDependencies(workspace, npm, options, run);
      console.log(
        `[desktop:windows] Dependencies: ${((performance.now() - installStarted) / 1000).toFixed(1)}s`,
      );
      // Use a relative config path: npm forwards arguments through cmd.exe.
      run(
        process.execPath,
        [
          npm,
          "run",
          "build:windows",
          "--",
          "--config",
          "build/tauri.lan.conf.json",
          "--ci",
        ],
        options,
      );
      const filename = `MonoCode_${version}_x64-setup.exe`;
      const source = join(workspace, "target/release/bundle/nsis", filename);
      const bytes = await readFile(source);
      if (bytes.toString("ascii", 0, 2) !== "MZ")
        throw new Error(
          "Windows build did not produce an executable installer",
        );
      await copyFile(source, join(inbox, filename));
      Object.assign(receipt, {
        filename,
        sha256: digest(bytes),
        size: bytes.length,
      });
    }
    await writeFile(join(inbox, "result.json"), JSON.stringify(receipt));
    return receipt;
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.platform !== "win32" || process.arch !== "x64")
      throw new Error("The Windows builder requires Windows x64");
    await runWindowsBuild(
      JSON.parse(Buffer.from(process.argv[2], "base64").toString("utf8")),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
