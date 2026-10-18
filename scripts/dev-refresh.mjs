import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { runBuildProcess } from "./desktop-build-process.mjs";

const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));
const service = "monocode-host.service";
const bundle = join(root, "build/host/monocode-host.mjs");
const logDirectory = join(root, "build/dev-refresh");
const desktopLog = join(logDirectory, "desktop.log");
const help = `Usage: npm run dev:refresh [-- --dry-run]

Linux: rebuild Host, restart its existing systemd user service, restart this
checkout's desktop with tauri:stable, then build/publish the LAN APK through
mobile:publish. Unchanged APK sources retain the existing publication.

  --dry-run  Inspect prerequisites and print steps without changing anything
  --help     Show this help

Requires Node 24+, installed project dependencies, the current checkout's
monocode-host.service, and a graphical login. Run relevant checks first.
Restarting interrupts active Host turns and closes the development desktop.
Desktop log: build/dev-refresh/desktop.log
Host log: journalctl --user -u monocode-host.service -n 100
Desktop startup timeout: MONOCODE_DESKTOP_START_TIMEOUT_SECONDS (default 600).
Invoke through npm or scripts/dev-refresh.sh so publication locks are held.`;

function samePath(left, right) {
  if (!left || !right) return false;
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return resolve(left) === resolve(right);
  }
}

