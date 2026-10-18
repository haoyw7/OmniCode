import type { CSSProperties } from "react";
import type { LayoutLeaf } from "../model/layout";

/** Stable tracks preserve a split tree's geometry while a selected pane grows. */
export function sessionSurfaceGrid(leaves: LayoutLeaf[], selectedId?: string) {
  const boundaries = (axis: "x" | "y", extent: "w" | "h") =>
    [
      ...new Set(
        leaves
          .flatMap(({ rect }) => [rect[axis], rect[axis] + rect[extent]])
          .map((value) => Math.round(value * 1e8) / 1e8),
      ),
    ].sort((a, b) => a - b);
  const columns = boundaries("x", "w");
  const rows = boundaries("y", "h");
  const line = (bounds: number[], position: number) =>
    bounds.findIndex((bound) => Math.abs(bound - position) < 1e-7);
  const selected = leaves.find((leaf) => leaf.id === selectedId);
  const tracks = (bounds: number[], axis: "x" | "y", extent: "w" | "h") => {
    const sizes = bounds.slice(0, -1).map((start, index) => {
      const end = bounds[index + 1];
      const within =
        !selected ||
        (start >= selected.rect[axis] - 1e-7 &&
          end <= selected.rect[axis] + selected.rect[extent] + 1e-7);
      return within ? Math.round((end - start) * 1e8) / 1e8 : 0;
    });
    // Flex factors below one leave unused space in CSS Grid. The selected
    // rectangle's surviving tracks must consume the entire workspace.
    const total = selected ? sizes.reduce((sum, size) => sum + size, 0) : 1;
    return sizes.map((size) => `minmax(0, ${size / total}fr)`).join(" ");
  };
  const style: CSSProperties = {
    gridTemplateColumns: tracks(columns, "x", "w"),
    gridTemplateRows: tracks(rows, "y", "h"),
  };
  const placements = new Map(
    leaves.map(({ id, rect }) => [
      id,
      {
        gridColumn: `${line(columns, rect.x) + 1} / ${line(columns, rect.x + rect.w) + 1}`,
        gridRow: `${line(rows, rect.y) + 1} / ${line(rows, rect.y + rect.h) + 1}`,
      } satisfies CSSProperties,
    ]),
  );
  return { style, placements };
}
