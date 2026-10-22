// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  startMotionClock,
  stopMotionClock,
  finishMotion,
} from "../../../../tests/helpers/sharedMotionClock";
import { ActionMenu, type ActionMenuItem } from "./ActionMenu";

let root: Root;
let container: HTMLDivElement;
const onPick = vi.fn();
const items: ActionMenuItem[] = [
  { kind: "sep" },
  { kind: "item", id: "first", label: "First" },
  { kind: "sep" },
  { kind: "item", id: "last", label: "Last" },
  { kind: "sep" },
];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  startMotionClock();
  onPick.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  stopMotionClock();
  vi.unstubAllGlobals();
});

const render = (props: Partial<ComponentProps<typeof ActionMenu>> = {}) =>
  act(async () => {
    root.render(
      createElement(ActionMenu, {
        x: 10,
        y: 10,
        items,
        ariaLabel: "Actions",
        onPick,
        onClose: vi.fn(),
        ...props,
      } as ComponentProps<typeof ActionMenu>),
    );
  });
const menu = () =>
  document.querySelector<HTMLElement>('[role="menu"][aria-label="Actions"]')!;
const key = (value: string, target = menu()) =>
  act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
const highlighted = (target = menu()) =>
  target.querySelector<HTMLElement>('[data-highlighted="true"]');

it("starts without a highlight or active descendant and highlights a hovered item", async () => {
  await render();
  expect(highlighted()).toBeNull();
  expect(menu().hasAttribute("aria-activedescendant")).toBe(false);
  await key("Enter");
  expect(onPick).not.toHaveBeenCalled();
  const last =
    menu().querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[1];
  await act(async () =>
    last.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
  );
  expect(highlighted()).toBe(last);
  expect(menu().getAttribute("aria-activedescendant")).toBe(last.id);
  await key("Enter");
  expect(onPick).toHaveBeenCalledExactlyOnceWith("last");
});

it.each([
  ["ArrowDown", "First", "Last"],
  ["ArrowUp", "Last", "First"],
])(
  "starts %s at the correct edge, skips separators and wraps",
  async (arrow, first, next) => {
    await render();
    await key(arrow);
    expect(highlighted()?.textContent).toBe(first);
    await key(arrow);
    expect(highlighted()?.textContent).toBe(next);
    await key(arrow);
    expect(highlighted()?.textContent).toBe(first);
  },
);

it.each(["first", "last"] as const)(
  "honors an explicit %s highlight from a keyboard trigger",
  async (initialHighlight) => {
    await render({ initialHighlight });
    expect(highlighted()?.textContent).toBe(
      initialHighlight === "first" ? "First" : "Last",
    );
    await key("Enter");
    expect(onPick).toHaveBeenCalledExactlyOnceWith(initialHighlight);
  },
);

it("does not select an item in a submenu opened by the mouse", async () => {
  await render({
    items: [
      {
        kind: "item",
        id: "parent",
        label: "Parent",
        submenu: [
          { kind: "item", id: "child-first", label: "Child first" },
          { kind: "item", id: "child-last", label: "Child last" },
        ],
      },
    ],
  });
  await act(async () =>
    menu().querySelector<HTMLButtonElement>('[role="menuitem"]')!.click(),
  );
  const submenu = document.querySelector<HTMLElement>(
    '[role="menu"][aria-label="Parent"]',
  )!;
  expect(highlighted(submenu)).toBeNull();
  expect(submenu.hasAttribute("aria-activedescendant")).toBe(false);
  await key("ArrowUp", submenu);
  expect(highlighted(submenu)?.textContent).toBe("Child last");
  await key("Enter", submenu);
  expect(onPick).toHaveBeenCalledExactlyOnceWith("child-last");
});

it("clears the previous highlight when a controlled menu closes and reopens", async () => {
  await render({ open: true });
  await key("ArrowDown");
  await render({ open: false });
  await act(async () => finishMotion());
  await render({ open: true });
  expect(highlighted()).toBeNull();
  expect(menu().hasAttribute("aria-activedescendant")).toBe(false);
});

it("keeps an empty menu without an active descendant after arrow keys", async () => {
  await render({ items: [{ kind: "sep" }] });
  await key("ArrowUp");
  await key("ArrowDown");
  await key("Enter");
  expect(menu().hasAttribute("aria-activedescendant")).toBe(false);
  expect(onPick).not.toHaveBeenCalled();
});
