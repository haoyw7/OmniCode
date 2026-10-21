import { queryOptions } from "@tanstack/react-query";
import { listProjectFiles, type ProjectFile } from "../../../../platform/tauri/fs";
import { invalidateAfterChange, queryClient } from "../../../../shared/lib/queryClient";
import { subscribeDirsChanged } from "./fileTree";
import { scorePath, type FuzzyHit } from "../../../../shared/lib/fuzzy";
import { resolveWorkspacePath, slash } from "../../../../shared/lib/paths";
import { looksLikeProject } from "../../../projects/model/recents";
import {
  normalizeEditorPath,
  type FileOpenOptions,
} from "../../../search/model/search";

const MAX_RECENTS = 30;
const MAX_RESULTS = 80;
const CACHE_LIMIT = 8;

const recentsByCwd = new Map<string, string[]>();
let accessOrder = 0;

export const projectFileKeys = {
  all: ["files", "index"] as const,
  cwd: (cwd: string) => ["files", "index", cwd] as const,
};

export const projectFilesQuery = (cwd: string) => queryOptions({
  queryKey: projectFileKeys.cwd(cwd),
  queryFn: () => looksLikeProject(cwd) ? listProjectFiles(cwd) : Promise.resolve([]),
  // All consumers share the same listing, including prefetch and link resolution.
  // Directory notifications and window resume invalidate active and inactive keys.
  staleTime: Infinity,
  // Resume invalidation below also covers inactive keys; avoid a second scan
  // from the global focus bridge before that invalidation runs.
  refetchOnWindowFocus: false,
  meta: { fileIndexAccess: ++accessOrder },
});

function normCwd(cwd: string): string {
  return slash(cwd).replace(/\/+$/, "") || "/";
}

export function peekProjectFiles(cwd: string): ProjectFile[] | null {
  return queryClient.getQueryData(projectFileKeys.cwd(cwd)) ?? null;
}

export async function invalidateProjectFiles(cwd?: string) {
  const queryKey = cwd ? projectFileKeys.cwd(cwd) : projectFileKeys.all;
  // Native scans cannot be aborted, but cancelled Query results cannot restore
  // a listing from before a write, including an inactive first scan.
  await queryClient.cancelQueries({ queryKey });
  await invalidateAfterChange(queryKey);
}

export function rememberOpenedFile(cwd: string, path: string) {
  if (!path) return;
  const key = normCwd(cwd);
  const prev = recentsByCwd.get(key) ?? [];
  recentsByCwd.set(
    key,
    [path, ...prev.filter((item) => item !== path)].slice(0, MAX_RECENTS),
  );
}

export function recentOpenedFiles(cwd: string): string[] {
  return recentsByCwd.get(normCwd(cwd)) ?? [];
}

export function prefetchProjectFiles(cwd: string) {
  if (!looksLikeProject(cwd)) return;
  void loadProjectFiles(cwd).catch(() => {});
}

export async function loadProjectFiles(
  cwd: string,
  refresh = false,
): Promise<ProjectFile[]> {
  if (!looksLikeProject(cwd)) return [];
  if (refresh) await invalidateProjectFiles(cwd);
  const options = projectFilesQuery(cwd);
  const cached = queryClient.getQueryCache().find({ queryKey: options.queryKey, exact: true });
  // fetchQuery can return fresh data without updating the query's options.
  if (cached?.meta) cached.meta.fileIndexAccess = options.meta?.fileIndexAccess;
  return queryClient.fetchQuery(options);
}

export type RankedFile = ProjectFile & FuzzyHit;

export function rankProjectFiles(
  files: ProjectFile[],
  query: string,
  recents: string[],
  limit = MAX_RESULTS,
): RankedFile[] {
  const recentRank = new Map(recents.map((path, index) => [path, index]));

  if (!query.trim()) {
    const byPath = new Map(files.map((file) => [file.path, file]));
    const out: RankedFile[] = [];
    const seen = new Set<string>();
    for (const path of recents) {
      if (seen.has(path)) continue;
      seen.add(path);
      const file = byPath.get(path);
      if (!file) continue;
      out.push({ ...file, score: 0, positions: [] });
      if (out.length >= limit) break;
    }
    return out;
  }

  const scored: RankedFile[] = [];
  for (const file of files) {
    const hit = scorePath(query, file.relative, file.name);
    if (!hit) continue;
    const recency = recentRank.get(file.path);
    const score =
      hit.score + (recency == null ? 0 : (MAX_RECENTS - recency) * 8);
    scored.push({ ...file, score, positions: hit.positions });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.relative.length !== b.relative.length) {
      return a.relative.length - b.relative.length;
    }
    return a.relative.localeCompare(b.relative);
  });
  return scored.slice(0, limit);
}

