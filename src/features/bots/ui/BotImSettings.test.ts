// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BotSettings } from "./BotSettings";
import type { BotRpc } from "../model/botRpc";
import type { ImView } from "../model/im";
import { setUiLanguage } from "../../../shared/i18n/language";

const browser = vi.hoisted(() => ({
  open: vi.fn(async () => {}),
  copy: vi.fn(async () => {}),
}));
vi.mock("../../../platform/tauri/browser", () => ({
  openBrowser: browser.open,
}));
vi.mock("../../../platform/tauri/clipboard", async (original) => ({
  ...(await original<object>()),
  copyText: browser.copy,
}));
let root: Root, node: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  browser.open.mockReset().mockResolvedValue(undefined);
  browser.copy.mockReset().mockResolvedValue(undefined);
  localStorage.clear();
  setUiLanguage("en");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const url =
  "https://accounts.feishu.cn/oauth/v1/app/registration?user_code=public-code";
function fakeHost() {
  let view: ImView = {
    configured: true,
    config: {
      appId: "cli_saved",
      ownerOpenId: "ou_owner",
      secretConfigured: true,
      enabled: false,
    },
    status: { state: "stopped" },
    pending: 0,
    deliveries: [],
  };
  const rpc = vi.fn(
    async (method: string, params: Record<string, unknown> = {}) => {
      if (method === "im.bind") {
        view = {
          ...view,
          binding:
            params.action === "start"
              ? {
                  id: "attempt",
                  state: "pending",
                  verificationUrl: url,
                  expiresAt: Date.now() + 600_000,
                }
              : { id: "attempt", state: "cancelled" },
        };
      }
      if (method === "im.control") {
        if (params.action === "enable")
          view = {
            ...view,
            config: { ...view.config!, enabled: true },
            status: { state: "connected" },
          };
        if (params.action === "discard")
          view = {
            ...view,
            deliveries: view.deliveries.filter(
              (delivery) => delivery.id !== params.deliveryId,
            ),
          };
      }
      return structuredClone(view);
    },
  );
  return {
    rpc,
    update: (change: Partial<ImView>) => {
      view = { ...view, ...change };
    },
    get: () => structuredClone(view),
  };
}
function render(
  host: ReturnType<typeof fakeHost>,
  {
    mobile = false,
    active = true,
    supported = true,
    assistantEnabled = true,
  } = {},
) {
  const save = vi.fn(async () => {});
  const draw = (nextActive = active) =>
    act(() =>
      root.render(
        createElement(BotSettings, {
          value: null,
          catalog: {
            models: { codex: [{ id: "test", name: "Test", harness: "codex" }] },
            errors: {},
          },
          projects: [],
          busy: false,
          onSave: save,
          mobile,
          im: {
            rpc: host.rpc as BotRpc,
            active: nextActive,
            supported,
            assistantEnabled,
          },
        }),
      ),
    );
  draw();
  return { save, draw };
}
const button = (text: string) =>
  [...node.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) =>
      element.textContent === text ||
      element.querySelector(".assistant-settings-disclosure-title")
        ?.textContent === text,
  )!;
const click = (text: string) =>
  act(async () => {
    button(text).click();
  });
const advance = (milliseconds: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });

it("binds through the browser without manual credentials or submitting the assistant draft", async () => {
  const host = fakeHost();
  host.update({ configured: false, config: undefined });
  const { save } = render(host);
  expect(host.rpc).not.toHaveBeenCalled();
  await click("Feishu");
  expect(node.querySelector(".assistant-im input")).toBeNull();
  await click("Bind Feishu");
  expect(host.rpc).toHaveBeenCalledWith("im.bind", {
    action: "start",
    language: "en",
  });
  expect(browser.open).toHaveBeenCalledWith(url);
  const link = node.querySelector<HTMLInputElement>(".assistant-im input")!;
  expect(link.readOnly).toBe(true);
  expect(link.value).toBe(url);
  await click("Copy binding link");
  expect(browser.copy).toHaveBeenCalledWith(url);
  expect(button("Copied")).toBeDefined();
  expect(save).not.toHaveBeenCalled();
  expect(
    host.rpc.mock.calls.some(([method]) => method === "im.configure"),
  ).toBe(false);
  expect(JSON.stringify(localStorage)).not.toContain("public-code");
});

