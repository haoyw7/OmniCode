// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryClient } from "../../../shared/lib/queryClient";
import { SurfaceVisibilityContext } from "../../../shared/ui/SurfaceVisibility";
import { projectSessionCount } from "../model/projectData";
import { RemoveProjectDialog } from "./RemoveProjectDialog";

vi.mock("../model/projectData", () => ({ projectSessionCount: vi.fn() }));
let root: Root;
beforeEach(() => { queryClient.clear(); vi.mocked(projectSessionCount).mockReset(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); root = createRoot(document.createElement("div")); });
afterEach(() => { act(() => root.unmount()); queryClient.clear(); vi.unstubAllGlobals(); });
const render = (path: string, visible = true) => act(async () => root.render(createElement(SurfaceVisibilityContext.Provider, { value: visible }, createElement(RemoveProjectDialog, { name: path, path, onCancel: vi.fn(), onConfirm: vi.fn() }))));

it("does not show a previous project's late conversation count", async () => {
  let finish!: (count: number) => void;
  vi.mocked(projectSessionCount).mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(2);
  await render("/old");
  await render("/new");
  await act(async () => finish(99));
  expect(document.body.textContent).toContain("2 saved conversations will be removed.");
  expect(document.body.textContent).not.toContain("99 saved");
});

it("defers the count while hidden", async () => {
  vi.mocked(projectSessionCount).mockResolvedValue(1);
  await render("/repo", false);
  expect(projectSessionCount).not.toHaveBeenCalled();
  await render("/repo");
  expect(document.body.textContent).toContain("1 saved conversation will be removed.");
});
