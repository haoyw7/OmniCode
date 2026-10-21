// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SavedWorkflowLaunchDialog } from "./SavedWorkflowLaunchDialog";
import type { OmniCodeSavedWorkflowEntry } from "../../_shims/shared";

let root: Root;
let node: HTMLDivElement;
const onSubmit = vi.fn();
const entry: OmniCodeSavedWorkflowEntry = {
  name: "review", description: "Review changes", scope: "project", path: "/review.ts",
  args: {
    title: { type: "string", required: true },
    limit: { type: "number", default: 3 },
    payload: { type: "json", required: true },
    enabled: { type: "boolean" },
  },
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onSubmit.mockReset();
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount()); node.remove(); vi.unstubAllGlobals();
});
const render = (value = entry, pending = false) => act(async () => root.render(createElement(SavedWorkflowLaunchDialog, {
  entry: value, scope: "project", projectLabel: "Project", onOpenChange: vi.fn(), onSubmit, pending,
})));
const type = (name: string, value: string) => act(async () => {
  const field = document.getElementById(`workflow-arg-${name}`) as HTMLInputElement | HTMLTextAreaElement;
  const prototype = field.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
});
const submit = () => act(async () => {
  document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
});

it("blocks incomplete and malformed arguments, then preserves typed values and defaults", async () => {
  await render();
  await type("payload", "{broken");
  await submit();
  expect(onSubmit).not.toHaveBeenCalled();
  expect(document.getElementById("workflow-arg-title")?.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById("workflow-arg-payload")?.getAttribute("aria-invalid")).toBe("true");
  expect(document.querySelectorAll('[data-ui="field-error"]')).toHaveLength(2);
  await type("title", "  keep spaces  ");
  await type("payload", '{"flag":false}');
  await submit();
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith(entry, {
    title: "  keep spaces  ", limit: 3, payload: { flag: false }, enabled: false,
  }, undefined);
});

it("resets arguments across workflows and blocks submission while launching", async () => {
  await render();
  await type("title", "old draft");
  const next: OmniCodeSavedWorkflowEntry = { ...entry, name: "next", args: { title: { type: "string", default: "new default" } } };
  await render(next, true);
  expect((document.getElementById("workflow-arg-title") as HTMLInputElement).value).toBe("new default");
  expect(document.getElementById("workflow-arg-payload")).toBeNull();
  await submit();
  expect(onSubmit).not.toHaveBeenCalled();
  await render(next);
  await submit();
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith(next, { title: "new default" }, undefined);
});
