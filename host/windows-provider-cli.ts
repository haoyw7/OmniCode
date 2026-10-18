import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import discoveryScript from "../src/platform/windows/desktop-provider-cli.ps1?raw";

/** Defer desktop payloads found on PATH until independent installs are tried. */
export function isWindowsDesktopProviderPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  return normalized.includes("/resources/") ||
    normalized.includes("/openai/codex/bin/") ||
    normalized.includes("/claude/claude-code/") ||
    /\/windowsapps\/(openai\.codex|claude)_/.test(normalized);
}

export async function resolveWindowsDesktopProvider(provider: string): Promise<string | undefined> {
  if (process.platform !== "win32" || !["codex", "claude"].includes(provider)) return;
  try {
    const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
    const { stdout } = await promisify(execFile)(powershell, [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
      `& {\n${discoveryScript}\n} -Provider ${provider}`,
    ], { timeout: 5_000, maxBuffer: 64 * 1024, windowsHide: true, encoding: "utf8" });
    const path = stdout.trim();
    if (isAbsolute(path) && (await stat(path)).isFile()) return path;
  } catch { /* Missing desktop app, inaccessible package, or unavailable PowerShell. */ }
}
