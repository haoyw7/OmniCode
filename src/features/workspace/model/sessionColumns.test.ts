import { describe, expect, it } from "vitest";
import { newFileTab, newTab, openEditorTab, splitPane } from "./layout";
import { anchorSessionId, sessionLeafIds } from "./sessionColumns";

describe("session columns", () => {
  it("anchors on the focused chat and skips document cards", () => {
    const tab = newTab("a");
    const split = {
      ...tab,
      layout: splitPane(tab.layout, "a", "right", "b"),
      focusedId: "b",
    };
    expect(anchorSessionId(split)).toBe("b");
    const withFile = openEditorTab(split, newFileTab("/repo/a.ts", "/repo"));
    expect(sessionLeafIds(withFile)).toEqual(["a", "b"]);
    expect(anchorSessionId(withFile)).toBe("a");
  });
});
