import { spawn } from "node:child_process";
import { join } from "node:path";

// The IPC channel belongs only to the host. Disconnect detects even a hard
// crash without a blocking Windows filesystem read that can hang process.exit.
if (!process.connected) throw new Error("Missing host IPC channel");
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("Missing provider command");
const child = spawn(command, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: "pipe",
  detached: process.platform !== "win32",
  windowsHide: true,
});
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.stdin.on("error", () => {});

let stopping = false;
let exitCode = 1;
let escalation;
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  clearTimeout(escalation);
  if (process.connected) process.disconnect();
  // The watchdog/stdin pipes can remain open after the provider exits.
  // Ownership is finished; do not make the host kill an otherwise idle guard.
  process.stdout.write("", () => {
    process.stderr.write("", () => process.exit(exitCode));
  });
}
function stopTree() {
  if (stopping) return;
  stopping = true;
  if (process.platform === "win32") {
    const killer = spawn(
      join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
      ["/PID", String(child.pid), "/T", "/F"],
      {
        stdio: "ignore",
        windowsHide: true,
      },
    );
    killer.on("error", () => child.kill());
    killer.on("close", finish);
  } else {
    // The provider leads its own process group, so the guard survives long
    // enough to escalate if one of its descendants ignores SIGTERM.
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      finish();
      return;
    }
    escalation = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* exited */
      }
      finish();
    }, 1_000);
  }
}
process.on("disconnect", stopTree);
process.on("SIGTERM", stopTree);
process.on("SIGINT", stopTree);
child.on("error", (error) => {
  console.error(error.message);
  stopTree();
});
child.on("close", (code) => {
  exitCode = code ?? 1;
  if (stopping && process.platform !== "win32") {
    try { process.kill(-child.pid, 0); }
    catch (error) {
      if (error.code === "ESRCH") finish();
    }
  }
  stopTree();
});
