// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { listDir, type FsEntry } from "../../../../platform/tauri/fs";
import { applyReducedMotion } from "../../../../shared/lib/reducedMotion";
import { FileBreadcrumb } from "./FileBreadcrumb";
import { saveExpanded, saveSelected } from "../model/fileTree";

vi.mock("../../../../platform/tauri/fs", async original => ({ ...await original<typeof import("../../../../platform/tauri/fs")>(), listDir: vi.fn() }));
vi.mock("../model/fileTree", () => ({
  listCachedDir: (path: string) => listDir(path),
  peekDir: () => null,
  subscribeDirsChanged: () => () => {},
  notifyDirsChanged: () => {},
  loadExpanded: () => new Set(),
  loadSelected: () => null,
  saveSelected: vi.fn(),
  saveExpanded: vi.fn(),
}));
vi.mock("./FileTypeIcon", () => ({ FileTypeIcon: () => null }));
let root: Root;
let container: HTMLDivElement;
const openFile = vi.fn();
const entry = (path: string, isDir = false): FsEntry => ({ path, name: path.split("/").at(-1)!, isDir, ignored: false });
const trigger = (name: string) => Array.from(container.querySelectorAll("button")).find(button => button.textContent === name)!;
const option = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')).find(button => button.textContent === name)!;
async function render(path = "/repo/src/a.ts") {
  await act(async () => root.render(createElement(FileBreadcrumb, { path, cwd: "/repo", onOpenFile: openFile })));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  applyReducedMotion("on");
  vi.mocked(listDir).mockReset();
  openFile.mockReset();
  vi.mocked(saveExpanded).mockClear();
  vi.mocked(saveSelected).mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("expands a folder alongside its siblings and opens a selected file", async () => {
  vi.mocked(listDir).mockImplementation(async path => path === "/repo/src" ? [entry("/repo/src/a.ts"), entry("/repo/src/sub", true)] : [entry("/repo/src/sub/b.ts")]);
  await render();
  await act(async () => trigger("src").click());
  expect(listDir).toHaveBeenLastCalledWith("/repo/src");
  expect(option("src").getAttribute("aria-selected")).toBe("true");
  expect(option("src").getAttribute("aria-level")).toBe("1");
  expect(option("a.ts").getAttribute("aria-level")).toBe("2");
  await act(async () => option("src").click());
  expect(option("src").getAttribute("aria-expanded")).toBe("false");
  expect(option("a.ts")).toBeUndefined();
  await act(async () => option("src").click());
  expect(option("a.ts")).toBeDefined();
  await act(async () => option("sub").click());
  expect(trigger("src").getAttribute("aria-expanded")).toBe("true");
  expect(listDir).toHaveBeenLastCalledWith("/repo/src/sub");
  expect(option("sub").getAttribute("aria-expanded")).toBe("true");
  expect(option("a.ts")).toBeDefined();
  expect(openFile).not.toHaveBeenCalled();
  expect(saveExpanded).not.toHaveBeenCalled();
  expect(saveSelected).not.toHaveBeenCalled();
  await act(async () => option("b.ts").dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true })));
  expect(document.querySelector("input")).toBeNull();
  await act(async () => option("b.ts").click());
  expect(openFile).toHaveBeenCalledWith("/repo/src/sub/b.ts");
  expect(trigger("src").getAttribute("aria-expanded")).toBe("false");
});
it("the filename lists siblings and can retry a failed directory read", async () => {
  vi.mocked(listDir).mockRejectedValueOnce(new Error("denied")).mockResolvedValueOnce([entry("/repo/src/a.ts")]);
  await render();
  await act(async () => trigger("a.ts").click());
  expect(listDir).toHaveBeenCalledWith("/repo/src");
  expect(document.body.textContent).toContain("denied");
  await act(async () => trigger("a.ts").click());
  await act(async () => trigger("a.ts").click());
  expect(option("a.ts")).toBeDefined();
});
it("does not show a late directory result after switching files", async () => {
  let resolve!: (entries: FsEntry[]) => void;
  vi.mocked(listDir).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await render();
  await act(async () => trigger("src").click());
  await render("/repo/other/c.ts");
  await act(async () => resolve([entry("/repo/src/stale.ts")]));
  expect(document.querySelector('[role="tree"]')).toBeNull();
  expect(container.textContent).toContain("c.ts");
});
it("starts at the project directory and opens that project as the tree root", async () => {
  vi.mocked(listDir).mockResolvedValue([entry("/repo/src", true)]);
  await render();
  expect(Array.from(container.querySelectorAll('nav button')).map(button => button.textContent)).toEqual(["repo", "src", "a.ts"]);
  await act(async () => trigger("repo").click());
  expect(listDir).toHaveBeenCalledWith("/repo");
  expect(listDir).not.toHaveBeenCalledWith("/");
  expect(option("repo").getAttribute("aria-level")).toBe("1");
  expect(option("src").getAttribute("aria-level")).toBe("2");
});
