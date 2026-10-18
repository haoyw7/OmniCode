import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  buildAllDesktops,
  deployDesktopUpdate,
  nextLanVersion,
  publishCompletedTask,
  sourceFingerprint,
  verifyDeployment,
} from "./desktop-task-publish.mjs";
import { runBuildProcess } from "./desktop-build-process.mjs";
import { publishDesktopUpdate, readDesktopLanConfig } from "./publish-desktop-update.mjs";
import { handleTurn } from "./desktop-turn-publish.mjs";
import { handleTurn as dispatch } from "./turn-publish.mjs";

test("platform builds overlap and source validation waits for both", async () => {
  let finishLinux;
  let finishWindows;
  const started = [];
  const linux = () =>
    new Promise((resolve) => {
      started.push("linux");
      finishLinux = resolve;
    });
  const windows = () =>
    new Promise((resolve) => {
      started.push("windows");
      finishWindows = resolve;
    });
  let validated = false;
  const pending = buildAllDesktops(
    "root",
    "version",
    async () => {
      validated = true;
    },
    { linux, windows },
  );
  assert.deepEqual(started, ["linux", "windows"]);
  finishLinux();
  await Promise.resolve();
  assert.equal(validated, false);
  finishWindows({ nsis: "installer" });
  assert.deepEqual(await pending, { nsis: "installer" });
  assert.equal(validated, true);
});

