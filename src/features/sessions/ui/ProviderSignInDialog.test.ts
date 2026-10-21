// @vitest-environment happy-dom
// Keep this as .ts because the project test glob intentionally excludes .test.tsx.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  loginHarness: vi.fn<(_harness: string) => Promise<void>>(),
}));

vi.mock("../../../integrations/harness/core/auth", () => ({
  loginHarness: auth.loginHarness,
}));

import { ProviderSignInDialog } from "./ProviderSignInDialog";
import { queryClient } from "../../../shared/lib/queryClient";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  queryClient.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  auth.loginHarness.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  queryClient.clear();
  container.remove();
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  const result = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (item) => (item.getAttribute("aria-label") ?? item.textContent) === label,
  );
  expect(result, label).toBeDefined();
  return result!;
}

describe("ProviderSignInDialog", () => {
  it("does not apply the previous provider's late login to the new dialog", async () => {
    let finish!: () => void;
    auth.loginHarness.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await act(async () => root.render(createElement(ProviderSignInDialog, { harness: "grok", onClose: vi.fn() })));
    await act(async () => button("Sign in to Grok Build").click());
    await act(async () => root.render(createElement(ProviderSignInDialog, { harness: "codex", onClose: vi.fn() })));
    await act(async () => finish());
    expect(button("Sign in to Codex").disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Signed in to Codex");
  });

  it("launches provider login and offers a clear continuation state", async () => {
    const close = vi.fn();
    auth.loginHarness.mockResolvedValue();
    act(() =>
      root.render(
        createElement(ProviderSignInDialog, {
          harness: "grok",
          onClose: close,
        }),
      ),
    );

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Authentication required");
    expect(dialog?.textContent).toContain("Sign in to Grok Build");
    expect(dialog?.querySelector(".size-9")).not.toBeNull();

    await act(async () => button("Sign in to Grok Build").click());
    expect(auth.loginHarness).toHaveBeenCalledWith("grok");
    expect(dialog?.textContent).toContain("Signed in to Grok Build");

    act(() => button("Continue").click());
    expect(close).toHaveBeenCalledOnce();
  });
});
