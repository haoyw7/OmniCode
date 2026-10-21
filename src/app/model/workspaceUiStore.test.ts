import { expect, it, vi } from "vitest";
import { createWorkspaceUiStore } from "./workspaceUiStore";

it("isolates window overlays and applies functional updates against the latest slice", () => {
  const first = createWorkspaceUiStore();
  const second = createWorkspaceUiStore();
  const actions = first.getState();
  actions.setPaletteOpen(true);
  actions.setPaletteQuery("files");
  actions.setPaletteToken(token => token + 1);
  actions.setPaletteToken(token => token + 1);
  actions.setNavigationExpanded(value => !value);
  actions.setFilesSearchOpen(true);
  expect(first.getState()).toMatchObject({ paletteOpen: true, paletteQuery: "files", paletteToken: 2,
    navigationExpanded: true, filesSearchOpen: true });
  expect(second.getState()).toMatchObject({ paletteOpen: false, paletteQuery: "", paletteToken: 0,
    navigationExpanded: false, filesSearchOpen: false });
  expect(first.getState().setPaletteOpen).toBe(actions.setPaletteOpen);
  const changed = vi.fn();
  const stop = first.subscribe(changed);
  actions.setPaletteOpen(true);
  actions.setFilesSearchOpen(true);
  actions.setPaletteToken(value => value);
  expect(changed).not.toHaveBeenCalled();
  stop();
});