/** Resolve a transcript or markdown file link to an existing project file. */
export async function resolveOpenablePath(
  cwd: string,
  href: string,
): Promise<string | undefined> {
  const direct = resolveWorkspacePath(href, cwd);
  if (!direct) return undefined;

  let files: ProjectFile[];
  try {
    files = await loadProjectFiles(cwd);
  } catch {
    // The index only disambiguates shortened paths. Let the editor read the
    // direct path and show its own error if that file is unavailable too.
    return direct;
  }
  if (files.length === 0) return direct;

  const byPath = new Map(
    files.map((file) => [normalizeEditorPath(file.path), file]),
  );
  const normalizedDirect = normalizeEditorPath(direct);
  const exact = byPath.get(normalizedDirect);
  if (exact) return exact.path;

  const relHint = relativePathHint(href, cwd, direct);
  const exactRelative = files.find(
    (file) =>
      file.relative === relHint ||
      normalizeEditorPath(file.relative) === relHint,
  );
  if (exactRelative) return exactRelative.path;

  const suffixMatches = files.filter(
    (file) =>
      file.relative === relHint ||
      file.relative.endsWith(`/${relHint}`) ||
      relHint.endsWith(file.relative),
  );
  if (suffixMatches.length === 1) return suffixMatches[0].path;

  const baseName = relHint.split("/").filter(Boolean).pop() ?? relHint;
  const byName = files.filter((file) => file.name === baseName);
  if (byName.length === 0) return direct;
  if (byName.length === 1) return byName[0].path;

  return pickOpenableFile(byName, cwd, relHint).path;
}

/** Resolve shortened references while preserving paths selected from file UI. */
export async function resolveFileOpenRequest(
  cwd: string,
  path: string,
  options?: FileOpenOptions,
): Promise<string> {
  if (options?.exact) return path;
  return (await resolveOpenablePath(cwd, path)) ?? path;
}

function relativePathHint(href: string, cwd: string, direct: string): string {
  let value = href.trim().replace(/\\/g, "/");
  value = value.replace(/(?::\d+(?::\d+)?|#L\d+(?:-L\d+)?)$/, "");
  if (value.startsWith("file://")) {
    try {
      value = decodeURIComponent(value.slice("file://".length));
    } catch {
      value = value.slice("file://".length);
    }
    value = value.replace(/\\/g, "/");
  }
  value = value.replace(/^\.\//, "").replace(/^\/+/, "");

  const base = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedDirect = normalizeEditorPath(direct);
  if (base && base !== "~" && normalizedDirect.startsWith(`${base}/`)) {
    return normalizedDirect.slice(base.length + 1);
  }
  return value;
}

function pickOpenableFile(
  candidates: ProjectFile[],
  cwd: string,
  relHint: string,
): ProjectFile {
  const recents = recentOpenedFiles(cwd);
  for (const recent of recents) {
    const normalizedRecent = normalizeEditorPath(recent);
    const hit = candidates.find(
      (file) => normalizeEditorPath(file.path) === normalizedRecent,
    );
    if (hit) return hit;
  }

  const suffixMatches = candidates.filter(
    (file) =>
      file.relative === relHint || file.relative.endsWith(`/${relHint}`),
  );
  if (suffixMatches.length > 0) {
    return suffixMatches.sort(
      (a, b) => a.relative.length - b.relative.length,
    )[0];
  }

  return candidates.sort((a, b) => a.relative.length - b.relative.length)[0];
}

subscribeDirsChanged(() => { void invalidateProjectFiles(); });

queryClient.getQueryCache().subscribe((event) => {
  if (event.query.queryKey[0] !== "files" || event.query.queryKey[1] !== "index") return;
  if (event.type !== "observerRemoved" && !(event.type === "updated" && event.action.type === "success")) return;
  const retained = queryClient.getQueryCache().findAll({ queryKey: projectFileKeys.all })
    .filter((query) => query.state.data !== undefined)
    .sort((a, b) => Number(b.meta?.fileIndexAccess ?? 0) - Number(a.meta?.fileIndexAccess ?? 0));
  for (const query of retained.slice(CACHE_LIMIT)) {
    // Mounted views and unfinished scans must survive another tab's prefetch.
    if (query.getObserversCount() === 0 && query.state.fetchStatus === "idle") {
      queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
    }
  }
});

if (typeof document !== "undefined") {
  const resume = () => {
    if (document.hidden) return;
    // Inactive worktrees become stale and reload only when used again.
    void invalidateProjectFiles();
  };
  window.addEventListener("focus", resume);
  document.addEventListener("visibilitychange", resume);
}
