import { describe, expect, it } from "vitest";
import {
  clampDrawer,
  drawerIntent,
  settleDrawerOpen,
} from "./drawerGesture";

describe("drawer gesture", () => {
  it("waits for the slop radius before deciding", () => {
    expect(drawerIntent(4, 3, true)).toBe("undecided");
  });
  it("drags only in the direction that changes the drawer", () => {
    expect(drawerIntent(30, 5, true)).toBe("drag");
    expect(drawerIntent(-30, 5, true)).toBe("scroll");
    expect(drawerIntent(-30, 5, false)).toBe("drag");
    expect(drawerIntent(30, 5, false)).toBe("scroll");
  });
  it("leaves mostly vertical movement to scrolling", () => {
    expect(drawerIntent(20, 22, true)).toBe("scroll");
  });
  it("keeps the drawer within its travel", () => {
    expect(clampDrawer(40, 300)).toBe(0);
    expect(clampDrawer(-400, 300)).toBe(-300);
    expect(clampDrawer(-120, 300)).toBe(-120);
  });
  it("settles by flick direction first, then by distance", () => {
    expect(settleDrawerOpen(-280, 300, 0.8)).toBe(true);
    expect(settleDrawerOpen(-20, 300, -0.8)).toBe(false);
    expect(settleDrawerOpen(-100, 300, 0)).toBe(true);
    expect(settleDrawerOpen(-200, 300, 0.1)).toBe(false);
  });
});
