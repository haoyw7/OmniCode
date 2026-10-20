// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setUiLanguage } from "../shared/i18n/language";
import { MobileErrorNotice, MobileReloadStatus } from "./MobileConnectionFeedback";
import { MobileHostStatus } from "./MobileHostStatus";
import type { HostConnectionStatus } from "./client";
import { useProbedHostStatus } from "./useProbedHostStatus";

let node: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  setUiLanguage("en");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("expires errors, does not revive them on rerender, and lets users dismiss a new error", async () => {
  const render = (message: string) => act(() => root.render(createElement(MobileErrorNotice, { message })));
  render("First failure");
  expect(node.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(node.querySelector('[role="alert"]')).toBeNull();
  render("First failure");
  expect(node.querySelector('[role="alert"]')).toBeNull();
  render("Second failure");
  act(() => node.querySelector<HTMLButtonElement>('[aria-label="Dismiss"]')!.click());
  expect(node.querySelector('[role="alert"]')).toBeNull();
  render("");
  render("Second failure");
  expect(node.querySelector('[role="alert"]')).not.toBeNull();
});

it("keeps the localized failure reason during reconnect and clears it on recovery", () => {
  setUiLanguage("zh-CN");
  const render = (status: HostConnectionStatus, loading = false) =>
    act(() => root.render(createElement(MobileReloadStatus, { status, loading, error: "" })));
  render({ state: "failed", reason: "timeout", detail: "Request timed out" });
  expect(node.textContent).toBe("重新加载中… · 连接超时");
  expect(node.querySelector(".mobile-spin")).not.toBeNull();
  render({ state: "reconnecting" });
  expect(node.textContent).toBe("重新加载中… · 连接超时");
  render({ state: "connected" });
  expect(node.textContent).toBe("");
  expect(node.querySelector(".mobile-spin")).toBeNull();
});

it("keeps a device spinner between failed probes, recovers and stops probing when hidden", async () => {
  const connection = { endpoint: "http://host", environmentId: "host", name: "Computer", token: "token" };
  const probe = vi.fn<() => Promise<HostConnectionStatus>>().mockResolvedValue({ state: "failed" });
  function Device({ enabled }: { enabled: boolean }) {
    return createElement(MobileHostStatus, { status: useProbedHostStatus(connection, enabled, probe), dotOnly: true });
  }
  await act(async () => root.render(createElement(Device, { enabled: true })));
  expect(node.querySelector('[data-state="failed"] .mobile-spin')).not.toBeNull();
  probe.mockResolvedValue({ state: "connected" });
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(node.querySelector('[data-state="connected"] .mobile-host-status-dot')).not.toBeNull();
  expect(node.querySelector(".mobile-spin")).toBeNull();
  await act(async () => root.render(createElement(Device, { enabled: false })));
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(probe).toHaveBeenCalledTimes(2);
});
