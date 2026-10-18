// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Switch } from "./Switch";
import { Checkbox } from "./Checkbox";
import { Input } from "./Input";
import { Radio } from "./Radio";
import {
  startMotionClock,
  stopMotionClock,
} from "../../../../tests/helpers/sharedMotionClock";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  startMotionClock();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  stopMotionClock();
  vi.unstubAllGlobals();
});

it("keeps ordinary buttons from submitting forms and preserves explicit submit and asChild", () => {
  const submit = vi.fn((event: Event) => event.preventDefault());
  act(() =>
    root.render(
      createElement(
        "form",
        { onSubmit: submit },
        createElement(Button, null, "Ordinary"),
        createElement(Button, { type: "submit" }, "Submit"),
        createElement(
          Button,
          { asChild: true },
          createElement("a", { href: "#target" }, "Link"),
        ),
      ),
    ),
  );
  const buttons = host.querySelectorAll("button");
  act(() => buttons[0].click());
  expect(submit).not.toHaveBeenCalled();
  act(() => buttons[1].click());
  expect(submit).toHaveBeenCalledOnce();
  expect(host.querySelector("a")?.hasAttribute("type")).toBe(false);
});

it("supports uncontrolled and controlled switches without mutating a controlled value", () => {
  const changed = vi.fn();
  act(() =>
    root.render(
      createElement(Switch, { defaultChecked: true, onCheckedChange: changed }),
    ),
  );
  let toggle = host.querySelector<HTMLButtonElement>('[role="switch"]')!;
  act(() => toggle.click());
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(changed).toHaveBeenLastCalledWith(false);
  act(() =>
    root.render(
      createElement(Switch, { checked: true, onCheckedChange: changed }),
    ),
  );
  act(() => toggle.click());
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  changed.mockClear();
  act(() =>
    root.render(
      createElement(Switch, {
        checked: true,
        disabled: true,
        onCheckedChange: changed,
      }),
    ),
  );
  toggle = host.querySelector<HTMLButtonElement>('[role="switch"]')!;
  act(() => toggle.click());
  expect(changed).not.toHaveBeenCalled();
});

it("changes a mixed checkbox to checked and retains native field refs and form values", () => {
  const changed = vi.fn();
  const input = createRef<HTMLInputElement>();
  act(() =>
    root.render(
      createElement(
        "form",
        null,
        createElement(Checkbox, {
          defaultChecked: "indeterminate",
          onCheckedChange: changed,
        }),
        createElement(Input, {
          ref: input,
          name: "title",
          defaultValue: "Draft",
          htmlSize: 30,
        }),
        createElement(Radio, {
          name: "mode",
          value: "one",
          defaultChecked: true,
        }),
        createElement(Radio, { name: "mode", value: "two" }),
      ),
    ),
  );
  const checkbox = host.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
  expect(checkbox.getAttribute("aria-checked")).toBe("mixed");
  act(() => checkbox.click());
  expect(changed).toHaveBeenLastCalledWith(true);
  expect(input.current?.size).toBe(30);
  expect(new FormData(host.querySelector("form")!).get("title")).toBe("Draft");
  act(() =>
    host.querySelector<HTMLInputElement>('input[value="two"]')!.click(),
  );
  expect(new FormData(host.querySelector("form")!).get("mode")).toBe("two");
});

it("keeps unavailable toolbar actions focusable without activating them", () => {
  const onClick = vi.fn();
  const render = (disabled: boolean) => act(() => root.render(createElement(IconButton, {
    label: "Back", "aria-disabled": disabled, onClick, children: "←",
  })));
  render(true);
  const button = host.querySelector("button")!;
  button.focus();
  expect(document.activeElement).toBe(button);
  act(() => button.click());
  expect(onClick).not.toHaveBeenCalled();
  render(false);
  act(() => button.click());
  expect(onClick).toHaveBeenCalledOnce();
});
