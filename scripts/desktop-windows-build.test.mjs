import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import {
  buildWindowsDesktop,
  createWindowsSnapshot,
  powershellCommand,
} from "./desktop-windows-build.mjs";
import {
  ensureWindowsDependencies,
  runWindowsBuild,
  syncWindowsSources,
} from "./desktop-windows-runner.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const version = "0.7.1-lan.123";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "monocode-windows-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const write = async (path, value) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), value);
  };
  await write(".gitignore", "build/\nnode_modules/\n.env\n");
  await write("src/main.ts", "original");
  await write("src/deleted.ts", "deleted");
  await write("Cargo.toml", "source");
  execFileSync("git", ["add", "."], { cwd: root });
  return { root, write };
}

test("Windows snapshots contain current uncommitted inputs, exclude credentials/outputs and respect deletions", async (t) => {
  const { root, write } = await fixture(t);
  await write("src/main.ts", "edited");
  await write("host/new.ts", "untracked input");
  await write("crates/process-tree/Cargo.toml", "workspace crate");
  await write("CHANGELOG.md", "bundled release notes");
  await write(".env", "secret");
  await write("build/output", "generated");
  await write("mobile/android/source", "mobile");
  await write("host/bots/eval/datasets/tracked.jsonl", "evaluation data");
  execFileSync("git", ["add", "host/bots/eval"], { cwd: root });
  await write("host/bots/eval/public/untracked.json", "evaluation data");
  await write("host/bots/eval/run.ts", "evaluation runner");
  await write("eval/legacy.json", "legacy evaluation data");
  // The desktop tsc project also checks src/mobile/updates.ts.
  await write("mobile/update-config.json", "{}");
  await write("mobile/update-config.release.json", "{}");
  await rm(join(root, "src/deleted.ts"));
  const archive = join(root, "build/source.tar.gz");
  assert.equal(
    await createWindowsSnapshot(root, archive),
    hash(await readFile(archive)),
  );
  const list = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
    .trim()
    .split("\n");
  assert.deepEqual(list, [
    "CHANGELOG.md",
    "Cargo.toml",
    "crates/process-tree/Cargo.toml",
    "host/new.ts",
    "mobile/update-config.json",
    "mobile/update-config.release.json",
    "src/main.ts",
  ]);
  assert.equal(
    execFileSync("tar", ["-xOzf", archive, "src/main.ts"], {
      encoding: "utf8",
    }),
    "edited",
  );
  await symlink(join(root, ".env"), join(root, "src/symlink"));
  await assert.rejects(
    createWindowsSnapshot(root, archive),
    /requires regular files/,
  );
});

test("remote PowerShell commands transport literal paths without shell expansion", () => {
  const script = "Write-Output 'C:\\User Files\\O''Neil & $test'";
  const command = powershellCommand(script);
  assert.match(
    command,
    /^powershell.exe -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/,
  );
  assert.ok(
    Buffer.from(command.split(" ").at(-1), "base64")
      .toString("utf16le")
      .endsWith(script),
  );
});

