import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve, posix } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { publishUpdate } from "./publish-update.mjs";
import {
  config,
  ensureUpdateServer,
  updateDirectory,
} from "./update-server.mjs";

const configFiles = new Set([
  "mobile.html",
  "capacitor.config.ts",
  "vite.mobile.config.ts",
  "tsconfig.json",
  "tsconfig.node.json",
  "tsconfig.mobile-tools.json",
  "package.json",
  "package-lock.json",
  "scripts/production-inputs.mjs",
]);
const generatedFiles = new Set([
  "src/integrations/workflow/dynamic-workflow/compiler/libs.generated.ts",
  "mobile/android/app/capacitor.build.gradle",
  "mobile/android/capacitor.settings.gradle",
]);

function isBuildInput(path) {
  if (generatedFiles.has(path)) return false;
  if (path === "CHANGELOG.md") return true;
  if (/(^|\/)(?:__tests__|test|androidTest)\//.test(path)) return false;
  if (/\.(?:test|spec)\.[^/]+$|\.md$/.test(path)) return false;
  return (
    configFiles.has(path) ||
    path.startsWith("src/") ||
    path.startsWith("public/") ||
    path.startsWith("mobile/android/") ||
    (path.startsWith("mobile/") && !path.slice(7).includes("/"))
  );
}

// Follow local imports from mobile code so unrelated desktop changes do not
// trigger APK publication. All mobile files and shared styles remain inputs.
async function mobileInputs(root, available) {
  const selected = new Set(
    [...available].filter(
      (path) =>
        !path.startsWith("src/") ||
        path.startsWith("src/mobile/") ||
        path.startsWith("src/styles/"),
    ),
  );
  const pending = [...selected].filter((path) => path.startsWith("src/"));
  while (pending.length) {
    const path = pending.pop();
    let content;
    try {
      content = await readFile(join(root, path), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const imports = /\.[cm]?[jt]sx?$/.test(path)
      ? ts
          .preProcessFile(content, true, true)
          .importedFiles.map((entry) => entry.fileName)
      : path.endsWith(".css")
        ? [
            ...content.matchAll(
              /(?:@import\s+["']|url\(\s*["']?)([^"')\s;]+)/g,
            ),
          ].map((match) => match[1])
        : [];
    for (const specifier of imports) {
      if (!specifier.startsWith(".") && !specifier.startsWith("@mobile/"))
        continue;
      const base = specifier.startsWith("@mobile/")
        ? `src/mobile/${specifier.slice(8)}`
        : posix.normalize(
            posix.join(posix.dirname(path), specifier.split("?")[0]),
          );
      const dependency = [
        base,
        ...[
          ".ts",
          ".tsx",
          ".js",
          ".jsx",
          ".mts",
          ".cts",
          ".mjs",
          ".cjs",
          ".json",
          "/index.ts",
          "/index.tsx",
          "/index.js",
        ].map((suffix) => base + suffix),
      ].find((candidate) => available.has(candidate));
      if (dependency && !selected.has(dependency)) {
        selected.add(dependency);
        pending.push(dependency);
      }
    }
  }
  return [...selected].sort();
}

// Include shared UI/style changes and untracked files. Git excludes generated
// assets and build directories; explicitly omit tracked Capacitor outputs too.
export async function sourceFingerprint(root) {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  const hash = createHash("sha256");
  for (const path of await mobileInputs(
    root,
    new Set(files.split("\0").filter(isBuildInput)),
  )) {
    let content;
    try {
      content = await readFile(join(root, path));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    hash.update(JSON.stringify(path));
    hash.update(createHash("sha256").update(content).digest());
  }
  return hash.digest("hex");
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function buildApk(root) {
  const result = spawnSync("npm", ["run", "mobile:apk"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      OMNICODE_UPDATE_CHANNEL: "lan",
      OMNICODE_MOBILE_DEFER_PUBLISH: "1",
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Mobile build failed (${result.signal ?? result.status}).`);
}

// Called by the turn-end hook, or manually after relevant checks pass.
// The shell entry holds the build lock; this function also supports isolated tests.
export async function publishCompletedTask({
  root,
  directory = updateDirectory(),
  build = buildApk,
  ensureServer = ensureUpdateServer,
  expectedFingerprint,
}) {
  const stateFile = join(root, "build/mobile-publish/last-success.json");
  const fingerprint = await sourceFingerprint(root);
  if (expectedFingerprint && fingerprint !== expectedFingerprint)
    throw new Error(
      "Sources changed after the turn ended. Nothing was published.",
    );
  const previous = await readJson(stateFile);
  const latest = await readJson(join(directory, "latest.json"));
  if (
    previous?.fingerprint === fingerprint &&
    previous?.versionCode === latest?.versionCode &&
    previous?.sha256 === latest?.sha256
  ) {
    await ensureServer();
    return { skipped: true, manifest: latest };
  }

  await build(root);
  if ((await sourceFingerprint(root)) !== fingerprint) {
    throw new Error(
      "Sources changed during the build. Nothing was published; finish the task and run mobile:publish again.",
    );
  }
  const manifest = await publishUpdate(
    join(root, "mobile/android/app/build/outputs/apk/debug"),
    directory,
  );
  const published = await readJson(join(directory, "latest.json"));
  if (
    published.versionCode !== manifest.versionCode ||
    published.sha256 !== manifest.sha256
  )
    throw new Error(
      "A newer APK was published by another build. Retry after all builds finish.",
    );
  await ensureServer();
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(
    `${stateFile}.tmp`,
    `${JSON.stringify({ fingerprint, versionCode: manifest.versionCode, sha256: manifest.sha256 }, null, 2)}\n`,
  );
  await rename(`${stateFile}.tmp`, stateFile);
  return { skipped: false, manifest };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const args = process.argv.slice(2);
    if (
      args.length &&
      (args.length !== 2 ||
        args[0] !== "--expected-fingerprint" ||
        !/^[a-f0-9]{64}$/.test(args[1]))
    )
      throw new Error("Usage: mobile:publish [--expected-fingerprint SHA256]");
    const { skipped, manifest } = await publishCompletedTask({
      root,
      expectedFingerprint: args[1],
    });
    console.log(
      `${skipped ? "Already published" : "Published"} OmniCode ${manifest.versionName} build ${manifest.versionCode}: ${config.baseUrl}${manifest.downloadPath}`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
