import { expect, it } from "vitest";
import { parseWslPath, wslPath } from "./wslPaths";

it("round trips distribution names and case-sensitive Linux paths", () => {
  const path = wslPath("Ubuntu Work", "/home/Dev/a#b\\c");
  expect(path).toBe("wsl://Ubuntu%20Work/home/Dev/a#b\\c");
  expect(parseWslPath(path)).toEqual({ machine: { kind: "wsl", distribution: "Ubuntu Work" }, hostPath: "/home/Dev/a#b\\c" });
  expect(parseWslPath("wsl://Ubuntu")).toMatchObject({ hostPath: "/" });
});

it("does not interpret malformed WSL identities as local paths", () => {
  expect(parseWslPath("wsl://bad%2Fname/home")).toBeUndefined();
  expect(parseWslPath("wsl://%broken/home")).toBeUndefined();
  expect(() => wslPath("Ubuntu", "C:/work")).toThrow("Invalid WSL");
});
