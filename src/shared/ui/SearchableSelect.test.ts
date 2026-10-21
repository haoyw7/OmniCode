// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LAYER } from "../lib/layers";
import { SearchableSelect } from "./SearchableSelect";

let root: Root;
let container: HTMLDivElement;

it("virtualizes a large menu and navigates to unmounted options", async () => {
  const onChange = vi.fn();
  const options = Array.from({ length: 1000 }, (_, index) => ({ value: String(index), label: `Option ${index}`, disabled: index === 999 }));
  await act(async () => root.render(createElement(SearchableSelect, { label: "Large menu", value: "0", options, onChange })));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  const input = document.body.querySelector<HTMLInputElement>("[cmdk-input]")!;
  expect(document.body.querySelectorAll("[cmdk-item]").length).toBeLessThan(60);
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true })));
  const selected = document.body.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]');
  expect(selected?.textContent).toContain("Option 998");
  expect(input.getAttribute("aria-activedescendant")).toBe(selected?.id);
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  expect(onChange).toHaveBeenCalledWith("998");
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body
    .querySelectorAll("[data-dialog-popover]")
    .forEach((element) => element.parentElement?.remove());
  vi.unstubAllGlobals();
});

it("raises menus above a containing modal by default", async () => {
  await act(async () => {
    root.render(
      createElement(
        "div",
        { role: "dialog" },
        createElement(SearchableSelect, {
          label: "Agent",
          value: "codex",
          options: [
            { value: "codex", label: "Codex" },
            { value: "claude", label: "Claude" },
          ],
          onChange: vi.fn(),
        }),
      ),
    );
  });

  const trigger = container.querySelector<HTMLButtonElement>("button")!;
  await act(async () => trigger.click());

  const menu = document.body.querySelector<HTMLElement>(
    '[aria-label="Agent options"]',
  );
  expect(menu).not.toBeNull();
  expect(menu!.parentElement!.style.zIndex).toBe(String(LAYER.dialogPopover));
});

it("does not scroll the page when a compact menu opens", async () => {
  const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
  await act(async () => {
    root.render(
      createElement(SearchableSelect, {
        label: "Timeout",
        value: "60",
        variant: "pill",
        searchable: false,
        options: [
          { value: "30", label: "30 sec" },
          { value: "60", label: "1 min" },
          { value: "120", label: "2 min" },
          { value: "300", label: "5 min" },
        ],
        onChange: vi.fn(),
      }),
    );
  });

  const trigger = container.querySelector<HTMLButtonElement>("button")!;
  await act(async () => trigger.click());
  await act(async () => {
    await Promise.resolve();
  });

  expect(scrollIntoView).not.toHaveBeenCalled();
  const option = document.body.querySelector('[role="option"]');
  expect(option?.className).toContain("h-7");
});

it("keeps loaded selection, icon, and Tab commit behavior in a non-searchable menu", async () => {
  const onOpen = vi.fn();
  const onChange = vi.fn();
  const render = (loaded: boolean) => act(async () => root.render(createElement(SearchableSelect, {
    label: "Font", value: "b", searchable: false, commitOnTab: true,
    checkPosition: "end", onOpen, onChange,
    options: loaded ? [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta", icon: createElement("span", null, "B") },
      { value: "c", label: "Gamma" },
    ] : [],
  })));
  await render(false);
  const trigger = container.querySelector("button")!;
  await act(async () => trigger.click());
  expect(onOpen).toHaveBeenCalledOnce();
  await render(true);
  const list = document.body.querySelector<HTMLElement>('[role="listbox"]')!;
  const selected = list.querySelector('[aria-selected="true"]')!;
  expect(list.getAttribute("aria-activedescendant")).toBe(selected.id);
  expect(trigger.textContent).toContain("Beta");
  await act(async () => list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  await act(async () => list.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
  expect(onChange).toHaveBeenLastCalledWith("c");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
});

it("filters grouped options and prevents keyboard activation of disabled choices", async () => {
  const onChange = vi.fn();
  await act(async () => root.render(createElement(SearchableSelect, {
    label: "Environment", value: "local", onChange, commitOnTab: true,
    options: [
      { value: "local", label: "This machine", group: "Local" },
      { value: "cloud", label: "Cloud", disabled: true, separatorBefore: true },
      { value: "remote", label: "Remote Control" },
    ],
  })));
  const trigger = container.querySelector("button")!;
  await act(async () => trigger.click());
  const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
  const inputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    inputValue.call(input, "Cloud");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(document.querySelector('[data-ui="select-group-label"]')).toBeNull();
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(onChange).not.toHaveBeenCalled();
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
  expect(onChange).not.toHaveBeenCalled();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});