test("a failed platform keeps the publication pending until the other builder stops", async () => {
  let finishWindows;
  let settled = false;
  const pending = buildAllDesktops(
    "root",
    "version",
    () => assert.fail("must not validate a failed build"),
    {
      linux: async () => {
        throw new Error("Linux failed");
      },
      windows: () =>
        new Promise((resolve) => {
          finishWindows = resolve;
        }),
    },
  );
  const rejected = assert.rejects(pending, /Linux failed/).then(() => {
    settled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  finishWindows();
  await rejected;
});

test("nonblocking build commands wait for exit and report failures", async () => {
  await runBuildProcess(process.execPath, [
    "-e",
    "setTimeout(() => process.exit(0), 10)",
  ]);
  await assert.rejects(
    runBuildProcess(process.execPath, ["-e", "process.exit(7)"]),
    /failed \(7\)/,
  );
  await assert.rejects(
    runBuildProcess("monocode-missing-build-command", []),
    /ENOENT/,
  );
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "monocode-desktop-task-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const write = async (path, content) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  };
  await write(".gitignore", "build/\ntarget/\nnode_modules/\ndist/\n");
  await write("src/main.tsx", "desktop source");
  await write(
    "src-tauri/tauri.conf.json",
    JSON.stringify({
      version: "0.7.0",
      plugins: {
        updater: { endpoints: ["https://github.com/yyy0107/ohmymonocode/releases/latest/download/latest.json"] },
      },
    }),
  );
  await write("src-tauri/tauri.lan.conf.json", JSON.stringify({
    plugins: { updater: { endpoints: ["http://192.168.0.206/latest.json"], dangerousInsecureTransportProtocol: true } },
  }));
  execFileSync("git", ["add", "."], { cwd: root });
  const directory = join(root, "build/www");
  await mkdir(directory, { recursive: true });
  let builds = 0;
  const build = async () => {
    builds++;
    await write("build/package.deb", `deb ${builds}`);
    await write("build/package.AppImage", `appimage ${builds}`);
  };
  const prepare = async ({ version, output }) => {
    const config = await readDesktopLanConfig(root);
    return publishDesktopUpdate({
      version,
      output,
      deb: join(root, "build/package.deb"),
      appimage: join(root, "build/package.AppImage"),
      baseUrl: new URL("./", config.plugins.updater.endpoints[0]).href,
      sign: async (file) => `signature:${await readFile(file, "utf8")}`,
    });
  };
  const options = { root, directory, build, prepare, verify: async () => {} };
  return {
    root,
    directory,
    write,
    options,
    build,
    prepare,
    builds: () => builds,
  };
}

test("desktop fingerprints track UI, native, bundled Host and assets, excluding mobile-only work and outputs", async (t) => {
  const { root, write } = await fixture(t);
  const original = await sourceFingerprint(root);
  for (const path of [
    "CHANGELOG.md",
    "src/shared/Test.tsx",
    "src-tauri/src/example.rs",
    "crates/process-tree/src/lib.rs",
    "host/service.ts",
    "public/icon.svg",
    "scripts/desktop-task-publish.sh",
    "host/workflows/skill/SKILL.md",
    "scripts/production-inputs.mjs",
  ]) {
    await write(path, "new input");
    const added = await sourceFingerprint(root);
    assert.notEqual(added, original, path);
    await write(path, "edited input");
    assert.notEqual(await sourceFingerprint(root), added);
    await rm(join(root, path));
    assert.equal(await sourceFingerprint(root), original);
  }
  await rm(join(root, "src/main.tsx"));
  assert.notEqual(await sourceFingerprint(root), original);
  await write("src/main.tsx", "desktop source");
  for (const path of [
    "src/mobile/App.tsx",
    "mobile/android/MainActivity.java",
    "src/main.test.ts",
    "host/service.test.ts",
    "host/bots/eval/datasets/cases.jsonl",
    "host/bots/eval/run.ts",
    "eval/legacy.json",
    "README.md",
    "host/README.md",
    "src-tauri/gen/schema.json",
    "src/integrations/workflow/dynamic-workflow/compiler/libs.generated.ts",
    "build/output",
    "target/output",
  ]) {
    await write(path, "unrelated");
    assert.equal(await sourceFingerprint(root), original, path);
  }
});

test("LAN versions advance monotonically without overtaking the next stable patch", () => {
  assert.equal(nextLanVersion("0.7.0", "0.7.0", 100), "0.7.1-lan.100");
  assert.equal(nextLanVersion("0.7.0", "0.7.1-lan.100", 50), "0.7.1-lan.101");
  assert.equal(nextLanVersion("0.7.1", "0.7.1", 100), "0.7.2-lan.100");
  assert.throws(
    () => nextLanVersion("0.7.0", "0.7.1"),
    /newer desktop version/,
  );
  assert.throws(
    () => nextLanVersion("0.7.0", "0.8.1-lan.1"),
    /newer desktop version/,
  );
  assert.throws(() => nextLanVersion("0.7.0", "invalid"), /Unrecognized/);
});

test("turns publish changed desktop inputs once, preserving pre-existing changes as the baseline", async (t) => {
  const { root, write } = await fixture(t);
  let publications = 0;
  const options = {
    root,
    publish: async (_root, fingerprint) => {
      assert.equal(fingerprint, await sourceFingerprint(root));
      publications++;
      return "Published desktop";
    },
  };
  const call = (hook_event_name, turn_id = "one", extra = {}) =>
    handleTurn(
      { session_id: "test", turn_id, hook_event_name, ...extra },
      options,
    );
  assert.deepEqual(await call("Stop"), {});
  await write("src/main.tsx", "pre-existing edit");
  await call("UserPromptSubmit");
  await write("src/mobile/App.tsx", "mobile only");
  assert.deepEqual(await call("Stop"), {});
  await call("UserPromptSubmit", "two");
  await write("host/runtime.ts", "host edit");
  assert.deepEqual(await call("Stop", "two"), {
    systemMessage: "Published desktop",
  });
  assert.deepEqual(await call("Stop", "two"), {});
  await call("UserPromptSubmit", "three");
  await write("src/main.tsx", "unfinished");
  await call("Interrupt", "three");
  assert.deepEqual(await call("Stop", "three"), {});
  await call("UserPromptSubmit", "four", { permission_mode: "plan" });
  await write("src/main.tsx", "planning");
  assert.deepEqual(await call("Stop", "four"), {});
  assert.equal(publications, 1);
});

test("failed Stop publications are consumed without continuation or automatic retry", async (t) => {
  const { root, write } = await fixture(t);
  let attempts = 0;
  const options = {
    root,
    publish: async () => {
      attempts++;
      throw new Error("failed build");
    },
  };
  const event = { session_id: "test", turn_id: "one" };
  await handleTurn({ ...event, hook_event_name: "UserPromptSubmit" }, options);
  await write("src/main.tsx", "changed");
  await assert.rejects(
    handleTurn({ ...event, hook_event_name: "Stop" }, options),
    /failed build/,
  );
  assert.deepEqual(
    await handleTurn(
      { ...event, hook_event_name: "Stop", stop_hook_active: true },
      options,
    ),
    {},
  );
  assert.equal(attempts, 1);
});

test("the shared hook awaits mobile before desktop and continues after a target fails", async () => {
  const order = [];
  const result = await dispatch(
    {},
    {
      root: "/unused",
      handlers: [
        {
          handle: async () => {
            order.push("mobile start");
            await new Promise((r) => setTimeout(r, 5));
            order.push("mobile end");
            throw new Error("mobile failed");
          },
        },
        {
          handle: async () => {
            order.push("desktop");
            return { systemMessage: "desktop published" };
          },
        },
      ],
    },
  );
  assert.deepEqual(order, ["mobile start", "mobile end", "desktop"]);
  assert.deepEqual(result, {
    systemMessage: "mobile failed\ndesktop published",
  });
});

test("edits while mobile builds cannot be published by the later desktop handler", async (t) => {
  const { root, options, write, builds } = await fixture(t);
  const event = { session_id: "test", turn_id: "one" };
  await handleTurn({ ...event, hook_event_name: "UserPromptSubmit" }, { root });
  await write("src/main.tsx", "finished turn");
  const result = await dispatch(
    { ...event, hook_event_name: "Stop" },
    {
      root,
      handlers: [
        {
          handle: async () => {
            await write(
              "src/main.tsx",
              "another turn started during mobile build",
            );
            return {};
          },
        },
        {
          fingerprint: sourceFingerprint,
          handle: (event, hookOptions) =>
            handleTurn(event, {
              ...hookOptions,
              publish: async (_root, expectedFingerprint) =>
                publishCompletedTask({ ...options, expectedFingerprint }),
            }),
        },
      ],
    },
  );
  assert.match(result.systemMessage, /Sources changed after the turn ended/);
  assert.equal(builds(), 0);
});

test("publication skips a successful source state and advances version after edits", async (t) => {
  const { options, builds, write } = await fixture(t);
  const first = await publishCompletedTask(options);
  assert.equal(first.skipped, false);
  assert.equal((await publishCompletedTask(options)).skipped, true);
  assert.equal(builds(), 1);
  await write("src/main.tsx", "next build");
  const second = await publishCompletedTask(options);
  assert.notEqual(second.manifest.version, first.manifest.version);
  assert.equal(builds(), 2);
  assert.equal(
    JSON.parse(await readFile(join(options.root, "src-tauri/tauri.conf.json")))
      .version,
    "0.7.0",
  );
});

test("a stale turn fingerprint prevents the build from starting", async (t) => {
  const { root, options, write, builds } = await fixture(t);
  const expectedFingerprint = await sourceFingerprint(root);
  await write("src/main.tsx", "another turn");
  await assert.rejects(
    publishCompletedTask({ ...options, expectedFingerprint }),
    /Sources changed after the turn ended/,
  );
  assert.equal(builds(), 0);
});

for (const phase of ["build", "prepare", "deploy"]) {
  test(`source drift during ${phase} leaves the previous release and success state intact`, async (t) => {
    const { root, directory, options, write, build, prepare } =
      await fixture(t);
    await publishCompletedTask(options);
    const feed = await readFile(join(directory, "latest.json"), "utf8");
    const state = await readFile(
      join(root, "build/desktop-publish/last-success.json"),
      "utf8",
    );
    await write("src/main.tsx", "start build");
    const functions = {
      build: async (...args) => {
        await build(...args);
        await write("src/main.tsx", "build drift");
      },
      prepare: async (args) => {
        const result = await prepare(args);
        await write("src/main.tsx", "signing drift");
        return result;
      },
      deploy: async (args) =>
        deployDesktopUpdate({
          ...args,
          beforeCommit: async () => {
            await write("src/main.tsx", "deployment drift");
            await args.beforeCommit();
          },
        }),
    };
    await assert.rejects(
      publishCompletedTask({ ...options, [phase]: functions[phase] }),
      /Sources changed during/,
    );
    assert.equal(await readFile(join(directory, "latest.json"), "utf8"), feed);
    assert.equal(
      await readFile(
        join(root, "build/desktop-publish/last-success.json"),
        "utf8",
      ),
      state,
    );
  });
}

test("failed builds or signatures preserve the live release and can be retried", async (t) => {
  const { directory, options, write } = await fixture(t);
  await publishCompletedTask(options);
  const before = await readFile(join(directory, "latest.json"), "utf8");
  await write("src/main.tsx", "new source");
  for (const phase of ["build", "prepare"]) {
    await assert.rejects(
      publishCompletedTask({
        ...options,
        [phase]: async () => {
          throw new Error("failed");
        },
      }),
      /failed/,
    );
    assert.equal(
      await readFile(join(directory, "latest.json"), "utf8"),
      before,
    );
  }
  assert.equal((await publishCompletedTask(options)).skipped, false);
});

test("live verification rejects a missing feed or incorrect package length", async (t) => {
  const { root, directory, options, write } = await fixture(t);
  const server = createServer(async (request, response) => {
    try {
      const data = await readFile(join(directory, request.url));
      response.writeHead(200, { "content-length": data.length });
      response.end(request.method === "HEAD" ? undefined : data);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const endpoint = `http://127.0.0.1:${server.address().port}/latest.json`;
  await write(
    "src-tauri/tauri.lan.conf.json",
    JSON.stringify({
      plugins: { updater: { endpoints: [endpoint] } },
    }),
  );
  const { manifest } = await publishCompletedTask({
    ...options,
    verify: verifyDeployment,
  });
  // Only HEAD is checked below; keep the JSON response readable.
  server.removeAllListeners("request");
  server.on("request", async (request, response) => {
    const data = await readFile(join(directory, request.url));
    response.writeHead(200, {
      "content-length": data.length + (request.method === "HEAD" ? 1 : 0),
    });
    response.end(request.method === "HEAD" ? undefined : data);
  });
  await assert.rejects(
    verifyDeployment({ root, directory, manifest }),
    /package verification failed/,
  );
  server.removeAllListeners("request");
  server.on("request", (_request, response) => response.writeHead(404).end());
  await assert.rejects(
    verifyDeployment({ root, directory, manifest }),
    /feed verification failed/,
  );
});

test("the build uses an ignored version override without modifying source versions", async (t) => {
  const { root, write } = await fixture(t);
  await write(
    "bin/npm",
    '#!/usr/bin/env node\nrequire("node:fs").writeFileSync("build/args.json", JSON.stringify(process.argv.slice(2)));\n',
  );
  await chmod(join(root, "bin/npm"), 0o755);
  const moduleUrl = new URL("./desktop-task-publish.mjs", import.meta.url).href;
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { buildDesktop } from ${JSON.stringify(moduleUrl)}; await buildDesktop(process.argv[1], process.argv[2]);`,
      root,
      "0.7.1-lan.123",
    ],
    {
      env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}` },
    },
  );
  const args = JSON.parse(await readFile(join(root, "build/args.json")));
  assert.deepEqual(args.slice(0, 4), ["run", "build:linux", "--", "--config"]);
  assert.deepEqual(JSON.parse(await readFile(args[4])), {
    version: "0.7.1-lan.123",
    plugins: {
      updater: {
        endpoints: ["http://192.168.0.206/latest.json"],
        dangerousInsecureTransportProtocol: true,
      },
    },
  });
  assert.equal(
    JSON.parse(await readFile(join(root, "src-tauri/tauri.conf.json"))).version,
    "0.7.0",
  );
});

test(
  "the shared desktop lock rejects another invocation before starting a build",
  { skip: process.platform !== "linux" },
  async (t) => {
    const { root, write } = await fixture(t);
    await write(
      "scripts/desktop-task-publish.mjs",
      'throw new Error("must not start");',
    );
    const hook = join(root, "scripts/desktop-task-publish.sh");
    await copyFile(
      fileURLToPath(new URL("./desktop-task-publish.sh", import.meta.url)),
      hook,
    );
    const state = join(root, "build/global-state");
    await mkdir(state);
    const holder = spawn(
      "flock",
      [
        join(state, "task.lock"),
        process.execPath,
        "-e",
        'process.stdout.write("locked"); process.stdin.resume();',
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const closed = once(holder, "close");
    t.after(async () => {
      holder.stdin.end();
      await closed;
    });
    await once(holder.stdout, "data");
    assert.throws(
      () =>
        execFileSync("bash", [hook], {
          env: { ...process.env, MONOCODE_DESKTOP_STATE_DIR: state },
          stdio: "pipe",
        }),
      (error) => {
        assert.equal(error.status, 1);
        assert.match(error.stderr.toString(), /publication is already running/);
        assert.doesNotMatch(error.stderr.toString(), /must not start/);
        return true;
      },
    );
  },
);
