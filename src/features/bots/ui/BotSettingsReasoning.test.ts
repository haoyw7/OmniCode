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
function select(label: string) {
  return [...node.querySelectorAll("label")].find((item) => item.firstChild?.textContent === label)!.querySelector("select")!;
}
function change(label: string, value: string) {
  act(() => {
    const field = select(label);
    field.value = value;
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
it.each(["pi", "omp", "codex"] as const)("saves %s reasoning and resets unsupported choices on model change", async (harness) => {
  const settingId = harness === "codex" ? "reasoningEffort" : "thinking";
  const catalog: HostModelCatalog = { models: { [harness]: [
    { id: "full", name: "Full", harness, settings: [{
      id: settingId, label: "Reasoning", kind: "select", value: "high",
      options: [{ value: "low", label: "Low" }, { value: "high", label: "High" }],
    }] },
    { id: "limited", name: "Limited", harness, settings: [{
      id: settingId, label: "Reasoning", kind: "select", value: "low",
      options: [{ value: "low", label: "Low" }],
    }] },
    { id: "plain", name: "Plain", harness },
  ] }, errors: {} };
  const save = vi.fn(async () => {});
  act(() => root.render(createElement(BotSettings, {
    value: null, catalog, projects: [], busy: false, mobile: true, onSave: save,
  })));
  expect(select("Reasoning effort").value).toBe("high");
  change("Reasoning effort", "low");
  await act(async () => node.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ modelSettings: { [settingId]: "low" } }));
  change("Reasoning effort", "high");
  change("Model", "limited");
  expect(select("Reasoning effort").value).toBe("low");
  change("Model", "plain");
  expect(select("Reasoning effort").disabled).toBe(true);
  await act(async () => node.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ model: "plain", modelSettings: {} }));
});
