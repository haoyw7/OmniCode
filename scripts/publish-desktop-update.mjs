import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { formatBuildVersion } from "../src/shared/lib/buildVersion.ts";

// Manual LAN publication has its own endpoint; ordinary builds use GitHub.
export async function readDesktopLanConfig(root) {
  const config = JSON.parse(
    await readFile(join(root, "src-tauri/tauri.conf.json"), "utf8"),
  );
  const lan = JSON.parse(
    await readFile(join(root, "src-tauri/tauri.lan.conf.json"), "utf8"),
  );
  return {
    ...config,
    plugins: {
      ...config.plugins,
      updater: { ...config.plugins.updater, ...lan.plugins.updater },
    },
  };
}

// Prepare a static Tauri feed. Deploy the packages before replacing latest.json.
export async function publishDesktopUpdate({
  version,
  deb,
  appimage,
  nsis,
  output,
  baseUrl,
  sign,
}) {
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version)) {
    throw new Error("Expected a desktop semantic version");
  }
  const displayVersion = formatBuildVersion(version);
  await mkdir(output, { recursive: true });
  const staging = join(output, `.publish-${randomUUID()}`);
  await mkdir(staging);
  try {
    const platforms = {};
    for (const [platform, source] of [
      ["linux-x86_64-deb", deb],
      ["linux-x86_64-appimage", appimage],
      ...(nsis ? [["windows-x86_64-nsis", nsis]] : []),
    ]) {
      const filename = basename(source).replace(version, displayVersion);
      const file = join(staging, filename);
      await copyFile(source, file);
      // Windows SCP downloads can be owner-only; nginx must read every package.
      await chmod(file, platform === "linux-x86_64-appimage" ? 0o755 : 0o644);
      const digest = createHash("sha256")
        .update(await readFile(file))
        .digest("hex");
      const signature = (await sign(file)).trim();
      if (!signature)
        throw new Error(`Missing updater signature for ${platform}`);
      const path = `omnicode-desktop/${version}/${digest}/${filename}`;
      const destination = join(output, path);
      await mkdir(dirname(destination), { recursive: true });
      await rename(file, destination);
      platforms[platform] = {
        url: new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`)
          .href,
        signature,
      };
    }
    // Development binaries have no bundle type; packaged builds use the
    // installer-specific target above so DEB users never receive an AppImage.
    platforms["linux-x86_64"] = platforms["linux-x86_64-appimage"];
    if (nsis) platforms["windows-x86_64"] = platforms["windows-x86_64-nsis"];
    const manifest = {
      version,
      displayVersion,
      notes: `OmniCode ${displayVersion}`,
      pub_date: new Date().toISOString(),
      platforms,
    };
    const manifestFile = join(staging, "latest.json");
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(manifestFile, join(output, "latest.json"));
    return manifest;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function prepareDesktopUpdate({
  root = fileURLToPath(new URL("../", import.meta.url)),
  version,
  deb,
  appimage,
  nsis,
  output = join(root, "build/desktop-update-site"),
  key = join(homedir(), ".local/share/omnicode/desktop-updates/signing.key"),
} = {}) {
  const config = await readDesktopLanConfig(root);
  const publicKey = (await readFile(`${key}.pub`, "utf8")).trim();
  if (publicKey !== config.plugins.updater.pubkey) {
    throw new Error(
      "The signing key's public key must match the desktop updater configuration",
    );
  }
  version ??= config.version;
  const filename = `OmniCode_${version}_amd64`;
  deb ??= join(root, "target/release/bundle/deb", `${filename}.deb`);
  appimage ??= join(
    root,
    "target/release/bundle/appimage",
    `${filename}.AppImage`,
  );
  const packagedVersion = execFileSync("dpkg-deb", ["-f", deb, "Version"], {
    encoding: "utf8",
  }).trim();
  const architecture = execFileSync("dpkg-deb", ["-f", deb, "Architecture"], {
    encoding: "utf8",
  }).trim();
  if (
    ![version, version.replace("-", "~")].includes(packagedVersion) ||
    architecture !== "amd64"
  ) {
    throw new Error(
      "Expected a matching version of the Linux amd64 desktop packages",
    );
  }
  if (
    nsis &&
    (basename(nsis) !== `OmniCode_${version}_x64-setup.exe` ||
      (await readFile(nsis)).toString("ascii", 0, 2) !== "MZ")
  ) {
    throw new Error(
      "Expected a matching version of the Windows x64 NSIS installer",
    );
  }
  return publishDesktopUpdate({
    version,
    deb,
    appimage,
    nsis,
    output: resolve(output),
    baseUrl: new URL("./", config.plugins.updater.endpoints[0]).href,
    sign: async (file) => {
      execFileSync(
        join(root, "node_modules/.bin/tauri"),
        ["signer", "sign", "--private-key-path", key, file],
        {
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            TAURI_SIGNING_PRIVATE_KEY_PASSWORD:
              process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
          },
        },
      );
      return readFile(`${file}.sig`, "utf8");
    },
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      deb: { type: "string" },
      appimage: { type: "string" },
      nsis: { type: "string" },
      output: { type: "string", default: "build/desktop-update-site" },
      key: { type: "string" },
      version: { type: "string" },
    },
  });
  await prepareDesktopUpdate(values);
  console.log(`Desktop updater site prepared at ${resolve(values.output)}`);
}
