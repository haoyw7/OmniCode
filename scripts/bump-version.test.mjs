import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("version bumps keep npm, all workspace crates, Tauri and Android in sync", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const fixture = mkdtempSync(join(tmpdir(), "monocode-version-"));
  try {
    for (const file of [
      "scripts/bump-version.mjs", "package.json", "package-lock.json",
      "Cargo.toml", "Cargo.lock", "src-tauri/tauri.conf.json",
      "mobile/android/app/build.gradle",
    ]) {
      mkdirSync(dirname(join(fixture, file)), { recursive: true });
      copyFileSync(join(root, file), join(fixture, file));
    }
    execFileSync(process.execPath, [join(fixture, "scripts/bump-version.mjs"), "9.8.7"]);
    const read = (file) => readFileSync(join(fixture, file), "utf8");
    const json = (file) => JSON.parse(read(file));
    assert.equal(json("package.json").version, "9.8.7");
    assert.equal(json("package-lock.json").version, "9.8.7");
    assert.equal(json("package-lock.json").packages[""].version, "9.8.7");
    assert.equal(json("src-tauri/tauri.conf.json").version, "9.8.7");
    assert.match(read("Cargo.toml"), /^version = "9\.8\.7"$/m);
    for (const name of ["monocode", "monocode-host-supervisor", "monocode-process-tree"])
      assert.ok(read("Cargo.lock").includes(`name = "${name}"\nversion = "9.8.7"`), name);
    assert.match(read("mobile/android/app/build.gradle"), /versionName "9\.8\.7"/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