it("keeps the link available when opening the browser fails and allows a manual retry", async () => {
  const host = fakeHost();
  browser.open.mockRejectedValueOnce(new Error("Native opener failed"));
  render(host);
  await click("Feishu");
  await click("Bind another Feishu account");
  expect(node.textContent).toContain(
    "Copy the binding link and open it manually.",
  );
  expect(
    node.querySelector<HTMLInputElement>(".assistant-im input")!.value,
  ).toBe(url);
  await click("Open in browser");
  expect(browser.open).toHaveBeenCalledTimes(2);
  browser.copy.mockRejectedValueOnce(new Error("Clipboard unavailable"));
  await click("Copy binding link");
  expect(node.textContent).toContain("Select and copy it manually.");
  expect(button("Copied")).toBeUndefined();
});

it("cancels the current attempt, clears its link and allows starting again", async () => {
  const host = fakeHost();
  render(host);
  await click("Feishu");
  await click("Bind another Feishu account");
  expect(node.textContent).toContain("current connection stays active");
  await click("Cancel");
  expect(host.rpc).toHaveBeenCalledWith("im.bind", {
    action: "cancel",
    bindingId: "attempt",
  });
  expect(node.textContent).toContain("Feishu binding cancelled.");
  expect(node.querySelector(".assistant-im input")).toBeNull();
  expect(button("Bind another Feishu account").disabled).toBe(false);
});

it("shows expired authorization and completed automatic connection through Host polling", async () => {
  const host = fakeHost();
  render(host);
  await click("Feishu");
  await click("Bind another Feishu account");
  host.update({ binding: { id: "attempt", state: "expired" } });
  await advance(2000);
  expect(node.textContent).toContain("binding link expired");
  expect(node.querySelector(".assistant-im input")).toBeNull();
  await click("Bind another Feishu account");
  host.update({
    binding: { id: "attempt", state: "completed" },
    config: { ...host.get().config!, enabled: true },
    status: { state: "connected" },
  });
  await advance(2000);
  expect(node.textContent).toContain("Feishu account bound.");
  expect(node.textContent).toContain("Connection: Connected");
  expect(node.querySelector(".assistant-im input")).toBeNull();
  expect(button("Disconnect Feishu")).toBeDefined();
});

it("polls only while visible and resumes a pending binding after reopening", async () => {
  const host = fakeHost();
  const { draw } = render(host);
  await click("Feishu");
  await click("Bind another Feishu account");
  await click("Feishu");
  const calls = host.rpc.mock.calls.length;
  await advance(6000);
  expect(host.rpc).toHaveBeenCalledTimes(calls);
  await click("Feishu");
  expect(
    node.querySelector<HTMLInputElement>(".assistant-im input")!.value,
  ).toBe(url);
  draw(false);
  const hiddenCalls = host.rpc.mock.calls.length;
  await advance(6000);
  expect(host.rpc).toHaveBeenCalledTimes(hiddenCalls);
  draw(true);
  await act(async () => {});
  expect(host.rpc).toHaveBeenCalledTimes(hiddenCalls + 1);
});

it("ignores an older status response that completes after a new binding starts", async () => {
  const host = fakeHost();
  render(host);
  await click("Feishu");
  const previous = host.get();
  let finishRead!: (value: ImView) => void;
  host.rpc.mockImplementationOnce(
    () =>
      new Promise<ImView>((resolve) => {
        finishRead = resolve;
      }),
  );
  await advance(2000);
  await click("Bind another Feishu account");
  await act(async () => {
    finishRead(previous);
  });
  expect(node.textContent).toContain("Waiting for Feishu authorization");
  expect(
    node.querySelector<HTMLInputElement>(".assistant-im input")!.value,
  ).toBe(url);
});

