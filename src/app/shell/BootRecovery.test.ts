// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { BootRecovery } from "./BootRecovery";

const notices = vi.hoisted(() => ({ toast: vi.fn(), dismissToast: vi.fn() }));
vi.mock("../../shared/ui/primitives/Toast", () => notices);
vi.mock("./WindowChrome", () => ({ WindowDragBar: () => null }));
vi.mock("../../shared/ui/branding/Omi", () => ({
  Omi: () => createElement("svg", { "aria-label": "OmniCode" }),
}));
vi.mock("../../shared/i18n/useTranslation", () => ({
  useTranslation: () => ({ t: (text: string) => text }),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("keeps the logo visible and moves connection details and retry into the top-right notice", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  notices.toast.mockReturnValue(42);
  const container = document.createElement("div");
  const root = createRoot(container);
  const retry = vi.fn();
  try {
    await act(async () => root.render(createElement(BootRecovery, {
      error: new Error("Host did not start"), onRetry: retry,
    })));
    expect(container.querySelector('[aria-label="OmniCode"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Host did not start");
    expect(container.querySelector("pre")).toBeNull();
    expect(notices.toast).toHaveBeenCalledWith(
      "Could not connect to shared conversations.\nHost did not start",
      expect.objectContaining({ position: "top-right", durationMs: 0, actionLabel: "Retry" }),
    );
    notices.toast.mock.calls[0][1].onAction();
    expect(retry).toHaveBeenCalledOnce();
    await act(async () => root.render(createElement("main", null, "workspace")));
    expect(notices.dismissToast).toHaveBeenCalledWith(42);
  } finally {
    await act(async () => root.unmount());
  }
});

it("shows a fresh retry notice when another attempt fails with the same error", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  notices.toast.mockReturnValueOnce(1).mockReturnValueOnce(2);
  const root = createRoot(document.createElement("div"));
  const onRetry = vi.fn();
  try {
    for (const key of [1, 2]) {
      await act(async () => root.render(createElement(BootRecovery, {
        key, error: "Host unavailable", onRetry,
      })));
    }
    expect(notices.toast).toHaveBeenCalledTimes(2);
    expect(notices.dismissToast).toHaveBeenCalledWith(1);
  } finally {
    await act(async () => root.unmount());
  }
  expect(notices.dismissToast).toHaveBeenCalledWith(2);
});
