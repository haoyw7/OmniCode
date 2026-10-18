import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  config,
  ensureUpdateServer,
  updateDirectory,
} from "./update-server.mjs";

export async function publishUpdate(
  apkDirectory,
  directory = updateDirectory(),
) {
  const metadata = JSON.parse(
    await readFile(join(apkDirectory, "output-metadata.json"), "utf8"),
  );
  const [artifact] = metadata.elements;
  if (
    metadata.applicationId !== config.packageId ||
    metadata.elements.length !== 1 ||
    !Number.isInteger(artifact?.versionCode) ||
    artifact.versionCode < 1 ||
    !/^[\w.-]+\.apk$/.test(artifact.outputFile)
  )
    throw new Error("Expected one OmniCode APK with version metadata.");
  const data = await readFile(join(apkDirectory, artifact.outputFile));
  const manifest = {
    packageId: config.packageId,
    versionCode: artifact.versionCode,
    versionName: artifact.versionName,
    downloadPath: `/apk/monocode-${artifact.versionCode}.apk`,
    size: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
    publishedAt: new Date().toISOString(),
  };
  await mkdir(join(directory, "apk"), { recursive: true });
  const lock = join(directory, ".publish-lock");
  let acquired = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await mkdir(lock);
      acquired = true;
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!acquired) throw new Error(`Publication is busy; check ${lock}`);
  const temporary = join(directory, `.publish-${randomUUID()}`);
  try {
    let latest;
    try {
      latest = JSON.parse(
        await readFile(join(directory, "latest.json"), "utf8"),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const target = join(directory, manifest.downloadPath.slice(1));
    // A versioned URL must never change after a phone has checked its checksum.
    try {
      const existing = await readFile(target);
      if (
        createHash("sha256").update(existing).digest("hex") !== manifest.sha256
      )
        throw new Error(
          `Build ${manifest.versionCode} already contains a different APK.`,
        );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeFile(temporary, data);
      await rename(temporary, target);
    }
    if (!latest || latest.versionCode < manifest.versionCode) {
      await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
      await rename(temporary, join(directory, "latest.json"));
    }
    return manifest;
  } finally {
    await rm(temporary, { force: true });
    await rm(lock, { recursive: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const manifest = await publishUpdate(resolve(process.argv[2]));
  if (process.argv.includes("--serve")) await ensureUpdateServer();
  console.log(
    `Published OmniCode ${manifest.versionName} build ${manifest.versionCode}: ${config.baseUrl}${manifest.downloadPath}`,
  );
}