for (const channel of ["lan", "release"]) {
  const version = channel === "release" ? "0.7.0" : "0.7.1-lan.123";
  test(`remote ${channel} builds use an isolated cache and release the lock on failure`, async (t) => {
    const { root, write } = await fixture(t);
    const runId = randomUUID();
    const state = "build/windows-lan";
    const inbox = join(root, state, "inbox", runId);
    await write(`${state}/inbox/${runId}/source.tar.gz`, "source archive");
    await write(`${state}/workspace/.monocode-windows-builder`, "1");
    await write(`${state}/workspace/src/stale.ts`, "stale");
    await write(`${state}/workspace/target/cache`, "rust cache");
    await write(`${state}/workspace/build/runtime-cache`, "runtime cache");
    const options = {
      repository: root,
      runId,
      version,
      channel,
      archiveHash: hash("source archive"),
    };
    const commands = [];
    const npm = join(root, "build/npm/bin/npm-cli.js");
    await write("build/npm/package.json", '{"version":"test"}');
    const run = (command, args, settings) => {
      commands.push([command, args]);
      if (command === "tar.exe") {
        const source = args.at(-1);
        mkdirSync(source, { recursive: true });
        mkdirSync(join(source, "src-tauri"), { recursive: true });
        writeFileSync(
          join(source, "src-tauri/tauri.release.conf.json"),
          JSON.stringify({
            plugins: {
              updater: {
                endpoints: [
                  "https://github.com/yyy0107/ohmymonocode/releases/latest/download/latest.json",
                ],
              },
            },
          }),
        );
        writeFileSync(join(source, "src-tauri/tauri.lan.conf.json"), JSON.stringify({
          plugins: { updater: { endpoints: ["http://192.168.0.206/latest.json"] } },
        }));
        writeFileSync(join(source, "package.json"), "{}");
        writeFileSync(join(source, "package-lock.json"), "{}");
      }
      if (args.includes("ci")) {
        for (const path of ["node_modules", "host/im/node_modules"]) {
          mkdirSync(join(settings.cwd, path), { recursive: true });
          writeFileSync(join(settings.cwd, path, ".package-lock.json"), "{}");
        }
      }
      if (args.includes("build:windows")) {
        const config = JSON.parse(
          readFileSync(join(settings.cwd, "build/tauri.lan.conf.json"), "utf8"),
        );
        assert.equal(config.version, version);
        assert.equal(
          config.plugins?.updater.endpoints[0],
          channel === "release"
            ? "https://github.com/yyy0107/ohmymonocode/releases/latest/download/latest.json"
            : "http://192.168.0.206/latest.json",
        );
        assert.equal(settings.cwd, join(root, state, "workspace"));
        assert.equal(
          settings.env.CARGO_TARGET_DIR,
          join(settings.cwd, "target"),
        );
        const output = join(
          settings.cwd,
          "target/release/bundle/nsis",
          `MonoCode_${version}_x64-setup.exe`,
        );
        mkdirSync(dirname(output), { recursive: true });
        writeFileSync(output, "MZ built exe");
      }
    };
    const result = await runWindowsBuild(options, { run, npm });
    assert.equal(result.sha256, hash("MZ built exe"));
    assert.equal(
      await readFile(join(inbox, result.filename), "utf8"),
      "MZ built exe",
    );
    assert.equal(
      existsSync(join(root, state, "workspace/src/stale.ts")),
      false,
    );
    assert.equal(
      await readFile(join(root, state, "workspace/target/cache"), "utf8"),
      "rust cache",
    );
    assert.equal(await readFile(join(root, "src/main.ts"), "utf8"), "original");
    assert.equal(existsSync(join(root, state, "build.lock")), false);
    assert.equal(commands.filter(([, args]) => args.includes("ci")).length, 1);
    assert.equal(
      commands.filter(([, args]) => args.includes("build:windows")).length,
      1,
    );
    await assert.rejects(
      runWindowsBuild(options, {
        npm,
        run: () => {
          throw new Error("tool failed");
        },
      }),
      /tool failed/,
    );
    assert.equal(existsSync(join(root, state, "build.lock")), false);
  });
}

test("source synchronization preserves unchanged mtimes and nested dependency caches, but applies edits and deletions", async (t) => {
  const { root, write } = await fixture(t);
  const source = join(root, "build/snapshot");
  const workspace = join(root, "build/workspace");
  await write("build/snapshot/src/keep.rs", "same");
  await write("build/snapshot/src/change.rs", "new");
  await write("build/snapshot/host/im/package.json", "{}");
  await write("build/workspace/src/keep.rs", "same");
  await write("build/workspace/src/change.rs", "old");
  await write("build/workspace/src/deleted.rs", "deleted");
  await write("build/workspace/host/im/node_modules/dependency", "cached");
  await write("build/workspace/target/cache", "rust cache");
  const keep = join(workspace, "src/keep.rs");
  await utimes(keep, 1_000, 1_000);
  const original = (await stat(keep)).mtimeMs;
  await syncWindowsSources(source, workspace);
  assert.equal((await stat(keep)).mtimeMs, original);
  assert.equal(await readFile(join(workspace, "src/change.rs"), "utf8"), "new");
  assert.equal(existsSync(join(workspace, "src/deleted.rs")), false);
  assert.equal(
    await readFile(join(workspace, "host/im/node_modules/dependency"), "utf8"),
    "cached",
  );
  assert.equal(
    await readFile(join(workspace, "target/cache"), "utf8"),
    "rust cache",
  );
  // File/directory replacements and symlinks must not escape the owned workspace.
  await rm(join(workspace, "src"), { recursive: true });
  await symlink(join(root, "src"), join(workspace, "src"));
  await syncWindowsSources(source, workspace);
  assert.equal((await stat(keep)).isFile(), true);
  assert.equal(await readFile(join(root, "src/main.ts"), "utf8"), "original");
});

