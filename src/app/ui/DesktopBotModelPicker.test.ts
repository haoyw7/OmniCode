// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BotSettings } from "../../features/bots/ui/BotSettings";
import { BotModelPickerContext } from "../../features/bots/ui/BotChatChrome";
import type { HostModelCatalog } from "../../contracts/protocol";
import type { RemoteProvider } from "../../contracts/provider";
import { setUiLanguage } from "../../shared/i18n/language";
import { DesktopBotModelPicker } from "./DesktopBotModelPicker";

let root: Root, node: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })));
  localStorage.clear();
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

function render(catalog: HostModelCatalog, extra: object = {}) {
  const save = vi.fn(async () => {});
  act(() => root.render(createElement(BotModelPickerContext.Provider, { value: DesktopBotModelPicker },
    createElement(BotSettings, { value: null, catalog, projects: [], busy: false, presentation: "inspector", onSave: save, ...extra }))));
  return save;
}
const click = async (element: HTMLElement) => act(async () => element.click());
const menuRow = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent?.startsWith(label))!;

it.each(["pi", "omp", "codex"] as const)("saves %s reasoning through the shared model menu using the Host's setting ID", async harness => {
  const id = harness === "codex" ? "reasoningEffort" : "thinking";
  const save = render({ models: { [harness]: [{ id: `${harness}:host-only`, name: "Host only", harness, settings: [{
    id, label: "Reasoning", kind: "select", value: "high",
    options: [{ value: "low", label: "Low" }, { value: "high", label: "High" }],
  }] }] }, errors: {} });
  expect(node.querySelectorAll('[data-model-picker-trigger]')).toHaveLength(1);
  expect(node.querySelector('[data-desktop-select-trigger]')).toBeNull();
  await click(node.querySelector<HTMLButtonElement>('[data-model-picker-trigger]')!);
  await click(menuRow("Reasoning"));
  await click([...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(button => button.textContent === "Low")!);
  expect(node.querySelector('[data-model-picker-trigger]')?.textContent).toContain("Low");
  await click(node.querySelector<HTMLButtonElement>('button[type="submit"]')!);
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ harness, model: `${harness}:host-only`, modelSettings: { [id]: "low" } }));
});

it("selects only from the assistant Host catalog and resets settings unsupported by the new model", async () => {
  const harness: RemoteProvider = "codex";
  const save = render({ models: { codex: [
    { id: "codex:host-first", name: "Host first", harness, settings: [{ id: "reasoningEffort", label: "Reasoning", kind: "select", value: "high", options: [{ value: "high", label: "High" }] }] },
    { id: "codex:host-second", name: "Host second", harness, settings: [{ id: "reasoningEffort", label: "Reasoning", kind: "select", value: "low", options: [{ value: "low", label: "Low" }] }] },
  ] }, errors: {} });
  await click(node.querySelector<HTMLButtonElement>('[data-model-picker-trigger]')!);
  await click(menuRow("Model"));
  const options = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  expect(options).toHaveLength(2);
  expect(options.every(button => button.textContent?.includes("Host"))).toBe(true);
  await click(options.find(button => button.textContent?.includes("Host second"))!);
  await click(node.querySelector<HTMLButtonElement>('button[type="submit"]')!);
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ model: "codex:host-second", modelSettings: { reasoningEffort: "low" } }));
});

it("closes and disables the shared picker while saving, then leaves it closed when editing resumes", async () => {
  const catalog: HostModelCatalog = { models: { codex: [{ id: "codex:host", name: "Host", harness: "codex" }] }, errors: {} };
  render(catalog);
  await click(node.querySelector<HTMLButtonElement>('[data-model-picker-trigger]')!);
  expect(document.querySelector('[data-model-picker]')).not.toBeNull();
  render(catalog, { busy: true });
  expect(node.querySelector('[data-model-picker-trigger]')?.matches(':disabled')).toBe(true);
  expect(document.querySelector('[data-model-picker]')).toBeNull();
  render(catalog);
  expect(node.querySelector('[data-model-picker-trigger]')?.matches(':disabled')).toBe(false);
  expect(document.querySelector('[data-model-picker]')).toBeNull();
});

it("keeps a saved unlisted model and its reasoning editable when the Host catalog fails", async () => {
  const save = render({ models: {}, errors: {} }, { catalogState: "failed", value: {
    name: "Saved assistant", harness: "codex", model: "codex:unlisted", modelSettings: { reasoningEffort: "xhigh" }, schedules: [], watches: [],
  } });
  const trigger = node.querySelector<HTMLButtonElement>('[data-model-picker-trigger]')!;
  expect(trigger.disabled).toBe(false);
  expect(trigger.textContent).toContain("codex:unlisted");
  await click(trigger);
  await click(menuRow("Reasoning"));
  await click([...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(button => button.textContent === "Low")!);
  await click(node.querySelector<HTMLButtonElement>('button[type="submit"]')!);
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ model: "codex:unlisted", modelSettings: { reasoningEffort: "low" } }));
});
