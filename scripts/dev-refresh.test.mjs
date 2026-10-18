import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  desktopProcessTree,
  readProcess,
  refresh,
  stopProcessEntries,
} from "./dev-refresh.mjs";

test("refresh waits for Host and desktop before publishing", async () => {
  const calls = [];
  const names = [
    "buildHost",
    "restartHost",
    "stopDesktop",
    "startDesktop",
    "publish",
  ];
  await refresh(
    Object.fromEntries(
      names.map((name) => [
        name,
        async () => {
          await new Promise((resolve) => setImmediate(resolve));
          calls.push(name);
        },
      ]),
    ),
  );
  assert.deepEqual(calls, names);
});

for (const failed of [
  "buildHost",
  "restartHost",
  "stopDesktop",
  "startDesktop",
  "publish",
]) {
  test(`failure in ${failed} prevents later steps`, async () => {
    const calls = [];
    const names = [
      "buildHost",
      "restartHost",
      "stopDesktop",
      "startDesktop",
      "publish",
    ];
    await assert.rejects(
      refresh(
        Object.fromEntries(
          names.map((name) => [
            name,
            async () => {
              calls.push(name);
              if (name === failed) throw new Error("expected failure");
            },
          ]),
        ),
      ),
      /expected failure/,
    );
    assert.deepEqual(calls, names.slice(0, names.indexOf(failed) + 1));
  });
}

test("desktop selection leaves other checkouts, mobile, release and CLI processes alone", () => {
  const checkout = "/tmp/monocode-dev-refresh-fixture";
  const entry = (pid, args, extra = {}) => ({
    pid,
    ppid: 1,
    cwd: checkout,
    exe: "/usr/bin/node",
    args,
    ...extra,
  });
  const tauri = [
    "node",
    `${checkout}/node_modules/.bin/tauri`,
    "dev",
    "--no-watch",
  ];
  const vite = ["node", `${checkout}/node_modules/.bin/vite`];
  const native = `${checkout}/target/debug/monocode`;
  const entries = [
    entry(1, tauri),
    entry(2, ["cargo", "run"], { ppid: 1, cwd: `${checkout}/src-tauri` }),
    entry(3, [native], { ppid: 2, exe: native, cwd: `${checkout}/src-tauri` }),
    entry(4, [...vite, "--mode", "stable"]),
    entry(5, ["esbuild", "--service"], { ppid: 4 }),
    entry(6, [...vite, "--config", "vite.mobile.config.ts"]),
    entry(7, tauri, { cwd: "/tmp/other-checkout" }),
    entry(8, ["node", `${checkout}/node_modules/.bin/tauri`, "build"]),
    entry(9, ["bash", "-c", tauri.join(" ")]),
    entry(10, [`${checkout}/target/release/monocode`], {
      exe: `${checkout}/target/release/monocode`,
    }),
    entry(11, [native, "control", "status"], { exe: native }),
    entry(12, ["node", `${checkout}/build/host/monocode-host.mjs`, "serve"]),
  ];
  // Synthetic roots need an unrelated parent, not the selected PID 1.
  for (const item of entries) if (![2, 3, 5].includes(item.pid)) item.ppid = 99;
  assert.deepEqual(
    desktopProcessTree(entries, checkout).map((item) => item.pid),
    [1, 2, 3, 4, 5],
  );
});

test("process snapshot handles spaces in comm, zombies and disappeared PIDs", () => {
  const directory = mkdtempSync(join(tmpdir(), "monocode-proc-"));
  try {
    const proc = join(directory, "123");
    mkdirSync(proc);
    symlinkSync("/tmp/checkout", join(proc, "cwd"));
    symlinkSync(
      "/tmp/checkout/target/debug/monocode (deleted)",
      join(proc, "exe"),
    );
    writeFileSync(join(proc, "cmdline"), "monocode\0");
    const fields = ["S", "42", ...Array(17).fill("0"), "987654"];
    writeFileSync(
      join(proc, "stat"),
      `123 (name with ) spaces) ${fields.join(" ")}`,
    );
    assert.deepEqual(readProcess(123, directory), {
      pid: 123,
      ppid: 42,
      started: "987654",
      cwd: "/tmp/checkout",
      exe: "/tmp/checkout/target/debug/monocode",
      args: ["monocode"],
    });
    fields[0] = "Z";
    writeFileSync(join(proc, "stat"), `123 (zombie) ${fields.join(" ")}`);
    assert.equal(readProcess(123, directory), null);
    assert.equal(readProcess(456, directory), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const ignoreHangup of [false, true]) {
  test(`desktop shutdown handles a child ignoring ${ignoreHangup ? "TERM and HUP" : "TERM"}`, async () => {
    // Disposable processes reproduce the terminal's signal behavior without
    // touching the running desktop, Host, or any real terminal session.
    const child = spawn(
      process.execPath,
      [
        "-e",
        `
      process.on("SIGTERM", () => {});
      ${ignoreHangup ? 'process.on("SIGHUP", () => {});' : ""}
      process.send("ready");
      setInterval(() => {}, 1000);
    `,
      ],
      { stdio: ["ignore", "ignore", "ignore", "ipc"] },
    );
    const closed = new Promise((resolve) => child.once("close", resolve));
    try {
      await new Promise((resolve, reject) => {
        child.once("message", resolve);
        child.once("error", reject);
      });
      const snapshot = readProcess(child.pid);
      assert.ok(snapshot);
      // A stale snapshot with the same PID must leave the live process alone.
      await stopProcessEntries([{ ...snapshot, started: "stale" }]);
      assert.equal(child.signalCode, null);
      await stopProcessEntries([snapshot], {
        termTimeout: 50,
        hangupTimeout: 50,
        killTimeout: 2_000,
      });
      await closed;
      assert.equal(child.signalCode, ignoreHangup ? "SIGKILL" : "SIGHUP");
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await closed;
    }
  });
}

test("shutdown refuses to kill the invoking workflow", async () => {
  await assert.rejects(
    stopProcessEntries([readProcess(process.pid)]),
    /own terminal/,
  );
});

test("shell help is read-only and works without a display or systemd", () => {
  const output = execFileSync(
    "bash",
    [new URL("./dev-refresh.sh", import.meta.url).pathname, "--help"],
    {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    },
  );
  assert.match(output, /npm run dev:refresh/);
  assert.match(output, /--dry-run/);
});

for (const lock of ["dev-refresh.lock", "task.lock"]) {
  test(`shell refuses an overlapping ${lock} before starting work`, () => {
    const directory = mkdtempSync(join(tmpdir(), "monocode-refresh-lock-"));
    try {
      assert.throws(
        () =>
          execFileSync(
            "flock",
            [
              "-n",
              join(directory, lock),
              "bash",
              new URL("./dev-refresh.sh", import.meta.url).pathname,
            ],
            {
              encoding: "utf8",
              stdio: "pipe",
              env: { ...process.env, MONOCODE_DESKTOP_STATE_DIR: directory },
            },
          ),
        (error) => {
          assert.equal(error.status, 1);
          assert.match(error.stderr, /running/);
          assert.doesNotMatch(error.stdout, /Building Host/);
          return true;
        },
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
