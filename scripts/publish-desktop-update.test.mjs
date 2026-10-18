import assert from "node:assert/strict";
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { publishDesktopUpdate } from "./publish-desktop-update.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "monocode-desktop-update-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const deb = join(directory, "MonoCode_0.7.0_amd64.deb");
  const appimage = join(directory, "MonoCode_0.7.0_amd64.AppImage");
  await writeFile(deb, "deb package");
  await writeFile(appimage, "appimage package");
  return {
    version: "0.7.0",
    deb,
    appimage,
    output: join(directory, "site"),
    baseUrl: "http://192.168.0.206/",
    sign: async (file) => `signed:${await readFile(file, "utf8")}`,
  };
}

test("publishes signed installer-specific targets and a development fallback", async (t) => {
  const options = await fixture(t);
  const manifest = await publishDesktopUpdate(options);
  assert.equal(manifest.version, "0.7.0");
  for (const [installer, content] of [
    ["deb", "deb package"],
    ["appimage", "appimage package"],
  ]) {
    const platform = manifest.platforms[`linux-x86_64-${installer}`];
    assert.equal(platform.signature, `signed:${content}`);
    const url = new URL(platform.url);
    assert.equal(url.origin, "http://192.168.0.206");
    assert.equal(
      await readFile(join(options.output, url.pathname), "utf8"),
      content,
    );
  }
  assert.deepEqual(
    manifest.platforms["linux-x86_64"],
    manifest.platforms["linux-x86_64-appimage"],
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(options.output, "latest.json"))),
    manifest,
  );
});

test("date labels and download names preserve the native update version and signed bytes", async (t) => {
  const options = await fixture(t);
  const version = `0.7.1-lan.${Date.parse("2026-10-07T15:40:00Z")}`;
  const deb = join(options.output, "..", `MonoCode_${version}_amd64.deb`);
  const appimage = join(
    options.output,
    "..",
    `MonoCode_${version}_amd64.AppImage`,
  );
  const nsis = join(options.output, "..", `MonoCode_${version}_x64-setup.exe`);
  await copyFile(options.deb, deb);
  await copyFile(options.appimage, appimage);
  await writeFile(nsis, "MZ windows installer");
  const manifest = await publishDesktopUpdate({
    ...options,
    version,
    deb,
    appimage,
    nsis,
  });
  assert.equal(manifest.version, version);
  assert.equal(manifest.displayVersion, "10-07-0840");
  assert.equal(manifest.notes, "OmniCode 10-07-0840");
  for (const [target, suffix, content] of [
    ["linux-x86_64-deb", "amd64.deb", "deb package"],
    ["linux-x86_64-appimage", "amd64.AppImage", "appimage package"],
    ["windows-x86_64-nsis", "x64-setup.exe", "MZ windows installer"],
  ]) {
    const entry = manifest.platforms[target];
    assert.ok(entry.url.endsWith(`/MonoCode_10-07-0840_${suffix}`));
    assert.equal(entry.signature, `signed:${content}`);
    assert.equal(
      await readFile(join(options.output, new URL(entry.url).pathname), "utf8"),
      content,
    );
  }
});

test("keeps previously published downloads intact when rebuilding the same version", async (t) => {
  const options = await fixture(t);
  const first = await publishDesktopUpdate(options);
  await writeFile(options.deb, "new deb package");
  const second = await publishDesktopUpdate(options);
  const oldUrl = new URL(first.platforms["linux-x86_64-deb"].url);
  assert.notEqual(second.platforms["linux-x86_64-deb"].url, oldUrl.href);
  assert.equal(
    await readFile(join(options.output, oldUrl.pathname), "utf8"),
    "deb package",
  );
});

test(
  "publishes owner-only artifacts with web-server-readable permissions",
  { skip: process.platform === "win32" },
  async (t) => {
    const options = await fixture(t);
    const nsis = join(options.output, "..", "MonoCode_0.7.0_x64-setup.exe");
    await writeFile(nsis, "MZ windows installer");
    for (const file of [options.deb, options.appimage, nsis]) {
      await chmod(file, 0o700);
    }
    const manifest = await publishDesktopUpdate({ ...options, nsis });
    for (const [target, mode] of [
      ["linux-x86_64-deb", 0o644],
      ["linux-x86_64-appimage", 0o755],
      ["windows-x86_64-nsis", 0o644],
    ]) {
      const file = join(
        options.output,
        new URL(manifest.platforms[target].url).pathname,
      );
      assert.equal((await stat(file)).mode & 0o777, mode);
    }
    assert.equal((await stat(nsis)).mode & 0o777, 0o700);
  },
);

test("Windows and Linux share one version and the feed stays intact if Windows signing fails", async (t) => {
  const options = await fixture(t);
  const nsis = join(options.output, "..", "MonoCode_0.7.0_x64-setup.exe");
  await writeFile(nsis, "MZ windows installer");
  const manifest = await publishDesktopUpdate({ ...options, nsis });
  assert.deepEqual(
    manifest.platforms["windows-x86_64"],
    manifest.platforms["windows-x86_64-nsis"],
  );
  assert.equal(Object.keys(manifest.platforms).length, 5);
  assert.equal(
    manifest.platforms["windows-x86_64"].signature,
    "signed:MZ windows installer",
  );
  assert.equal(
    await readFile(
      join(
        options.output,
        new URL(manifest.platforms["windows-x86_64"].url).pathname,
      ),
      "utf8",
    ),
    "MZ windows installer",
  );
  const before = await readFile(join(options.output, "latest.json"), "utf8");
  await assert.rejects(
    publishDesktopUpdate({
      ...options,
      nsis,
      sign: async (file) => {
        if (file.endsWith(".exe")) throw new Error("Windows signing failed");
        return options.sign(file);
      },
    }),
    /Windows signing failed/,
  );
  assert.equal(
    await readFile(join(options.output, "latest.json"), "utf8"),
    before,
  );
});

test("keeps the current feed when a later package cannot be signed", async (t) => {
  const options = await fixture(t);
  await publishDesktopUpdate(options);
  const before = await readFile(join(options.output, "latest.json"), "utf8");
  await assert.rejects(
    publishDesktopUpdate({
      ...options,
      sign: async (file) => {
        if (file.endsWith(".AppImage")) throw new Error("signing failed");
        return "deb signature";
      },
    }),
    /signing failed/,
  );
  assert.equal(
    await readFile(join(options.output, "latest.json"), "utf8"),
    before,
  );
});

test("rejects unsigned packages without replacing the current feed", async (t) => {
  const options = await fixture(t);
  await publishDesktopUpdate(options);
  const before = await readFile(join(options.output, "latest.json"), "utf8");
  await assert.rejects(
    publishDesktopUpdate({ ...options, sign: async () => " " }),
    /Missing updater signature/,
  );
  assert.equal(
    await readFile(join(options.output, "latest.json"), "utf8"),
    before,
  );
});
