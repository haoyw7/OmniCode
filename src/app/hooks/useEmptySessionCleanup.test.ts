// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../features/sessions/model/session";
import {
  leafIds,
  newTab,
  splitPane,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";
import { isDisposableEmptySession } from "../model/emptySessionCleanup";
import { useEmptySessionCleanup } from "./useEmptySessionCleanup";

let root: Root;
let container: HTMLDivElement;
const sessions = ["a", "b", "c"].map((id) => ({
  ...newSession("codex", "/repo"),
  id,
}));
const canDiscard = (id: string) =>
  isDisposableEmptySession(sessions.find((session) => session.id === id)!);
let rendered: WorkspaceTab[];

function Harness({
  initial,
  selected,
  enabled = true,
}: {
  initial: WorkspaceTab[];
  selected: string;
  enabled?: boolean;
}) {
  const [tabs, setTabs] = useState(initial);
  rendered = tabs;
  useEmptySessionCleanup({
    tabs,
    sessions,
    activeTabId: selected,
    enabled,
    canDiscard,
    setTabs,
  });
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

function draw(initial: WorkspaceTab[], selected: string, enabled = true) {
  act(() =>
    root.render(createElement(Harness, { initial, selected, enabled })),
  );
}

it("retains all restored blanks on startup and removes only visited blanks on successive navigation", () => {
  const tabs = ["a", "b", "c"].map(newTab);
  draw(tabs, tabs[0].id);
  expect(rendered).toHaveLength(3);
  draw(tabs, tabs[1].id);
  expect(rendered.map((tab) => tab.focusedId)).toEqual(["b", "c"]);
  draw(tabs, tabs[2].id);
  expect(rendered.map((tab) => tab.focusedId)).toEqual(["c"]);
});

it("keeps navigation context across tool pages without discarding the underlying blank", () => {
  const tabs = ["a", "b"].map(newTab);
  draw(tabs, tabs[0].id);
  draw(tabs, "assistant", false);
  expect(rendered).toHaveLength(2);
  draw(tabs, tabs[0].id);
  expect(rendered).toHaveLength(2);
  draw(tabs, tabs[1].id);
  expect(rendered.map((tab) => tab.focusedId)).toEqual(["b"]);
});

it("keeps all visible split panes until the entire workspace is left", () => {
  const split = newTab("a");
  split.layout = splitPane(split.layout, "a", "right", "b");
  const target = newTab("c");
  const tabs = [split, target];
  draw(tabs, split.id);
  draw(tabs, split.id);
  expect(leafIds(rendered[0].layout)).toEqual(["a", "b"]);
  draw(tabs, target.id);
  expect(rendered).toEqual([target]);
});
