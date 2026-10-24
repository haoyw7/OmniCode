import { describe, expect, it } from "vitest";
import { workspacePathIsInside, workspacePathKey } from "./workspacePaths";

describe("execution workspace identity", () => {
  it("compares Windows drive and UNC paths consistently for every client", () => {
    expect(workspacePathKey("C:\\Code\\Project\\")).toBe(
      workspacePathKey("c:/code/project"),
    );
    expect(
      workspacePathIsInside(
        "\\\\Server\\Share\\Project\\src",
        "//server/share/project",
      ),
    ).toBe(true);
  });

  it("retains POSIX case and literal backslashes and checks path boundaries", () => {
    expect(workspacePathKey("/code/Project")).not.toBe(
      workspacePathKey("/code/project"),
    );
    expect(workspacePathKey("/code/a\\b")).toBe("/code/a\\b");
    expect(workspacePathIsInside("/code/project2", "/code/project")).toBe(
      false,
    );
    expect(workspacePathIsInside("/code/project/src", "/code/project/")).toBe(
      true,
    );
  });
});
