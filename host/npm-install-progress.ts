import { reportStartupProgress } from "./startup-progress";

/** Only counters leave this parser; package URLs and npm diagnostics stay private. */
export function npmInstallProgress(): (chunk: string) => void {
  let pending = "";
  const installed = new Set<string>(), downloaded = new Set<string>();
  return chunk => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop()!.slice(-16_384);
    for (const line of lines) {
      const file = line.match(/\btiming reifyNode:(\S+) Completed in/);
      const fetch = line.match(/\bhttp fetch GET 200 (\S+\.tgz)(?:\s|$)/);
      if (!file && !fetch) continue;
      if (file) installed.add(file[1]);
      if (fetch) downloaded.add(fetch[1]);
      reportStartupProgress({ stage: "installing-dependencies", unit: "packages",
        completed: installed.size, downloaded: downloaded.size });
    }
  };
}
