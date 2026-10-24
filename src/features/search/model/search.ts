import type { ProjectSearchResult, ProjectSearchOptions } from "../../../contracts/search";
import { invokeWorkspace } from "../../../platform/tauri/fs";
import { pathKey, slash } from "../../../shared/lib/paths";

export function normalizeEditorPath(path: string): string {
  return slash(path).replace(/\/+$/, "") || path;
}

export function editorPathsEqual(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

export function searchProject(
  options: ProjectSearchOptions,
): Promise<ProjectSearchResult> {
  return invokeWorkspace<ProjectSearchResult>("search_project", { options });
}
