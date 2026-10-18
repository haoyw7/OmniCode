#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("usage: npm run set-version -- 0.1.1");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Validate every target before writing, and allow repeated synchronization.
const pending = new Map();
function replaceVersion(path, pattern, replacement, expected = 1) {
  const text = pending.get(path) ?? readFileSync(path, "utf8");
  const matches = [
    ...text.matchAll(
      new RegExp(
        pattern.source,
        pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
      ),
    ),
  ];
  if (matches.length !== expected) {
    console.error(
      `expected ${expected} version fields in ${path}, found ${matches.length}`,
    );
    process.exit(1);
  }
  pending.set(path, text.replace(pattern, replacement));
}

for (const directory of ["", "host/im"]) {
  replaceVersion(
    join(root, directory, "package.json"),
    /("version": ")[^"]+(")/,
    `$1${version}$2`,
  );
  // Only update the lockfile root, never dependency package versions.
  replaceVersion(
    join(root, directory, "package-lock.json"),
    /^(\{\r?\n\s*"name": "[^"]+",\r?\n\s*"version": ")[^"]+(")/,
    `$1${version}$2`,
  );
  replaceVersion(
    join(root, directory, "package-lock.json"),
    /("packages": \{\r?\n\s*"": \{\r?\n\s*"name": "[^"]+",\r?\n\s*"version": ")[^"]+(")/,
    `$1${version}$2`,
  );
}
replaceVersion(
  join(root, "Cargo.toml"),
  /(\[workspace\.package\]\r?\nversion = ")[^"]+(")/,
  `$1${version}$2`,
);
replaceVersion(
  join(root, "src-tauri/tauri.conf.json"),
  /("version": ")[^"]+(")/,
  `$1${version}$2`,
);
replaceVersion(
  join(root, "Cargo.lock"),
  /(name = "omnicode(?:-host-supervisor|-process-tree)?"\r?\nversion = ")[^"]+(")/g,
  `$1${version}$2`,
  3,
);

replaceVersion(
  join(root, "mobile/android/app/build.gradle"),
  /(versionName ")[^"]+(")/,
  `$1${version}$2`,
);

replaceVersion(
  join(root, "mobile/ios/App/App.xcodeproj/project.pbxproj"),
  /(MARKETING_VERSION = )[^;]+(;)/g,
  `$1${version}$2`,
  2,
);

for (const [path, next] of pending) {
  if (readFileSync(path, "utf8") !== next) writeFileSync(path, next);
}

console.log(`version ${version}`);
