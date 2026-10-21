// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { acknowledgeWorkflowRuns, useWorkflowRunAcknowledged } from "./workflowRunAckStore";
import { devicePreferences } from "../../../../shared/lib/persistedPreferences";

const key = "omnicode-workflow-run-acknowledged";
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  devicePreferences.refresh([key]);
  vi.unstubAllGlobals();
});

it("reads existing acknowledgements and caps insertion order without duplicate writes", () => {
  localStorage.setItem(key, JSON.stringify(["old"]));
  acknowledgeWorkflowRuns(Array.from({ length: 256 }, (_, index) => `run-${index}`));
  const saved = JSON.parse(localStorage.getItem(key)!);
  expect(saved).toHaveLength(256);
  expect(saved[0]).toBe("run-0");
  expect(saved.at(-1)).toBe("run-255");
  const write = vi.spyOn(localStorage, "setItem");
  acknowledgeWorkflowRuns(["run-5", "run-5"]);
  expect(write).not.toHaveBeenCalled();
});

it("updates mounted rows across windows and retains acknowledgements when the disk is full", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  const root = createRoot(node);
  const View = () => createElement("span", null, String(useWorkflowRunAcknowledged()("run")));
  act(() => root.render(createElement(View)));
  expect(node.textContent).toBe("false");
  const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
  act(() => acknowledgeWorkflowRuns(["run"]));
  expect(node.textContent).toBe("true");
  write.mockRestore();
  act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
  expect(node.textContent).toBe("false");
  localStorage.setItem(key, JSON.stringify(["run"]));
  act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
  expect(node.textContent).toBe("true");
  act(() => root.unmount());
});
