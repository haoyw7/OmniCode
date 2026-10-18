import { layoutLeaves, type LayoutNode, type LayoutSash } from "./layout";

export type PaneMinimumWidth = (id: string) => number;

/** Most conversations crossed by one horizontal line through the layout. */
function chatColumns(node: LayoutNode, chats: ReadonlySet<string>): number {
  if (node.type === "leaf") return chats.has(node.id) ? 1 : 0;
  const counts = node.children.map((child) => chatColumns(child, chats));
  return node.dir === "right"
    ? counts.reduce((sum, count) => sum + count, 0)
    : Math.max(0, ...counts);
}

/**
 * Tools may cover a conversation, but conversations never cover each other.
 * A lone chat paints at its full minimum even when its track gives way to
 * tools. Side-by-side chats that cannot all keep that minimum fall back to a
 * compact one, or share the row evenly, so their dividers still move.
 */
export function paneMinimumWidths(
  layout: LayoutNode,
  chats: ReadonlySet<string>,
  width: number,
  sizes: { chat: number; compactChat: number; tool: number },
): PaneMinimumWidth {
  if (chats.size <= 1) return (id) => (chats.has(id) ? 0 : sizes.tool);
  const columns = Math.max(1, chatColumns(layout, chats));
  const chat =
    width <= 0 || columns * sizes.chat <= width
      ? sizes.chat
      : Math.min(sizes.compactChat, width / columns);
  return (id) => (chats.has(id) ? chat : sizes.tool);
}

/** Width needed by a subtree while keeping its internal split ratios. */
function requiredWidth(node: LayoutNode, minimum: PaneMinimumWidth): number {
  return Math.max(
    ...layoutLeaves(node).map(({ id, rect }) => minimum(id) / rect.w),
  );
}

/** Cache these bounds at pointer-down; the move path only clamps a number. */
export function paneWidthBounds(
  layout: LayoutNode,
  sash: LayoutSash,
  width: number,
  minimum: PaneMinimumWidth,
): { min: number; max: number } | undefined {
  if (sash.dir !== "right" || width <= 0) return;
  const find = (
    node: LayoutNode,
  ): Extract<LayoutNode, { type: "split" }> | undefined => {
    if (node.type === "leaf") return;
    if (node.id === sash.splitId) return node;
    for (const child of node.children) {
      const found = find(child);
      if (found) return found;
    }
  };
  const split = find(layout);
  if (!split) return;
  const before = sash.sizes
    .slice(0, sash.index)
    .reduce((sum, size) => sum + size, 0);
  const pair = sash.sizes[sash.index] + sash.sizes[sash.index + 1];
  const span = width * sash.group.w;
  // Retain the model's 8% floor as well as each descendant's pixel minimum.
  const floor = Math.min(0.08, pair / 2);
  const first = Math.max(
    floor,
    requiredWidth(split.children[sash.index], minimum) / span,
  );
  const second = Math.max(
    floor,
    requiredWidth(split.children[sash.index + 1], minimum) / span,
  );
  if (first + second > pair) {
    // When the window cannot fit both sides, keep the divider at its current
    // position. The presentation's capped minimum widths supply the overlap.
    const boundary = before + sash.sizes[sash.index];
    return { min: boundary, max: boundary };
  }
  return { min: before + first, max: before + pair - second };
}

/** Repair restored/new layouts on available-width changes without reordering panes. */
export function fitPaneWidths(
  node: LayoutNode,
  width: number,
  minimum: PaneMinimumWidth,
): LayoutNode {
  if (node.type === "leaf" || width <= 0) return node;
  const minimumWidth = (child: LayoutNode): number => {
    if (child.type === "leaf") return minimum(child.id);
    const widths = child.children.map(minimumWidth);
    return child.dir === "right"
      ? widths.reduce((sum, value) => sum + value, 0)
      : Math.max(...widths);
  };
  let sizes = node.sizes;
  if (node.dir === "right") {
    const floors = node.children.map((child) => minimumWidth(child) / width);
    if (
      floors.reduce((sum, value) => sum + value, 0) <= 1 &&
      floors.some((floor, index) => sizes[index] < floor - 1e-7)
    ) {
      const deficits = floors.reduce(
        (sum, floor, index) => sum + Math.max(0, floor - sizes[index]),
        0,
      );
      const surplus = floors.reduce(
        (sum, floor, index) => sum + Math.max(0, sizes[index] - floor),
        0,
      );
      sizes = sizes.map((size, index) =>
        size < floors[index]
          ? floors[index]
          : size - ((size - floors[index]) * deficits) / surplus,
      );
    }
  }
  const children = node.children.map((child, index) =>
    fitPaneWidths(
      child,
      node.dir === "right" ? width * sizes[index] : width,
      minimum,
    ),
  );
  return sizes === node.sizes &&
    children.every((child, index) => child === node.children[index])
    ? node
    : { ...node, sizes, children };
}