test("dependency reuse invalidates on lockfiles, npm changes, missing installs and failed reinstalls", async (t) => {
  const { root, write } = await fixture(t);
  const npm = join(root, "build/npm/bin/npm-cli.js");
  await write("build/npm/package.json", '{"version":"1"}');
  await write("package.json", "{}");
  await write("package-lock.json", "{}");
  await write("host/im/package.json", "{}");
  await write("host/im/package-lock.json", "{}");
  let installs = 0;
  const run = (_command, args) => {
    assert.ok(args.includes("ci"));
    installs++;
    for (const path of ["node_modules", "host/im/node_modules"]) {
      mkdirSync(join(root, path), { recursive: true });
      writeFileSync(join(root, path, ".package-lock.json"), "{}");
    }
  };
  const ensure = () => ensureWindowsDependencies(root, npm, { cwd: root }, run);
  await ensure();
  await ensure();
  assert.equal(installs, 1);
  for (const path of [
    "package-lock.json",
    "host/im/package-lock.json",
    "build/npm/package.json",
  ]) {
    await write(path, '{"changed":true}');
    await ensure();
  }
  assert.equal(installs, 4);
  await rm(join(root, "host/im/node_modules"), { recursive: true });
  await ensure();
  assert.equal(installs, 5);
  await write("package.json", '{"changed":true}');
  await assert.rejects(
    ensureWindowsDependencies(root, npm, {}, () => {
      throw new Error("install failed");
    }),
    /install failed/,
  );
  assert.equal(
    existsSync(join(root, "build/windows-dependencies.json")),
    false,
  );
  await ensure();
  assert.equal(installs, 6);
});

test("remote build refuses overlaps, altered archives and unowned directories", async (t) => {
  const { root, write } = await fixture(t);
  const runId = randomUUID();
  const state = "build/windows-lan";
  await write(`${state}/inbox/${runId}/source.tar.gz`, "source archive");
  const options = {
    repository: root,
    runId,
    version,
    archiveHash: hash("source archive"),
  };
  await mkdir(join(root, state, "build.lock"));
  const run = () => assert.fail("must not run a command");
  await assert.rejects(runWindowsBuild(options, { run }), /already running/);
  assert.equal(existsSync(join(root, state, "build.lock")), true);
  await rm(join(root, state, "build.lock"), { recursive: true });
  await assert.rejects(
    runWindowsBuild({ ...options, archiveHash: "wrong" }, { run }),
    /checksum mismatch/,
  );
  await write(`${state}/workspace/precious.txt`, "existing user file");
  await assert.rejects(runWindowsBuild(options, { run }), /ENOENT/);
  assert.equal(
    await readFile(join(root, state, "workspace/precious.txt"), "utf8"),
    "existing user file",
  );
});

for (const failure of [null, "version", "checksum", "ssh"]) {
  test(`controller validates transfer and receipt (${failure || "success"}) before returning an installer`, async (t) => {
    const { root } = await fixture(t);
    let request;
    let unchangedChecks = 0;
    const commands = [];
    const run = async (command, args) => {
      await new Promise((resolve) => setImmediate(resolve));
      commands.push(command);
      if (failure === "ssh") throw new Error("SSH unreachable");
      if (command === "ssh") {
        const script = Buffer.from(
          args.at(-1).split(" ").at(-1),
          "base64",
        ).toString("utf16le");
        const data = script.match(/\.mjs' '([A-Za-z0-9+/=]+)'/);
        if (data) request = JSON.parse(Buffer.from(data[1], "base64"));
      } else if (command === "scp" && basename(args.at(-1)) === "result.json") {
        writeFileSync(
          args.at(-1),
          JSON.stringify({
            version: failure === "version" ? "wrong" : request.version,
            archiveHash: request.archiveHash,
            checked: false,
            filename: `MonoCode_${version}_x64-setup.exe`,
            sha256: hash("MZ installer"),
            size: "MZ installer".length,
          }),
        );
      } else if (command === "scp" && args.at(-1).endsWith(".exe")) {
        writeFileSync(
          args.at(-1),
          failure === "checksum" ? "bad bytes" : "MZ installer",
        );
      }
    };
    const call = buildWindowsDesktop(root, version, {
      run,
      assertUnchanged: async () => {
        unchangedChecks++;
      },
    });
    if (failure) {
      await assert.rejects(
        call,
        failure === "ssh"
          ? /SSH unreachable/
          : failure === "version"
            ? /receipt/
            : /checksum mismatch/,
      );
    } else {
      const { nsis } = await call;
      assert.equal(await readFile(nsis, "utf8"), "MZ installer");
      assert.equal(unchangedChecks, 2);
      assert.equal(commands.at(-1), "ssh");
    }
  });
}
