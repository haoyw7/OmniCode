import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rm } from "node:fs/promises";
import { join, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { runBuildProcess } from "./desktop-build-process.mjs";
import { isEvaluationInput } from "./production-inputs.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const psQuote = (value) => `'${value.replaceAll("'", "''")}'`;
export const powershellCommand = (script) =>
  "powershell.exe -NoProfile -NonInteractive -EncodedCommand " +
  Buffer.from(
    `$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; ${script}`,
    "utf16le",
  ).toString("base64");

export async function createWindowsSnapshot(root, archive) {
  const candidates = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  const files = [];
  for (const path of [...new Set(candidates.split("\0"))].sort()) {
    if (isEvaluationInput(path, root)) continue;
    if (
      !/^(?:src\/|src-tauri\/|crates\/|host\/|public\/|vendor\/|scripts\/|\.cargo\/)/.test(
        path,
      ) &&
      path !== "mobile/update-config.json" &&
      path !== "mobile/update-config.release.json" &&
      !/^(?:package(?:-lock)?\.json|Cargo\.(?:toml|lock)|rust-toolchain(?:\.toml)?|(?:index|quick-composer)\.html|vite\.config\.ts|tsconfig(?:\.[\w-]+)?\.json|CHANGELOG\.md|LICENSE|NOTICE)$/.test(
        path,
      )
    )
      continue;
    if (/(^|\/)(?:node_modules|target|build|gen)\//.test(path)) continue;
    try {
      const info = await lstat(join(root, path));
      if (!info.isFile())
        throw new Error(`Windows snapshot requires regular files: ${path}`);
      files.push(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await mkdir(join(archive, ".."), { recursive: true });
  execFileSync(
    "tar",
    [
      "--create",
      "--gzip",
      "--file",
      archive,
      "--null",
      "--verbatim-files-from",
      "--files-from",
      "-",
    ],
    {
      cwd: root,
      input: `${files.join("\0")}\0`,
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
  return hash(await readFile(archive));
}

export async function buildWindowsDesktop(
  root,
  version,
  {
    host = process.env.MONOCODE_WINDOWS_SSH_HOST || "wy-win",
    repository = process.env.MONOCODE_WINDOWS_REPOSITORY ||
      "C:\\Users\\wy777\\Documents\\ohmymonocode",
    checkOnly = false,
    channel = "lan",
    assertUnchanged = async () => {},
    run = runBuildProcess,
  } = {},
) {
  if (!/^[\w.@-]+$/.test(host) || host.startsWith("-"))
    throw new Error("Invalid Windows SSH host");
  if (!/^[A-Za-z]:[\\/]/.test(repository) || /[\r\n\0]/.test(repository))
    throw new Error("Expected an absolute Windows repository path");
  if (
    !["lan", "release"].includes(channel) ||
    !(
      channel === "release" ? /^\d+\.\d+\.\d+$/ : /^\d+\.\d+\.\d+-lan\.\d+$/
    ).test(version)
  )
    throw new Error("Invalid Windows build version/channel");
  const runId = randomUUID();
  const local = join(root, "build/desktop-publish/windows", runId);
  const archive = join(local, "source.tar.gz");
  const archiveHash = await createWindowsSnapshot(root, archive);
  await assertUnchanged();
  const remote = win32.join(repository, "build/windows-lan/inbox", runId);
  const ssh = (script) =>
    run("ssh", [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      host,
      powershellCommand(script),
    ]);
  const scp = (...args) =>
    run("scp", [
      "-q",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      ...args,
    ]);
  const destination = (path) => `${host}:${path.replaceAll("\\", "/")}`;
  await ssh(
    `if (!(Test-Path -LiteralPath ${psQuote(win32.join(repository, "Cargo.toml"))})) { throw 'Windows repository not found' }; New-Item -ItemType Directory -Path ${psQuote(remote)} -Force | Out-Null`,
  );
  await scp(
    archive,
    fileURLToPath(new URL("./desktop-windows-runner.mjs", import.meta.url)),
    `${destination(remote)}/`,
  );
  const request = Buffer.from(
    JSON.stringify({
      repository,
      runId,
      version,
      archiveHash,
      checkOnly,
      channel,
    }),
  ).toString("base64");
  await ssh(
    `& node ${psQuote(win32.join(remote, "desktop-windows-runner.mjs"))} ${psQuote(request)}; exit $LASTEXITCODE`,
  );
  await scp(
    destination(win32.join(remote, "result.json")),
    join(local, "result.json"),
  );
  const receipt = JSON.parse(
    await readFile(join(local, "result.json"), "utf8"),
  );
  if (
    receipt.version !== version ||
    receipt.archiveHash !== archiveHash ||
    receipt.checked !== checkOnly ||
    (receipt.channel ?? "lan") !== channel
  )
    throw new Error(
      "Windows build receipt does not match the requested source/version",
    );
  const filename = `MonoCode_${version}_x64-setup.exe`;
  const nsis = join(local, filename);
  if (!checkOnly) {
    if (receipt.filename !== filename)
      throw new Error("Unexpected Windows installer filename");
    await scp(destination(win32.join(remote, filename)), nsis);
    const bytes = await readFile(nsis);
    if (
      bytes.length !== receipt.size ||
      hash(bytes) !== receipt.sha256 ||
      bytes.toString("ascii", 0, 2) !== "MZ"
    )
      throw new Error("Downloaded Windows installer checksum mismatch");
  }
  await assertUnchanged();
  await ssh(`Remove-Item -LiteralPath ${psQuote(remote)} -Recurse -Force`);
  await rm(archive);
  return checkOnly ? receipt : { nsis };
}
