import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { parseWslUncPath } from "../../shared/lib/wslPaths";

export const listWslDistributions = () => invoke<string[]>("wsl_distributions");

/** Keep the Linux path's case; only the Windows server/share names ignore case. */
export function wslFolderPath(path: string, distribution: string): string {
  const parsed = parseWslUncPath(path);
  if (!parsed || parsed.machine.distribution.toLowerCase() !== distribution.toLowerCase()) {
    throw new Error("Choose a folder inside the selected WSL distribution.");
  }
  return parsed.hostPath;
}

export async function pickWslFolder(distribution: string, title: string): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath: `\\\\wsl.localhost\\${distribution}\\`,
    title,
  });
  return selected ? wslFolderPath(selected, distribution) : null;
}
