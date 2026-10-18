import { describe, expect, it } from "vitest";
import { paneDropFromDrag } from "./paneDrop";

const target = { id: "target", rect: { left: 0, top: 0, width: 100, height: 100 } };
const card = (x: number, y: number, width = 20, height = 20) => ({ x, y, width, height });

describe("paneDropFromDrag", () => {
  it("uses the card center when it is closer to a target edge", () => {
    expect(paneDropFromDrag([target], { x: 40, y: 30 }, card(95, 65), "source"))
      .toEqual({ id: "target", edge: "right" });
  });

  it("keeps the pointer when it is closer", () => {
    expect(paneDropFromDrag([target], { x: 50, y: 2 }, card(80, 65), "source"))
      .toEqual({ id: "target", edge: "top" });
  });

  it("uses the center while the pointer is outside the target", () => {
    expect(paneDropFromDrag([target], { x: -20, y: 25 }, card(10, 75), "source"))
      .toEqual({ id: "target", edge: "left" });
  });

  it("compares distances across different target panes and ignores the source", () => {
    const other = { id: "other", rect: { left: 100, top: 0, width: 100, height: 100 } };
    const source = { ...target, id: "source" };
    expect(paneDropFromDrag([source, target, other], { x: 40, y: 20 }, card(195, 60), "source"))
      .toEqual({ id: "other", edge: "right" });
    expect(paneDropFromDrag([source, other], { x: 0, y: 0 }, card(195, 60), "source"))
      .toEqual({ id: "other", edge: "right" });
  });

  it("compares pixels rather than percentages in a wide pane", () => {
    const wide = { id: "wide", rect: { left: 0, top: 0, width: 1000, height: 100 } };
    expect(paneDropFromDrag([wide], { x: 850, y: 70 }, card(500, 50), "source"))
      .toEqual({ id: "wide", edge: "bottom" });
  });

  it("prefers the pointer when both candidates are equally close", () => {
    expect(paneDropFromDrag([target], { x: 50, y: 5 }, card(95, 50), "source"))
      .toEqual({ id: "target", edge: "top" });
  });

  it("keeps an edge candidate as the center crosses it while the card overlaps", () => {
    for (const offset of [0, 5, 10, 15, 20]) {
      expect(paneDropFromDrag([target], { x: 50 + offset, y: 30 }, card(95 + offset, 50, 60, 40), "source"))
        .toEqual({ id: "target", edge: "right" });
    }
  });

  it("compares unsigned distances for a center beyond the target", () => {
    expect(paneDropFromDrag([target], { x: 50, y: 1 }, card(300, 50, 800, 40), "source"))
      .toEqual({ id: "target", edge: "top" });
  });

  it("clears a candidate after both the pointer and the whole card leave", () => {
    expect(paneDropFromDrag([target], { x: -100, y: 50 }, card(200, 50), "source")).toBeNull();
    expect(paneDropFromDrag([{ ...target, rect: { ...target.rect, width: 0 } }], { x: 0, y: 50 }, card(0, 50), "source")).toBeNull();
    expect(paneDropFromDrag([{ ...target, id: "source" }], { x: 50, y: 50 }, card(60, 60), "source")).toBeNull();
  });
});
