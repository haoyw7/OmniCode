import { expect, it } from "vitest";
import { wslFolderPath } from "./wsl";

it.each([
  ["\\\\wsl.localhost\\Ubuntu\\home\\Dev\\项目 A", "/home/Dev/项目 A"],
  ["\\\\WSL$\\ubuntu\\home\\dev\\", "/home/dev"],
  ["//wsl.localhost/Ubuntu/", "/"],
  ["\\\\wsl$\\Ubuntu", "/"],
])("converts WSL UNC path %s to its Linux path", (path, expected) => {
  expect(wslFolderPath(path, "Ubuntu")).toBe(expected);
});

it.each(["C:\\Projects", "\\\\wsl$\\Debian\\home", "\\\\server\\Ubuntu\\home", "/home/dev"])(
  "rejects a path outside the selected distribution: %s", (path) => {
    expect(() => wslFolderPath(path, "Ubuntu")).toThrow("Choose a folder inside the selected WSL distribution.");
  },
);
