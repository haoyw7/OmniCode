// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BotSettings } from "./BotSettings";
import type { BotRpc } from "../model/botRpc";
import type { ImView } from "../model/im";
import { setUiLanguage } from "../../../shared/i18n/language";

let root: Root, node: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
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
      if (method === "im.configure")
        view = {
          ...view,
          config: {
            ...view.config!,
            appId: String(params.appId),
            ownerOpenId: String(params.ownerOpenId),
            language: params.language as "en" | "zh-CN",
          },
        };
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
const field = (label: string) =>
  [...node.querySelectorAll(".assistant-im label")]
    .find((element) => element.firstChild?.textContent === label)!
    .querySelector<HTMLInputElement>("input")!;
const click = async (text: string) =>
  act(async () => {
    button(text).click();
  });
const type = (label: string, value: string) =>
  act(() => {
    const input = field(label);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const advance = (milliseconds: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });

it(
  "saves Feishu independently on desktop and never fills or persists the secret",
  async () => {
    const host = fakeHost();
    const { save } = render(host);
    expect(host.rpc).not.toHaveBeenCalled();
    await click("Feishu");
    expect(field("App ID").value).toBe("cli_saved");
    expect(field("App Secret").value).toBe("");
    type("Your Feishu open_id", " ou_edited ");
    await click("Save Feishu settings");
    expect(host.rpc).toHaveBeenCalledWith("im.configure", {
      appId: "cli_saved",
      ownerOpenId: "ou_edited",
      language: "en",
    });
    expect(save).not.toHaveBeenCalled();

    type("App Secret", "never-store-this-secret");
    await act(async () => {
      field("App Secret").dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(host.rpc).toHaveBeenCalledWith(
      "im.configure",
      expect.objectContaining({ appSecret: "never-store-this-secret" }),
    );
    expect(field("App Secret").value).toBe("");
    expect(save).not.toHaveBeenCalled();
    expect(JSON.stringify(localStorage)).not.toContain(
      "never-store-this-secret",
    );
    expect(
      host.rpc.mock.calls.filter(([method]) => method === "im.get").length,
    ).toBe(3);
  },
);

it("does not render Feishu or call IM methods on the mobile settings page", async () => {
  const host = fakeHost();
  render(host, { mobile: true });
  expect(
    node.querySelector('.assistant-settings[data-layout="mobile"]'),
  ).not.toBeNull();
  expect(button("Feishu")).toBeUndefined();
  expect(node.querySelector(".assistant-im")).toBeNull();
  await advance(6000);
  expect(host.rpc).not.toHaveBeenCalled();
});

it("polls only while visible and keeps unsaved fields through status updates and collapse", async () => {
  const host = fakeHost();
  const { draw } = render(host);
  await click("Feishu");
  type("App ID", "cli_unsaved");
  host.update({ status: { state: "connected" } });
  await advance(2000);
  expect(node.textContent).toContain("Connection: Connected");
  expect(field("App ID").value).toBe("cli_unsaved");
  await click("Feishu");
  const calls = host.rpc.mock.calls.length;
  await advance(6000);
  expect(host.rpc).toHaveBeenCalledTimes(calls);
  await click("Feishu");
  expect(field("App ID").value).toBe("cli_unsaved");
  draw(false);
  const hiddenCalls = host.rpc.mock.calls.length;
  await advance(6000);
  expect(host.rpc).toHaveBeenCalledTimes(hiddenCalls);
  draw(true);
  await act(async () => {});
  expect(host.rpc).toHaveBeenCalledTimes(hiddenCalls + 1);
});

it("does not call unsupported IM methods and explains the Host upgrade", async () => {
  const host = fakeHost();
  render(host, { supported: false });
  await click("Feishu");
  expect(node.textContent).toContain("Update and restart the Host");
  expect(node.querySelector(".assistant-im input")).toBeNull();
  await advance(6000);
  expect(host.rpc).not.toHaveBeenCalled();
});

it("requires an enabled assistant before connecting and connects only after an explicit action", async () => {
  const host = fakeHost();
  render(host, { assistantEnabled: false });
  await click("Feishu");
  expect(node.textContent).toContain(
    "Enable the assistant before connecting Feishu.",
  );
  expect(button("Connect Feishu").disabled).toBe(true);
  expect(host.rpc).not.toHaveBeenCalledWith("im.control", expect.anything());
  render(host, { assistantEnabled: true });
  await click("Connect Feishu");
  expect(host.rpc).toHaveBeenCalledWith("im.control", { action: "enable" });
  expect(button("Disconnect Feishu")).toBeDefined();
});

it("makes uncertain retries explicit and can stop a delivery without removing the conversation", async () => {
  const host = fakeHost();
  host.update({
    config: { ...host.get().config!, enabled: true },
    pending: 2,
    deliveries: [
      {
        id: "uncertain-1",
        state: "unknown",
        summary: "Done: user text stays intact",
        createdAt: 5,
        error: "Platform acknowledgement missing",
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
  expect(
    host.rpc.mock.calls.every(([method]) => method.startsWith("im.")),
  ).toBe(true);
  expect(node.textContent).not.toContain("Done: user text stays intact");
});

it("keeps a failed save visible after a successful status refresh and retains the draft", async () => {
  const host = fakeHost();
  render(host);
  await click("Feishu");
  type("App ID", "cli_unsaved");
  type("App Secret", "replacement-secret");
  host.rpc.mockRejectedValueOnce(
    new Error("Platform rejected the application"),
  );
  await click("Save Feishu settings");
  await advance(2000);
  expect(node.textContent).toContain("Platform rejected the application");
  expect(field("App ID").value).toBe("cli_unsaved");
  expect(node.textContent).not.toContain("Feishu settings saved");
});

it("ignores an older status read that completes after saving new credentials", async () => {
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
  type("App ID", "cli_new");
  type("App Secret", "replacement-secret");
  await click("Save Feishu settings");
  await act(async () => {
    finishRead(previous);
  });
  expect(field("App ID").value).toBe("cli_new");
  expect(node.textContent).toContain("Feishu settings saved");
});

it("does not save the settings while an IME composition is being confirmed", async () => {
  const host = fakeHost();
  const { save } = render(host);
  await click("Feishu");
  await act(async () => {
    field("App ID").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(host.rpc).not.toHaveBeenCalledWith("im.configure", expect.anything());
  expect(save).not.toHaveBeenCalled();
});

it("saves the chosen interface language while preserving platform and user values", async () => {
  const host = fakeHost();
  host.update({
    status: { state: "failed", error: "Platform error remains unchanged" },
  });
  setUiLanguage("zh-CN");
  render(host);
  await click("飞书");
  expect(node.textContent).toContain("连接状态：连接失败");
  expect(node.textContent).toContain("Platform error remains unchanged");
  expect(field("App ID").value).toBe("cli_saved");
  await click("保存飞书设置");
  expect(host.rpc).toHaveBeenCalledWith(
    "im.configure",
    expect.objectContaining({ language: "zh-CN" }),
  );
});

it("requires a new secret only when the app changes and explains retired pending deliveries", async () => {
  const host = fakeHost();
  render(host);
  await click("Feishu");
  type("Your Feishu open_id", "ou_new_owner");
  expect(node.textContent).toContain(
    "stops pending deliveries for the previous connection",
  );
  expect(field("App Secret").placeholder).toBe("Saved; leave blank to keep it");
  expect(button("Save Feishu settings").disabled).toBe(false);

  type("App ID", "cli_other");
  expect(field("App Secret").placeholder).toBe("Enter the App Secret");
  expect(button("Save Feishu settings").disabled).toBe(true);
  await click("Save Feishu settings");
  expect(host.rpc).not.toHaveBeenCalledWith("im.configure", expect.anything());
  type("App Secret", "new-app-secret");
  await click("Save Feishu settings");
  expect(host.rpc).toHaveBeenCalledWith("im.configure", {
    appId: "cli_other",
    ownerOpenId: "ou_new_owner",
    appSecret: "new-app-secret",
    language: "en",
  });
  expect(node.textContent).not.toContain(
    "stops pending deliveries for the previous connection",
  );
});

it("translates known connection, restart and validation errors while retaining external errors", async () => {
  const host = fakeHost();
  host.update({
    status: { state: "failed", error: "Feishu connection failed" },
    deliveries: [
      {
        id: "unknown",
        state: "unknown",
        summary: "User text",
        createdAt: 1,
        error: "Host restarted before delivery was confirmed.",
      },
      {
        id: "external",
        state: "failed",
        summary: "External summary",
        createdAt: 2,
        error: "Platform error remains unchanged",
      },
    ],
  });
  setUiLanguage("zh-CN");
  render(host);
  await click("飞书");
  expect(node.textContent).toContain("飞书连接失败");
  expect(node.textContent).toContain("Host 在确认投递结果前重启了。");
  expect(node.textContent).toContain("Platform error remains unchanged");
  expect(node.textContent).toContain("User text");
  host.rpc.mockRejectedValueOnce(new Error("Invalid Feishu App ID or open_id"));
  await click("保存飞书设置");
  expect(node.textContent).toContain("飞书 App ID 或 open_id 无效");
});