it("does not open a browser after the user leaves the settings while a link is being generated", async () => {
  const host = fakeHost();
  const { draw } = render(host);
  await click("Feishu");
  let finish!: (value: ImView) => void;
  host.rpc.mockImplementationOnce(
    () =>
      new Promise<ImView>((resolve) => {
        finish = resolve;
      }),
  );
  await click("Bind another Feishu account");
  expect(node.textContent).toContain("Generating binding link");
  draw(false);
  await act(async () => {
    finish({
      ...host.get(),
      binding: { id: "attempt", state: "pending", verificationUrl: url },
    });
  });
  expect(browser.open).not.toHaveBeenCalled();
});

it("keeps binding failures visible after a successful status refresh", async () => {
  const host = fakeHost();
  render(host);
  await click("Feishu");
  host.rpc.mockRejectedValueOnce(
    new Error("Feishu browser binding is unavailable. Try again later."),
  );
  await click("Bind another Feishu account");
  await advance(2000);
  expect(node.textContent).toContain("Feishu browser binding is unavailable.");
  expect(browser.open).not.toHaveBeenCalled();
});

it("requires an enabled assistant before binding or reconnecting", async () => {
  const host = fakeHost();
  host.update({
    binding: {
      id: "failed-attempt",
      state: "failed",
      error: "Feishu binding failed. Try again.",
    },
  });
  render(host, { assistantEnabled: false });
  await click("Feishu");
  expect(node.textContent).toContain(
    "Enable the assistant before connecting Feishu.",
  );
  expect(button("Bind another Feishu account").disabled).toBe(true);
  expect(button("Connect Feishu").disabled).toBe(true);
  expect(button("Retry").disabled).toBe(true);
  expect(host.rpc).not.toHaveBeenCalledWith("im.bind", expect.anything());
  render(host, { assistantEnabled: true });
  await click("Connect Feishu");
  expect(host.rpc).toHaveBeenCalledWith("im.control", { action: "enable" });
  expect(button("Disconnect Feishu")).toBeDefined();
});

it("does not call unsupported IM methods and explains the Host upgrade", async () => {
  const host = fakeHost();
  render(host, { supported: false });
  await click("Feishu");
  expect(node.textContent).toContain("Update and restart the Host");
  await advance(6000);
  expect(host.rpc).not.toHaveBeenCalled();
});

it("does not render Feishu or call IM methods on the mobile settings page", async () => {
  const host = fakeHost();
  render(host, { mobile: true });
  expect(button("Feishu")).toBeUndefined();
  await advance(6000);
  expect(host.rpc).not.toHaveBeenCalled();
});

it("retains explicit uncertain-delivery retries and stopping delivery", async () => {
  const host = fakeHost();
  host.update({
    config: { ...host.get().config!, enabled: true },
    pending: 2,
    deliveries: [
      {
        id: "uncertain-1",
        state: "unknown",
        summary: "User text stays intact",
        createdAt: 5,
      },
    ],
  });
  render(host);
  await click("Feishu");
  expect(node.textContent).toContain("2 messages pending delivery");
  expect(node.textContent).toContain("Retrying may send it twice.");
  await click("Retry (may duplicate)");
  expect(host.rpc).toHaveBeenCalledWith("im.control", {
    action: "retry",
    deliveryId: "uncertain-1",
  });
  await click("Stop delivery");
  expect(host.rpc).toHaveBeenCalledWith("im.control", {
    action: "discard",
    deliveryId: "uncertain-1",
  });
  expect(node.textContent).not.toContain("User text stays intact");
});

it("localizes binding and known errors while preserving account and provider values", async () => {
  const host = fakeHost();
  host.update({
    status: { state: "failed", error: "Provider message unchanged" },
  });
  setUiLanguage("zh-CN");
  render(host);
  await click("飞书");
  expect(node.textContent).toContain("连接状态：连接失败");
  expect(node.textContent).toContain("Provider message unchanged");
  expect(node.textContent).toContain("ou_owner");
  await click("更换飞书绑定");
  expect(host.rpc).toHaveBeenCalledWith("im.bind", {
    action: "start",
    language: "zh-CN",
  });
  expect(node.textContent).toContain("等待飞书授权");
  host.update({
    binding: {
      id: "attempt",
      state: "failed",
      error: "Feishu binding failed. Try again.",
    },
  });
  await advance(2000);
  expect(node.textContent).toContain("飞书绑定失败，请重试。");
});
