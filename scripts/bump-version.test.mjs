import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

for (const newline of ["\n", "\r\n"]) {
  test(`version synchronization covers all platforms and preserves dependencies (${JSON.stringify(newline)})`, () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const fixture = mkdtempSync(join(tmpdir(), "omnicode-version-"));
    try {
      for (const file of [
        "scripts/bump-version.mjs",
        "package.json",
        "package-lock.json",
        "Cargo.toml",
        "Cargo.lock",
        "src-tauri/tauri.conf.json",
        "mobile/android/app/build.gradle",
        "host/im/package.json",
        "host/im/package-lock.json",
        "mobile/ios/App/App.xcodeproj/project.pbxproj",
      ]) {
        mkdirSync(dirname(join(fixture, file)), { recursive: true });
        writeFileSync(
          join(fixture, file),
          readFileSync(join(root, file), "utf8").replace(/\r?\n/g, newline),
        );
      }
      const beforeCargo = readFileSync(join(fixture, "Cargo.lock"), "utf8");
      execFileSync(process.execPath, [
        join(fixture, "scripts/bump-version.mjs"),
        "9.8.7",
      ]);
      const read = (file) => readFileSync(join(fixture, file), "utf8");
      const json = (file) => JSON.parse(read(file));
      assert.equal(json("package.json").version, "9.8.7");
      assert.equal(json("package-lock.json").version, "9.8.7");
      assert.equal(json("package-lock.json").packages[""].version, "9.8.7");
      assert.equal(json("src-tauri/tauri.conf.json").version, "9.8.7");
      for (const directory of ["", "host/im"]) {
        const manifestPath = join(directory, "package.json");
        const lockPath = join(directory, "package-lock.json");
        const manifest = json(manifestPath);
        const lock = json(lockPath);
        assert.equal(manifest.version, "9.8.7");
        assert.equal(lock.version, "9.8.7");
        assert.equal(lock.packages[""].version, "9.8.7");
        const originalManifest = JSON.parse(
          readFileSync(join(root, manifestPath), "utf8"),
        );
        const originalLock = JSON.parse(
          readFileSync(join(root, lockPath), "utf8"),
        );
        manifest.version = originalManifest.version;
        lock.version = originalLock.version;
        lock.packages[""].version = originalLock.packages[""].version;
        assert.deepEqual(manifest, originalManifest);
        assert.deepEqual(lock, originalLock);
      }
      assert.match(read("Cargo.toml"), /^version = "9\.8\.7"$/m);
      for (const name of [
        "omnicode",
        "omnicode-host-supervisor",
        "omnicode-process-tree",
      ])
        assert.ok(
          read("Cargo.lock")
            .replaceAll("\r\n", "\n")
            .includes(`name = "${name}"\nversion = "9.8.7"`),
          name,
        );
      assert.match(
        read("mobile/android/app/build.gradle"),
        /versionName "9\.8\.7"/,
      );
      assert.deepEqual(
        [
          ...read("mobile/ios/App/App.xcodeproj/project.pbxproj").matchAll(
            /MARKETING_VERSION = ([^;]+);/g,
          ),
        ].map((match) => match[1]),
        ["9.8.7", "9.8.7"],
      );
      const withoutOwnVersions = (text) =>
        text.replace(
          /(name = "omnicode(?:-host-supervisor|-process-tree)?"\r?\nversion = ")[^"]+(")/g,
          "$1<version>$2",
        );
      assert.equal(
        withoutOwnVersions(read("Cargo.lock")),
        withoutOwnVersions(beforeCargo),
      );
      // Re-running the same version must succeed, including partially synced trees.
      execFileSync(process.execPath, [
        join(fixture, "scripts/bump-version.mjs"),
        "9.8.7",
      ]);
      writeFileSync(
        join(fixture, "host/im/package.json"),
        read("host/im/package.json").replace(
          '"version": "9.8.7"',
          '"version": "0.0.0"',
        ),
      );
      execFileSync(process.execPath, [
        join(fixture, "scripts/bump-version.mjs"),
        "9.8.7",
      ]);
      assert.equal(json("host/im/package.json").version, "9.8.7");
      // A missing version field must fail before any other file is written.
      writeFileSync(
        join(fixture, "mobile/ios/App/App.xcodeproj/project.pbxproj"),
        "missing version fields",
      );
      assert.throws(() =>
        execFileSync(
          process.execPath,
          [join(fixture, "scripts/bump-version.mjs"), "9.8.8"],
          { stdio: "pipe" },
        ),
      );
      assert.equal(json("package.json").version, "9.8.7");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
}
