// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BotSettings } from "./BotSettings";
import type { HostModelCatalog } from "../../connections/model/protocol";
import { setUiLanguage } from "../../../shared/i18n/language";

let root: Root, node: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setUiLanguage("en");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});
const catalog: HostModelCatalog = {
  models: { codex: [{ id: "test", name: "Test", harness: "codex" }] },
  errors: {},
};
const render = (props: object) => {
  const save = vi.fn(async () => {});
  act(() =>
    root.render(
      createElement(BotSettings, {
        value: null,
        catalog,
        projects: [],
        busy: false,
        mobile: true,
        onSave: save,
        ...props,
      }),
    ),
  );
  return save;
};
const submit = () =>
  act(async () =>
    node.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(),
  );
const input = (label: string) =>
  [...node.querySelectorAll("label")]
    .find((item) => item.firstChild?.textContent === label)!
    .querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea")!;
function type(label: string, value: string) {
  act(() => {
    const field = input(label);
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(field),
      "value",
    )!.set!;
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("saves the chosen personality, how to address the user and the device time zone", async () => {
  const save = render({});
  act(() =>
    [...node.querySelectorAll<HTMLLabelElement>(".assistant-chip")]
      .find((chip) => chip.textContent === "Easygoing partner")!
      .querySelector("input")!
      .click(),
  );
  type("Personality and tone", "Speak Chinese");
  type("What should it call you?", " Wy ");
  await submit();
  expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      persona: { preset: "partner", style: "Speak Chinese", userName: "Wy" },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  );
});
it("requires a description for a custom personality", async () => {
  const save = render({});
  act(() =>
    [...node.querySelectorAll<HTMLLabelElement>(".assistant-chip")]
      .find((chip) => chip.textContent === "Custom")!
      .querySelector("input")!
      .click(),
  );
  await submit();
  expect(save).not.toHaveBeenCalled();
  expect(node.textContent).toContain("Describe the personality");
});
it("omits personality fields for Hosts that do not support them", async () => {
  const save = render({ personaSupported: false });
  expect(node.textContent).not.toContain("Personality");
  await submit();
  const patch = (save.mock.calls.at(-1) as unknown[])[0] as object;
  expect(patch).not.toHaveProperty("persona");
  expect(patch).not.toHaveProperty("timezone");
});
