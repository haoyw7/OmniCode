// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Popover } from "./Popover";
import { Modal } from "./Modal";
import { NativePopupHost } from "./NativePopupHost";
import { SurfaceVisibilityContext } from "./SurfaceVisibility";
import { RemoveProjectDialog } from "../../features/projects/ui/RemoveProjectDialog";

vi.mock("../../features/projects/model/projectData", () => ({
  projectSessionCount: vi.fn(async () => 2),
}));

let root: Root;
let container: HTMLDivElement;
let nativeHost: HTMLDivElement;
let anchor: HTMLButtonElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  nativeHost = document.createElement("div");
  anchor = document.createElement("button");
  document.body.append(container, nativeHost, anchor);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  nativeHost.remove();
  anchor.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function escape() {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    cancelable: true,
  });
  act(() => window.dispatchEvent(event));
  return event;
}

function renderSurface(visible: boolean, children: ReactNode, native = false) {
  return act(async () =>
    root.render(
      createElement(
        SurfaceVisibilityContext.Provider,
        { value: visible },
        native
          ? createElement(
              NativePopupHost.Provider,
              { value: nativeHost },
              children,
            )
          : children,
      ),
    ),
  );
}

describe.each([false, true])(
  "portalled surface visibility, native host: %s",
  (native) => {
    it("hides a popover, stops its global handlers, and restores the open surface", async () => {
      const dismiss = vi.fn();
      const measure = vi.spyOn(anchor, "getBoundingClientRect");
      const content = createElement(Popover, {
        anchor,
        onDismiss: dismiss,
        children: createElement(
          "button",
          { "data-test-popover": true },
          "Open menu",
        ),
      });
      await renderSurface(true, content, native);
      expect(document.querySelector("[data-test-popover]")).not.toBeNull();

      await renderSurface(false, content, native);
      measure.mockClear();
      expect(document.querySelector("[data-test-popover]")).toBeNull();
      expect(escape().defaultPrevented).toBe(false);
      act(() => {
        anchor.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true }),
        );
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new Event("scroll"));
      });
      expect(dismiss).not.toHaveBeenCalled();
      expect(measure).not.toHaveBeenCalled();

      await renderSurface(true, content, native);
      expect(document.querySelector("[data-test-popover]")).not.toBeNull();
      expect(escape().defaultPrevented).toBe(true);
      expect(dismiss).toHaveBeenCalledOnce();
      expect(dismiss).toHaveBeenCalledWith("escape");
    });

    it("hides a modal without consuming Escape, then restores it", async () => {
      const close = vi.fn();
      const content = createElement(Modal, {
        title: "Settings dialog",
        onClose: close,
        children: "Editable content",
      });
      await renderSurface(true, content, native);
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      await renderSurface(false, content, native);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(escape().defaultPrevented).toBe(false);
      expect(close).not.toHaveBeenCalled();

      await renderSurface(true, content, native);
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        "Editable content",
      );
      expect(escape().defaultPrevented).toBe(true);
      expect(close).toHaveBeenCalledOnce();
    });
  },
);

it("keeps ordinary consumers visible without a workspace visibility provider", async () => {
  const dismiss = vi.fn();
  await act(async () =>
    root.render(
      createElement(Popover, {
        anchor,
        onDismiss: dismiss,
        children: "Ordinary menu",
      }),
    ),
  );
  expect(document.body.textContent).toContain("Ordinary menu");
  expect(escape().defaultPrevented).toBe(true);
  expect(dismiss).toHaveBeenCalledWith("escape");
});

it("retains the archive project's confirmation data while its Settings tab is hidden", async () => {
  const cancel = vi.fn();
  const content = createElement(RemoveProjectDialog, {
    path: "/repo",
    name: "Project",
    onCancel: cancel,
    onConfirm: vi.fn(),
  });
  await renderSurface(true, content);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "2 saved conversations",
  );
  await renderSurface(false, content);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(escape().defaultPrevented).toBe(false);
  expect(cancel).not.toHaveBeenCalled();
  await renderSurface(true, content);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "2 saved conversations",
  );
});
