import { describe, expect, it } from "vitest";
import { shellOutputDiffLines } from "./shellOutputDiff";

describe("shellOutputDiffLines", () => {
  it("tints a unified diff", () => {
    expect(
      shellOutputDiffLines("diff --git a/x b/x\n@@ -1 +1 @@\n-old\n+new\n same"),
    ).toEqual(["hunk", "hunk", "del", "add", "plain"]);
  });

  it("tints grep over a diff without headers", () => {
    expect(
      shellOutputDiffLines("-  flex: 0 0 16px;\n-  flex: 0 0 22px;\n-  flex: 0 0 24px;\n23"),
    ).toEqual(["del", "del", "del", "plain"]);
  });

  it("leaves bullet lists and ordinary output alone", () => {
    expect(shellOutputDiffLines("- first item\n- second item\n- third")).toBeUndefined();
    expect(shellOutputDiffLines("On branch main\nnothing to commit")).toBeUndefined();
    expect(
      shellOutputDiffLines("usage: tool\n-h help\nlots\nof\nother\nlines\nhere"),
    ).toBeUndefined();
  });
});
