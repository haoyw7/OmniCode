import { describe, expect, it } from "vitest";
import { layoutLeaves, type LayoutNode } from "./layout";
import { fitToolLayout } from "./fitToolLayout";

const columns: LayoutNode = {
  type: "split",
  id: "columns",
  dir: "right",
  children: ["chat", "files", "review"].map((id) => ({ type: "leaf", id })),
  sizes: [0.5, 0.25, 0.25],
};

describe("default right panel placement", () => {
  it("stacks right panels before they cover a conversation that still fits beside one column", () => {
    const result = fitToolLayout(columns, "chat", 900);
    const [chat, files, review] = layoutLeaves(result);
    expect(chat.rect).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
    expect(files.rect).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
    expect(review.rect).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    expect(layoutLeaves(result).map((pane) => pane.id)).toEqual([
      "chat",
      "files",
      "review",
    ]);
    expect(fitToolLayout(result, "chat", 900)).toBe(result);
  });

  it("keeps horizontal panels when all columns fit", () => {
    expect(fitToolLayout(columns, "chat", 1400)).toBe(columns);
  });

  it("retains the existing overlap fallback when even the stacked layout is narrow", () => {
    const stacked = fitToolLayout(columns, "chat", 500);
    const [chat, files, review] = layoutLeaves(stacked);
    expect(chat.rect.w * 500).toBeLessThan(420);
    expect(files.rect.x).toBe(review.rect.x);
    expect(files.rect.y).toBeLessThan(review.rect.y);
    expect(fitToolLayout(stacked, "chat", 400)).toBe(stacked);
  });

  it("does not change a lone tool or manually placed tools on the left", () => {
    const single: LayoutNode = {
      ...columns,
      children: columns.children.slice(0, 2),
      sizes: [0.5, 0.5],
    };
    expect(fitToolLayout(single, "chat", 500)).toBe(single);
    expect(fitToolLayout(columns, "files", 700)).toBe(columns);
    expect(fitToolLayout(columns, "chat", 0)).toBe(columns);
  });
});
