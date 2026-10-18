// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { initUiLanguage } from "./languageSync";
import { getUiLanguage, setUiLanguage } from "./language";

const bus = vi.hoisted(() => ({
  receive: null as null | ((event: { payload: string }) => void),
  emit: vi.fn(async () => undefined),
  invoke: vi.fn(async () => undefined),
  unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: bus.emit,
  listen: vi.fn(async (_name, handler) => {
    bus.receive = handler;
    return bus.unlisten;
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bus.invoke }));
vi.mock("../../platform/tauri/platform", () => ({ IS_MAC: true }));

afterEach(() => {
  setUiLanguage("en");
  localStorage.clear();
});

it("synchronizes native menus and other windows without rebroadcast loops", async () => {
  setUiLanguage("en");
  const dispose = initUiLanguage();
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  try {
    await settle();
    expect(bus.invoke).toHaveBeenLastCalledWith("menu_set_language", {
      labels: {},
    });
    bus.emit.mockClear();
    bus.receive!({ payload: "zh-CN" });
    await settle();
    expect(getUiLanguage()).toBe("zh-CN");
    expect(bus.emit).not.toHaveBeenCalled();
    expect(bus.invoke).toHaveBeenLastCalledWith("menu_set_language", {
      labels: expect.objectContaining({
        Settings: "设置",
        "New Tab": "新建标签页",
      }),
    });
    bus.receive!({ payload: "unsupported" });
    expect(getUiLanguage()).toBe("zh-CN");
    setUiLanguage("en");
    await settle();
    expect(bus.emit).toHaveBeenCalledExactlyOnceWith(
      "monocode-ui-language-changed",
      "en",
    );
    expect(bus.invoke).toHaveBeenLastCalledWith("menu_set_language", {
      labels: {},
    });
  } finally {
    dispose();
    await settle();
  }
  expect(bus.unlisten).toHaveBeenCalledOnce();
});
