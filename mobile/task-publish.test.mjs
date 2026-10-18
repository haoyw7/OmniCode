import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  copyFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { publishCompletedTask, sourceFingerprint } from "./task-publish.mjs";
import { handleTurn } from "./turn-publish.mjs";

const initialSource =
  'import "../features/sessions/ui/Shared"; import "../shared/style.css";';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "monocode-task-publish-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  async function write(path, data) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), data);
  }
  await write(
    ".gitignore",
    "build/\ndist-mobile/\nnode_modules/\npublic-generated/\nmobile/android/app/src/main/assets/public/\n",
  );
  await write("src/mobile/main.tsx", initialSource);
  execFileSync("git", ["add", "."], { cwd: root });
  const directory = join(root, "build/updates");
  let builds = 0;
  async function build() {
    builds++;
    const output = "mobile/android/app/build/outputs/apk/debug";
    await write(`${output}/app-debug.apk`, `apk-${builds}`);
    await write(
      `${output}/output-metadata.json`,
      JSON.stringify({
        applicationId: "com.monocode.mobile",
        elements: [
          {
            versionCode: builds,
            versionName: "0.7.0",
            outputFile: "app-debug.apk",
          },
        ],
      }),
    );
  }
  const options = { root, directory, build, ensureServer: async () => {} };
  return { root, write, options, build, builds: () => builds };
}

test("fingerprints additions, edits and deletions in mobile/shared inputs, ignoring generated outputs", async (t) => {
  const { root, write } = await fixture(t);
  const original = await sourceFingerprint(root);
  await write("src/features/sessions/ui/Shared.tsx", "shared");
  const added = await sourceFingerprint(root);
  assert.notEqual(added, original);
  await write("src/features/sessions/ui/Shared.tsx", "edited");
  assert.notEqual(await sourceFingerprint(root), added);
  await rm(join(root, "src/features/sessions/ui/Shared.tsx"));
  assert.equal(await sourceFingerprint(root), original);
  await rm(join(root, "src/mobile/main.tsx"));
  assert.notEqual(await sourceFingerprint(root), original);
  await write("src/mobile/main.tsx", initialSource);
  for (const path of [
    "src/mobile/main.test.ts",
    "mobile/README.md",
    "mobile/ios/App/App/AppDelegate.swift",
    "src/integrations/workflow/dynamic-workflow/compiler/libs.generated.ts",
    "mobile/android/app/capacitor.build.gradle",
    "mobile/android/capacitor.settings.gradle",
    "mobile/android/app/build/generated.txt",
    "mobile/android/app/src/main/assets/public/index.html",
    "dist-mobile/index.html",
    "src/features/desktop/OnlyDesktop.tsx",
    "host/bots/eval/datasets/cases.jsonl",
    "eval/legacy.json",
  ])
    await write(path, "generated or unrelated");
  assert.equal(await sourceFingerprint(root), original);
  await write("scripts/production-inputs.mjs", "bundler input policy");
  assert.notEqual(await sourceFingerprint(root), original);
  await rm(join(root, "scripts/production-inputs.mjs"));
  await write("CHANGELOG.md", "bundled release notes");
  const notes = await sourceFingerprint(root);
  assert.notEqual(notes, original);
  await write("CHANGELOG.md", "updated bilingual release notes");
  assert.notEqual(await sourceFingerprint(root), notes);
  await rm(join(root, "CHANGELOG.md"));
  assert.equal(await sourceFingerprint(root), original);
  await write("mobile/android/app/src/main/java/MainActivity.java", "native");
  assert.notEqual(await sourceFingerprint(root), original);
});

test("turn hooks publish only changed mobile inputs, once, and skip interrupted turns", async (t) => {
  const { root, write } = await fixture(t);
  let publications = 0;
  const options = {
    root,
    publish: async (_root, fingerprint) => {
      assert.equal(fingerprint, await sourceFingerprint(root));
      publications++;
      return "Published";
    },
  };
  const event = { session_id: "test-session", turn_id: "turn-1" };
  const call = (hook_event_name, extra = {}) =>
    handleTurn({ ...event, hook_event_name, ...extra }, options);
  assert.deepEqual(await call("Stop"), {});
  await call("UserPromptSubmit");
  await write("src/features/desktop/OnlyDesktop.tsx", "desktop edit");
  assert.deepEqual(await call("Stop"), {});
  assert.equal(publications, 0);
  await call("UserPromptSubmit", { turn_id: "turn-2" });
  await write(
    "src/features/sessions/ui/Shared.tsx",
    "shared mobile dependency",
  );
  assert.deepEqual(await call("Stop", { turn_id: "turn-2" }), {
    systemMessage: "Published",
  });
  assert.deepEqual(await call("Stop", { turn_id: "turn-2" }), {});
  assert.equal(publications, 1);
  await call("UserPromptSubmit", { turn_id: "turn-3" });
  await write("src/mobile/main.tsx", "unfinished");
  await call("Interrupt", { turn_id: "turn-3" });
  assert.deepEqual(await call("Stop", { turn_id: "turn-3" }), {});
  assert.equal(publications, 1);
});

