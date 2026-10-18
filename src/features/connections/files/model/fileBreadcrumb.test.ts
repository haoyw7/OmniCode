import { describe, expect, it } from "vitest";
import { fitFileBreadcrumb, fileBreadcrumbSegments } from "./fileBreadcrumb";

describe("file breadcrumb paths", () => {
  it.each([
    ["/repo/src/a.ts", "/repo", ["/repo", "/repo/src", "/repo/src/a.ts"]],
    ["src/a.ts", "/repo/", ["/repo", "/repo/src", "/repo/src/a.ts"]],
    ["C:\\repo\\a.ts", "C:\\repo", ["C:/repo", "C:/repo/a.ts"]],
    ["c:\\Repo\\a.ts", "C:\\REPO", ["c:/Repo", "c:/Repo/a.ts"]],
    ["\\\\server\\share\\repo\\a.ts", "\\\\server\\share", ["//server/share", "//server/share/repo", "//server/share/repo/a.ts"]],
    ["remote://machine/home/repo/a.ts", "remote://machine/home/repo", ["remote://machine/home/repo", "remote://machine/home/repo/a.ts"]],
    ["/a.ts", "/", ["/", "/a.ts"]],
    ["/repo-other/a.ts", "/repo", ["/", "/repo-other", "/repo-other/a.ts"]],
  ])("uses the project boundary without corrupting paths for %s", (path, cwd, paths) => {
    const segments = fileBreadcrumbSegments(path, cwd);
    expect(segments.map(segment => segment.path)).toEqual(paths);
    expect(segments.at(-1)?.directory).toBe(paths.at(-2));
    expect(segments.at(-2)?.selected).toBe(paths.at(-1));
  });
});

describe("breadcrumb visibility priority", () => {
  const parts = [
    { label: "/", width: 10 },
    { label: "repo", width: 30 },
    { label: "src", width: 40 },
    { label: "model", width: 40 },
    { label: "connections.ts", width: 90 },
  ];
  const shown = (available: number, items = parts) => {
    const layout = fitFileBreadcrumb(items, available, 5, 18, 2);
    return [...items.slice(0, layout.headCount).map(item => item.label), ...(layout.showEllipsis ? ["…"] : []), ...items.slice(layout.tailStart).map(item => item.label)];
  };
  it("reserves the filename before the ellipsis or any folder", () => {
    expect(shown(90)).toEqual(["connections.ts"]);
    expect(shown(116)).toEqual(["connections.ts"]);
    expect(shown(117)).toEqual(["…", "connections.ts"]);
  });
  it("adds the immediate parent before the path head, then fills the middle", () => {
    expect(shown(180)).toEqual(["…", "model", "connections.ts"]);
    expect(shown(217)).toEqual(["/", "repo", "…", "model", "connections.ts"]);
    expect(shown(240)).toEqual(parts.map(item => item.label));
  });
  it("does not let an oversized parent or UNC root displace the filename", () => {
    expect(shown(120, [
      { label: "//server/a-very-long-share", width: 300 },
      { label: "a-long-parent-directory", width: 250 },
      { label: "connections.ts", width: 90 },
    ])).toEqual(["…", "connections.ts"]);
  });
});