// Read argv and executable paths, never match arbitrary text in a shell command.
export function readProcess(pid, procDirectory = "/proc") {
  const directory = join(procDirectory, String(pid));
  try {
    if (statSync(directory).uid !== process.getuid()) return null;
    const stat = readFileSync(join(directory, "stat"), "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (fields[0] === "Z") return null;
    return {
      pid: Number(pid),
      ppid: Number(fields[1]),
      started: fields[19],
      cwd: readlinkSync(join(directory, "cwd")),
      exe: readlinkSync(join(directory, "exe")).replace(/ \(deleted\)$/, ""),
      args: readFileSync(join(directory, "cmdline"), "utf8")
        .split("\0")
        .filter(Boolean),
    };
  } catch (error) {
    if (["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(error.code))
      return null;
    throw error;
  }
}

function processes() {
  return readdirSync("/proc")
    .filter((name) => /^\d+$/.test(name))
    .map((pid) => readProcess(pid))
    .filter(Boolean);
}

export function isDesktopProcess(
  entry,
  checkout,
  targetDirectory = join(checkout, "target"),
) {
  if (
    ![checkout, join(checkout, "src-tauri")].some((path) =>
      samePath(entry.cwd, path),
    )
  )
    return false;
  if (samePath(entry.exe, join(targetDirectory, "debug/monocode")))
    return entry.args.length === 1;
  const [, script, ...args] = entry.args;
  if (samePath(script, join(checkout, "node_modules/.bin/tauri")))
    return args[0] === "dev";
  // A mobile Vite instance has --config and must remain running.
  return (
    samePath(script, join(checkout, "node_modules/.bin/vite")) &&
    (args.length === 0 ||
      (args.length === 2 && args[0] === "--mode" && args[1] === "stable"))
  );
}

export function desktopProcessTree(entries, checkout, targetDirectory) {
  const selected = new Set(
    entries
      .filter((entry) => isDesktopProcess(entry, checkout, targetDirectory))
      .map((entry) => entry.pid),
  );
  let previousSize;
  do {
    previousSize = selected.size;
    for (const entry of entries)
      if (selected.has(entry.ppid)) selected.add(entry.pid);
  } while (previousSize !== selected.size);
  return entries.filter((entry) => selected.has(entry.pid));
}

async function waitUntil(check, timeout, description) {
  const deadline = Date.now() + timeout;
  do {
    if (await check()) return;
    await delay(500);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}`);
}

function stillRunning(entry) {
  return readProcess(entry.pid)?.started === entry.started;
}

export async function stopProcessEntries(
  entries,
  { termTimeout = 5_000, hangupTimeout = 3_000, killTimeout = 2_000 } = {},
) {
  if (entries.some((entry) => entry.pid === process.pid))
    throw new Error("Cannot restart from inside the desktop's own terminal.");
  // Interactive shells ignore SIGTERM. Hang up their old terminal before
  // escalating, and keep the original start time so a reused PID is never killed.
  for (const [signal, timeout] of [
    ["SIGTERM", termTimeout],
    ["SIGHUP", hangupTimeout],
    ["SIGKILL", killTimeout],
  ]) {
    const remaining = entries.filter(stillRunning);
    if (!remaining.length) return;
    if (signal !== "SIGTERM")
      console.log(
        `Stopping remaining desktop processes with ${signal}: ${remaining.map((entry) => entry.pid).join(", ")}`,
      );
    for (const entry of remaining) {
      if (!stillRunning(entry)) continue;
      try {
        process.kill(entry.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    const deadline = Date.now() + timeout;
    do {
      if (entries.every((entry) => !stillRunning(entry))) return;
      await delay(50);
    } while (Date.now() < deadline);
  }
  const remaining = entries.filter(stillRunning);
  if (remaining.length)
    throw new Error(
      `Old desktop processes did not exit (PIDs: ${remaining.map((entry) => entry.pid).join(", ")}); inspect them before retrying.`,
    );
}

async function stopDesktop(targetDirectory) {
  await stopProcessEntries(
    desktopProcessTree(processes(), root, targetDirectory),
  );
}

function systemctl(...args) {
  return execFileSync("systemctl", ["--user", ...args], {
    encoding: "utf8",
    timeout: 60_000,
  }).trim();
}

function preflight(dryRun) {
  if (process.platform !== "linux")
    throw new Error("This script requires Linux and a systemd user service.");
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("Node 24+ is required.");
  if (!existsSync(join(root, "node_modules/.bin/tauri")))
    throw new Error("Install project dependencies first (npm ci).");
  if (!dryRun && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
    throw new Error("Run from a terminal in your graphical login.");
  const timeout = Number(
    process.env.MONOCODE_DESKTOP_START_TIMEOUT_SECONDS ?? 600,
  );
  if (!Number.isFinite(timeout) || timeout <= 0)
    throw new Error("Invalid desktop startup timeout.");
  const command = systemctl("show", service, "--property=ExecStart", "--value");
  // systemd prints the Node entry in argv[]. Resolve aliases such as /projects
  // and /home/wy/projects before comparing with the checkout being rebuilt.
  const entries =
    command.match(/\/[^\s;]*\/build\/host\/monocode-host\.mjs/g) ?? [];
  if (!entries.some((entry) => samePath(entry, bundle))) {
    throw new Error(
      `${service} must run this checkout's ${bundle}. Inspect: systemctl --user cat ${service}`,
    );
  }
  const targetDirectory = resolve(
    root,
    process.env.CARGO_TARGET_DIR || "target",
  );
  if (
    !dryRun &&
    desktopProcessTree(processes(), root, targetDirectory).some(
      (entry) => entry.pid === process.pid,
    )
  )
    throw new Error(
      "Run from a system terminal outside OmniCode; restarting the desktop would terminate this script in its built-in terminal.",
    );
  return { timeout: timeout * 1000, targetDirectory };
}

async function restartHost() {
  systemctl("restart", service);
  // is-active alone can succeed before the Host accepts connections. The CLI
  // checks the authenticated lifecycle endpoint without printing credentials.
  await waitUntil(
    () => {
      try {
        const state = JSON.parse(
          readFileSync(join(homedir(), ".monocode-host/running.json"), "utf8"),
        );
        if (
          String(state.pid) !==
          systemctl("show", service, "--property=MainPID", "--value")
        )
          return false;
        execFileSync(process.execPath, [bundle, "status"], {
          cwd: root,
          stdio: "ignore",
          timeout: 10_000,
        });
        return true;
      } catch {
        return false;
      }
    },
    60_000,
    `Host startup; inspect journalctl --user -u ${service} -n 100`,
  );
}

async function startDesktop({ timeout, targetDirectory }) {
  mkdirSync(logDirectory, { recursive: true });
  const log = openSync(desktopLog, "w", 0o600);
  let child;
  try {
    child = spawn("npm", ["run", "tauri:stable"], {
      cwd: root,
      detached: true,
      stdio: ["ignore", log, log],
      env: process.env,
    });
  } finally {
    closeSync(log);
  }
  let failure;
  child.once("error", (error) => {
    failure = error;
  });
  child.once("exit", (code, signal) => {
    failure = new Error(
      `Desktop exited (${signal ?? code}); see ${desktopLog}`,
    );
  });
  child.unref();
  console.log(`Desktop log: ${desktopLog}`);
  try {
    await waitUntil(
      async () => {
        if (failure) throw failure;
        const entries = processes();
        const descendants = new Set([child.pid]);
        for (let size = -1; size !== descendants.size;) {
          size = descendants.size;
          for (const entry of entries)
            if (descendants.has(entry.ppid)) descendants.add(entry.pid);
        }
        if (
          !entries.some(
            (entry) =>
              descendants.has(entry.pid) &&
              samePath(entry.exe, join(targetDirectory, "debug/monocode")),
          )
        )
          return false;
        try {
          const response = await fetch("http://localhost:1420", {
            signal: AbortSignal.timeout(2_000),
          });
          await response.body?.cancel();
          return response.ok;
        } catch {
          return false;
        }
      },
      timeout,
      `desktop startup; see ${desktopLog}`,
    );
  } catch (error) {
    // Do not leave a detached compiler holding the target directory after the
    // shell releases the shared desktop-publication lock on startup failure.
    await stopDesktop(targetDirectory);
    throw error;
  }
}

export async function refresh({
  buildHost,
  restartHost: restart,
  stopDesktop: stop,
  startDesktop: start,
  publish,
}) {
  console.log("[1/4] Building Host...");
  await buildHost();
  console.log("[2/4] Restarting Host...");
  await restart();
  console.log("[3/4] Restarting development desktop...");
  await stop();
  await start();
  console.log("[4/4] Building and publishing LAN APK...");
  await publish();
}

async function main(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log(help);
    return;
  }
  const dryRun = args.length === 1 && args[0] === "--dry-run";
  if (args.length && !dryRun) throw new Error(help);
  const options = preflight(dryRun);
  if (dryRun) {
    console.log(
      `Repository: ${root}\n1. npm run host:build\n2. systemctl --user restart ${service}; wait for Host\n3. Stop current checkout's desktop; npm run tauri:stable; wait for native process and Vite\n4. npm run mobile:publish`,
    );
    console.log(
      `Desktop PIDs to stop: ${
        desktopProcessTree(processes(), root, options.targetDirectory)
          .map((entry) => entry.pid)
          .join(", ") || "none"
      }`,
    );
    console.log(`Desktop log: ${desktopLog}\nDry run only; no changes made.`);
    return;
  }
  console.log(
    "Restarting interrupts active Host turns and closes the development desktop.",
  );
  await refresh({
    buildHost: () =>
      runBuildProcess("npm", ["run", "host:build"], { cwd: root }),
    restartHost,
    stopDesktop: () => stopDesktop(options.targetDirectory),
    startDesktop: () => startDesktop(options),
    publish: () =>
      runBuildProcess("npm", ["run", "mobile:publish"], { cwd: root }),
  });
  console.log(
    `Finished. Host and desktop were restarted. APK publication result is shown above.\nDesktop log: ${desktopLog}`,
  );
}

if (
  process.argv[1] &&
  samePath(process.argv[1], fileURLToPath(import.meta.url))
) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Refresh stopped: ${error.message}`);
    process.exitCode = 1;
  });
}
