import { basename } from "../../../../platform/tauri/fs";
import { joinPath, parentPath, pathKey, slash } from "../../../../shared/lib/paths";

export type FileBreadcrumbSegment = { path: string; label: string; directory: string; selected: string };

export type FileBreadcrumbLayout = { headCount: number; tailStart: number; showEllipsis: boolean };

/** Reserve the filename, then its parent and the path head, before middle ancestors. */
export function fitFileBreadcrumb(
  segments: readonly { label: string; width: number }[],
  available: number,
  separatorWidth: number,
  ellipsisWidth: number,
  gap: number,
): FileBreadcrumbLayout {
  const width = (items: readonly { label: string; width: number }[]) => {
    let total = items.reduce((sum, item) => sum + item.width, 0);
    let count = items.length;
    for (let i = 1; i < items.length; i++) {
      if (items[i - 1].label !== "/") { total += separatorWidth; count++; }
    }
    return total + Math.max(0, count - 1) * gap;
  };
  const complete = { headCount: 0, tailStart: 0, showEllipsis: false };
  if (segments.length < 2 || width(segments) <= available) return complete;
  let tailStart = segments.length - 1;
  let headCount = 0;
  const fits = (head: number, tail: number) => width([
    ...segments.slice(0, head),
    ...(head < tail ? [{ label: "…", width: ellipsisWidth }] : []),
    ...segments.slice(tail),
  ]) <= available;
  // Even the ellipsis yields its space before we truncate the filename.
  if (!fits(0, tailStart)) return { headCount: 0, tailStart, showEllipsis: false };
  if (tailStart > 0 && fits(0, tailStart - 1)) tailStart--;
  const preferredHead = segments[0].label === "/" && segments.length > 3 ? 2 : 1;
  if (preferredHead <= tailStart && fits(preferredHead, tailStart)) headCount = preferredHead;
  while (tailStart > headCount && fits(headCount, tailStart - 1)) tailStart--;
  return { headCount, tailStart, showEllipsis: headCount < tailStart };
}

/** Stop at the project directory; keep real roots for files outside that project. */
export function fileBreadcrumbSegments(path: string, cwd: string): FileBreadcrumbSegment[] {
  const normalized = slash(path);
  const absolute = /^(?:\/|[A-Za-z]:\/|remote:\/\/)/.test(normalized)
    ? normalized : joinPath(cwd, normalized);
  const remoteRoot = /^remote:\/\/[^/]+\//.exec(absolute)?.[0];
  const paths = [absolute];
  let current = parentPath(absolute);
  while (pathKey(current) !== pathKey(paths[0]) && pathKey(paths[0]) !== pathKey(cwd)) {
    paths.unshift(current);
    if (remoteRoot && pathKey(current) === pathKey(remoteRoot)) break;
    const parent = parentPath(current);
    if (pathKey(parent) === pathKey(current)) break;
    current = parent;
  }
  return paths.map((entry, index) => ({
    path: entry,
    label: remoteRoot && pathKey(entry) === pathKey(remoteRoot) ? remoteRoot : basename(entry),
    directory: index === paths.length - 1 ? parentPath(entry) : entry,
    selected: paths[index + 1] ?? entry,
  }));
}
