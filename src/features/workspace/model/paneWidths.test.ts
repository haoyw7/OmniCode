import { describe, expect, it } from "vitest";
import { layoutLeaves, layoutSashes, type LayoutNode } from "./layout";
import { fitPaneWidths, paneMinimumWidths, paneWidthBounds } from "./paneWidths";

const minimum = (id: string) => (id.startsWith("chat") ? 420 : 280);
const columns = (
  ids: string[],
  sizes = ids.map(() => 1 / ids.length),
): LayoutNode => ({
  type: "split",
  id: "columns",
  dir: "right",
  sizes,
  children: ids.map((id) => ({ type: "leaf", id })),
});

describe("workspace pane widths", () => {
  it.each([
    ["chat", "files", 0.42, 0.72],
    ["terminal", "review", 0.28, 0.72],
    ["chat-a", "chat-b", 0.42, 0.58],
  ] as const)("limits %s / %s by pixels", (first, second, min, max) => {
    const tree = columns([first, second]);
    const bounds = paneWidthBounds(tree, layoutSashes(tree)[0], 1000, minimum)!;
    expect(bounds.min).toBeCloseTo(min);
    expect(bounds.max).toBeCloseTo(max);
  });

  it("accounts for nested column ratios and the nested group's available width", () => {
    const tree = columns(["chat", "placeholder"]);
    if (tree.type !== "split") throw new Error("Expected split");
    tree.children[1] = {
      ...columns(["files", "terminal"], [0.4, 0.6]),
      id: "nested",
    } as LayoutNode;
    const sashes = layoutSashes(tree);
    expect(paneWidthBounds(tree, sashes[0], 1600, minimum)).toEqual({
      min: 420 / 1600,
      max: 1 - 700 / 1600,
    });
    expect(paneWidthBounds(tree, sashes[1], 1600, minimum)).toEqual({
      min: 0.35,
      max: 0.65,
    });
  });

  it("does not add the widths of vertically stacked tools", () => {
    const tree = columns(["chat", "placeholder"]);
    if (tree.type !== "split") throw new Error("Expected split");
    tree.children[1] = {
      ...columns(["files", "review"]),
      id: "stack",
      dir: "down",
    } as LayoutNode;
    expect(paneWidthBounds(tree, layoutSashes(tree)[0], 1000, minimum)).toEqual(
      { min: 0.42, max: 0.72 },
    );
    expect(
      paneWidthBounds(tree, layoutSashes(tree)[1], 1000, minimum),
    ).toBeUndefined();
  });

  it("keeps an undersized pair stable for the overlap fallback", () => {
    const tree = columns(["chat", "files"], [0.6, 0.4]);
    expect(paneWidthBounds(tree, layoutSashes(tree)[0], 500, minimum)).toEqual({
      min: 0.6,
      max: 0.6,
    });
    expect(fitPaneWidths(tree, 500, minimum)).toBe(tree);
  });

  it("repairs saved small ratios and leaves sufficient layouts untouched", () => {
    const tree = columns(["chat", "files", "terminal"], [0.8, 0.1, 0.1]);
    const result = fitPaneWidths(tree, 1200, minimum);
    const leaves = layoutLeaves(result);
    expect(leaves.map((pane) => pane.id)).toEqual([
      "chat",
      "files",
      "terminal",
    ]);
    expect(leaves.map((pane) => Math.round(pane.rect.w * 1200))).toEqual([
      640, 280, 280,
    ]);
    expect(fitPaneWidths(result, 1200, minimum)).toBe(result);
  });

  it("lets side-by-side chats that cannot all fit share the row with movable dividers", () => {
    const sizes = { chat: 420, compactChat: 240, tool: 280 };
    const tree = columns(["chat-a", "chat-b", "chat-c", "chat-d"]);
    const chats = new Set(["chat-a", "chat-b", "chat-c", "chat-d"]);
    const roomy = paneMinimumWidths(tree, chats, 2000, sizes);
    expect(roomy("chat-a")).toBe(420);
    const narrow = paneMinimumWidths(tree, chats, 1200, sizes);
    expect(narrow("chat-a")).toBe(240);
    expect(narrow("files")).toBe(280);
    const bounds = paneWidthBounds(tree, layoutSashes(tree)[0], 1200, narrow)!;
    expect(bounds.min).toBeLessThan(bounds.max);
    expect(paneMinimumWidths(tree, chats, 800, sizes)("chat-a")).toBe(200);
    // A lone chat yields its track to tools and keeps its painted minimum.
    expect(paneMinimumWidths(tree, new Set(["chat-a"]), 800, sizes)("chat-a")).toBe(0);
  });

  it("fits descendant widths when resizing the containing split", () => {
    const tree = columns(["chat", "placeholder"], [0.7, 0.3]);
    if (tree.type !== "split") throw new Error("Expected split");
    tree.children[1] = {
      ...columns(["files", "terminal"], [0.2, 0.8]),
      id: "nested",
    } as LayoutNode;
    const leaves = layoutLeaves(fitPaneWidths(tree, 1200, minimum));
    for (const leaf of leaves)
      expect(leaf.rect.w * 1200).toBeGreaterThanOrEqual(
        minimum(leaf.id) - 1e-6,
      );
  });
});
