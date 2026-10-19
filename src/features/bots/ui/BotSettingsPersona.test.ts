// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BotSettings } from "./BotSettings";
import type { HostModelCatalog } from "../../connections/model/protocol";
import { setUiLanguage } from "../../../shared/i18n/language";
import { SurfaceVisibilityContext } from "../../../shared/ui/SurfaceVisibility";

let root: Root, node: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })));
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
  [...(document.querySelector('[role="dialog"]') ?? node).querySelectorAll("label")]
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

const dialogButton = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === text)!;
const openPermissions = async () => {
  await act(async () => node.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click());
};

it("omits the inspector personality card and cancels permission edits without losing an earlier model change", async () => {
  const save = render({ mobile: false, presentation: "inspector", catalog: {
    models: { codex: [{ id: "test", name: "Test", harness: "codex" }, { id: "other", name: "Other", harness: "codex" }] }, errors: {},
  } });
  await act(async () => node.querySelector<HTMLButtonElement>('button[aria-label="Model: Test"]')!.click());
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(option => option.textContent === "Other")!.click());
  expect(node.textContent).not.toContain("Personality and tone");
  expect(node.querySelector('[data-section="identity"]')).toBeNull();
  await openPermissions();
  act(() => document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!.click());
  await act(async () => dialogButton("Cancel").click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(node.querySelector('button[aria-haspopup="dialog"]'));
  await submit();
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ model: "other", persona: expect.objectContaining({ style: "" }) }));
});

it("applies a permission dialog draft without submitting the surrounding settings form", async () => {
  const save = render({ mobile: false, presentation: "inspector" });
  await openPermissions();
  act(() => document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!.click());
  await act(async () => dialogButton("Apply").click());
  expect(save).not.toHaveBeenCalled();
  await openPermissions();
  expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!.checked).toBe(false);
  await act(async () => dialogButton("Cancel").click());
  await submit();
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ policy: expect.objectContaining({ permissions: expect.objectContaining({ "catalog.read": false }) }) }));
});

it("discards an open dialog when its retained settings surface is hidden", async () => {
  const props = { value: null, catalog, projects: [], busy: false, presentation: "inspector" as const, onSave: vi.fn(async () => {}) };
  const show = async (visible: boolean) => act(async () => root.render(createElement(SurfaceVisibilityContext.Provider, { value: visible }, createElement(BotSettings, props))));
  await show(true); await openPermissions();
  act(() => document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!.click());
  await show(false);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await show(true);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await openPermissions();
  expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!.checked).toBe(true);
});