test("turns in plan mode and failed publications never retry automatically", async (t) => {
  const { root, write } = await fixture(t);
  let attempts = 0;
  const options = {
    root,
    publish: async () => {
      attempts++;
      throw new Error("build failed");
    },
  };
  const event = { session_id: "test-session", turn_id: "turn-1" };
  const call = (hook_event_name, extra = {}) =>
    handleTurn({ ...event, hook_event_name, ...extra }, options);
  await call("UserPromptSubmit", { permission_mode: "plan" });
  await write("src/mobile/main.tsx", "change");
  await call("Stop");
  assert.equal(attempts, 0);
  // A repeated Stop after a different hook continued a turn has no baseline.
  await call("Stop", { stop_hook_active: true });
  assert.equal(attempts, 0);
  await call("UserPromptSubmit");
  await write("src/mobile/main.tsx", "last change");
  await assert.rejects(call("Stop"), /build failed/);
  assert.deepEqual(await call("Stop"), {});
  assert.equal(attempts, 1);
});

test("rejects source drift between the turn ending and acquiring the publication lock", async (t) => {
  const { root, options, write, builds } = await fixture(t);
  const expectedFingerprint = await sourceFingerprint(root);
  await write("src/mobile/main.tsx", "another turn already started");
  await assert.rejects(
    publishCompletedTask({ ...options, expectedFingerprint }),
    /Sources changed after the turn ended/,
  );
  assert.equal(builds(), 0);
});

test("publishes once per source state and rebuilds after shared source changes", async (t) => {
  const { options, write, builds } = await fixture(t);
  const first = await publishCompletedTask(options);
  assert.equal(first.skipped, false);
  assert.equal(first.manifest.versionCode, 1);
  assert.equal((await publishCompletedTask(options)).skipped, true);
  assert.equal(builds(), 1);
  await write("src/shared/style.css", "body { color: red; }");
  const next = await publishCompletedTask(options);
  assert.equal(next.skipped, false);
  assert.equal(next.manifest.versionCode, 2);
  assert.equal(
    await readFile(join(options.directory, next.manifest.downloadPath), "utf8"),
    "apk-2",
  );
});

test("a failed build preserves the release and can be retried after fixing it", async (t) => {
  const { options, write } = await fixture(t);
  await publishCompletedTask(options);
  const latestFile = join(options.directory, "latest.json");
  const before = await readFile(latestFile, "utf8");
  await write("src/mobile/main.tsx", "new source");
  await assert.rejects(
    publishCompletedTask({
      ...options,
      build: async () => {
        throw new Error("compiler failed");
      },
    }),
    /compiler failed/,
  );
  assert.equal(await readFile(latestFile, "utf8"), before);
  assert.equal((await publishCompletedTask(options)).manifest.versionCode, 2);
});

test("source changes while building prevent the generated APK from being published", async (t) => {
  const { options, write, build } = await fixture(t);
  await publishCompletedTask(options);
  const latestFile = join(options.directory, "latest.json");
  const before = await readFile(latestFile, "utf8");
  await write("src/mobile/main.tsx", "start of task");
  await assert.rejects(
    publishCompletedTask({
      ...options,
      build: async () => {
        await build();
        await write("src/mobile/main.tsx", "another edit during build");
      },
    }),
    /Sources changed during the build/,
  );
  assert.equal(await readFile(latestFile, "utf8"), before);
  await assert.rejects(
    readFile(join(options.directory, "apk/monocode-2.apk")),
    { code: "ENOENT" },
  );
  assert.equal((await publishCompletedTask(options)).manifest.versionCode, 3);
});

test(
  "the Linux hook rejects an overlapping invocation before starting a build",
  { skip: process.platform !== "linux" },
  async (t) => {
    const { root, write } = await fixture(t);
    await mkdir(join(root, "build/mobile-publish"), { recursive: true });
    await write(
      "mobile/task-publish.mjs",
      'throw new Error("must not start");',
    );
    const hook = join(root, "mobile/task-publish.sh");
    await copyFile(
      fileURLToPath(new URL("./task-publish.sh", import.meta.url)),
      hook,
    );
    const holder = spawn(
      "flock",
      [
        join(root, "build/mobile-publish/task.lock"),
        process.execPath,
        "-e",
        'process.stdout.write("locked"); process.stdin.resume();',
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const holderClosed = once(holder, "close");
    t.after(async () => {
      holder.stdin.end();
      await holderClosed;
    });
    await once(holder.stdout, "data");
    assert.throws(
      () => execFileSync("bash", [hook], { stdio: "pipe" }),
      (error) => {
        assert.equal(error.status, 1);
        assert.match(error.stderr.toString(), /publication is already running/);
        assert.doesNotMatch(error.stderr.toString(), /must not start/);
        return true;
      },
    );
  },
);
