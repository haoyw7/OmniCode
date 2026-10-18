import { spawn } from "node:child_process";

// Keep remote and local builds nonblocking so the two machines can work together.
export function runBuildProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      windowsHide: true,
      ...options,
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal ?? code}).`));
    });
  });
}
