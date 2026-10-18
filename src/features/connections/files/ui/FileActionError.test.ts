// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SurfaceVisibilityContext } from "../../../../shared/ui/SurfaceVisibility";
import { FileActionError } from "./FileActionError";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  container.style.transform = "translateX(120px)";
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("keeps errors outside moving panes while respecting the pane's visibility", () => {
  const onDismiss = vi.fn();
  const render = (visible: boolean) =>
    act(() =>
      root.render(
        createElement(
          SurfaceVisibilityContext.Provider,
          { value: visible },
          createElement(FileActionError, {
            message: "File access failed",
            onDismiss,
          }),
        ),
      ),
    );

  render(true);
  const alert = document.querySelector('[role="alert"]')!;
  expect(alert.parentElement).toBe(document.body);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(alert.textContent).toContain("File access failed");

  render(false);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  render(true);
  act(() =>
    document.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(),
  );
  expect(onDismiss).toHaveBeenCalledOnce();
});
