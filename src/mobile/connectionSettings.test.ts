import { startMotionClock, stopMotionClock, advanceMotionTimers } from "./motionTestClock";
// @vitest-environment happy-dom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileApp } from "./MobileApp";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { AttachmentChip } from "../features/sessions/ui/AttachmentChip";
import { setUiLanguage, UI_LANGUAGE_KEY } from "../shared/i18n/language";
import { ensureRandomUUID } from "./browserCrypto";
import { MOBILE_MATERIAL_SELECTOR } from "./theme/material";
import { loadThemePreference } from "../features/settings/model/appearance";

const nativeBack = vi.hoisted(() => ({
  listener: undefined as (() => void) | undefined,
}));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: async (event: string, listener: () => void) => {
      if (event === "backButton") nativeBack.listener = listener;
      return { remove: async () => {} };
    },
    exitApp: vi.fn(),
  },
}));

const healthyStatus = vi.hoisted(() => ({
  state: "connected" as "connected" | "failed" | "disconnected",
}));
const host = vi.hoisted(() => ({
  hasCapability: () => false,
  getConnectionStatus: () => healthyStatus,
  subscribeConnectionStatus: () => () => {},
  verify: vi.fn(async () => {}),
  reconnect: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
  suspend: vi.fn(async () => {}),
  connection: { endpoint: "http://computer:3774", name: "My computer", environmentId: "settings-host", disabled: false },
  restore: vi.fn(async () => false),
  pending: vi.fn(async () => undefined),
  savedConnections: vi.fn(async () => []),
  switchTo: vi.fn(async () => undefined),
  forget: vi.fn(async () => {}),
  probeConnection: vi.fn(async () => ({ state: "connected" })),
  connect: vi.fn(async () => {}),
  projects: vi.fn(async () => [
    { id: "one", name: "Connections", cwd: "/projects/Connections" },
  ]),
  sessions: vi.fn(async () => []),
  models: vi.fn(async () => ({ models: {}, errors: {} })),
  cachedModels: () => undefined,
  providerAccounts: vi.fn(async () => ({})),
  activity: vi.fn(async () => ({ environmentId: "host", sessions: [] })),
}));
vi.mock("./client", async (importOriginal) => ({
  ...await importOriginal<typeof import("./client")>(),
  MobileClient: vi.fn(function () {
    return host;
  }),
}));
vi.mock("./MobileAppUpdates", () => ({
  useMobileAppUpdates: () => ({}),
  MobileAppUpdates: () => null,
}));
vi.mock("./MobileQrScanner", () => ({
  MobileQrScanner: ({ active, onDetected }: { active: boolean; onDetected: (text: string) => void }) =>
    createElement("button", {
      className: "mobile-qr-scanner", disabled: !active,
      onClick: () => onDetected("monocode://pair?host=http://computer:3774&token=XD5J-2J3U"),
    }, "Scan test QR code"),
}));

let root: Root;
let node: HTMLDivElement;
beforeEach(() => {
  startMotionClock();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  nativeBack.listener = undefined;
  healthyStatus.state = "connected";
  host.connection.disabled = false;
  host.connect.mockResolvedValue(undefined);
  host.restore.mockResolvedValue(false);
  host.savedConnections.mockResolvedValue([]);
  localStorage.clear();
  setUiLanguage("en");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  stopMotionClock();
  vi.useRealTimers();
  vi.restoreAllMocks();
  node.remove();
  setUiLanguage("en");
  localStorage.clear();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => {
    root.render(createElement(MobileApp));
  });
  await act(async () => vi.dynamicImportSettled());
}
function active<T extends Element = HTMLElement>(selector: string): T | null {
  return [...node.querySelectorAll<T>(selector)]
    .find(item => !item.closest('[inert]')) ?? null;
}
async function finishClosingSheet(dialog: Element) {
  const backdrop = dialog.closest<HTMLElement>(".mobile-sheet-backdrop")!;
  expect(backdrop.dataset.foldState).toBe("closing");
  expect(backdrop.hasAttribute("inert")).toBe(true);
  await advanceMotionTimers(600);
  expect(dialog.isConnected).toBe(false);
}
function button(text: string) {
  return [...node.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => !item.closest('[inert]') &&
      (item.getAttribute("aria-label") === text || item.textContent?.trim() === text),
  )!;
}
function chooseMethod(label: string) {
  act(() =>
    [...node.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((item) => !item.closest("[inert]") && item.textContent?.trim() === label)!
      .click(),
  );
}
async function open() {
  act(() => {
    button("Add connection").focus();
    button("Add connection").click();
  });
  await act(async () => vi.dynamicImportSettled());
  chooseMethod("Pairing code");
}
function input(selector: string, value: string) {
  const field = active<HTMLInputElement>(selector)!;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    node
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("mobile connection settings", () => {
  it.each(["native", "close button", "backdrop"])("preserves the current page when an image closes via %s, then lets Back navigate", async (closeMode) => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    await act(async () => {
      root.render(createElement(Fragment, null,
        createElement(MobileApp),
        createElement(AttachmentChip, { attachment: {
          id: "preview", kind: "image", name: "photo.png",
          mimeType: "image/png", size: 42, previewUrl: "blob:photo",
        } }),
      ));
    });
    await act(async () => vi.dynamicImportSettled());
    act(() => button("Glass").click());
    act(() => button("Open photo.png full screen").click());
    const preview = document.querySelector<HTMLElement>(".image-lightbox")!;
    expect(preview).not.toBeNull();

    act(() => {
      if (closeMode === "native") nativeBack.listener!();
      else if (closeMode === "close button")
        preview.querySelector<HTMLButtonElement>(".image-lightbox-close")!.click();
      else preview.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await advanceMotionTimers(400);
    expect(document.querySelector(".image-lightbox")).toBeNull();
    expect(active("header strong")?.textContent).toBe("Glass");
    expect(App.exitApp).not.toHaveBeenCalled();

    act(() => nativeBack.listener!());
    expect(active("header strong")?.textContent).toBe("OmniCode");
    expect(App.exitApp).not.toHaveBeenCalled();
  });

  it.each(["header", "native"])("opens Glass from the root and returns with %s back, retaining glass settings", async (backMode) => {
    if (backMode === "native")
      vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    const back = () => act(() => {
      if (backMode === "native") nativeBack.listener!();
      else button("Back").click();
    });
    await render();
    expect(active("#mobile-follow-up, #mobile-glass-effect")).toBeNull();
    expect(active("#mobile-theme")!.textContent).toBe("Dark");
    expect(active("#mobile-language")).not.toBeNull();
    expect(button("Notifications").querySelector(".mobile-settings-value")?.textContent).toBe("Off");
    const rootPage = active("#mobile-theme")!.closest(".mobile-page-layer")!;
    act(() => button("Glass").click());
    expect(active("header strong")?.textContent).toBe("Glass");
    expect(rootPage.hasAttribute("inert")).toBe(true);
    expect(active("#mobile-theme")).toBeNull();
    await advanceMotionTimers(400);
    expect(rootPage.isConnected).toBe(false);
    expect(active(".mobile-glass-preview")).not.toBeNull();
    act(() => active<HTMLButtonElement>("#mobile-glass-effect")!.click());
    act(() => [...node.querySelectorAll<HTMLButtonElement>('[role="radio"]')].filter(item => !item.closest('[inert]')).find((item) => item.textContent?.trim() === "Solid")!.click());
    expect(active<HTMLInputElement>("#mobile-glass-intensity")!.disabled).toBe(true);
    act(() => active<HTMLButtonElement>("#mobile-glass-effect")!.click());
    back();
    expect(active('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')).toBeNull();
    if (backMode === "native") {
      expect(active("header strong")?.textContent).toBe("Glass");
      back();
    }
    expect(active("header strong")?.textContent).toBe("OmniCode");
    expect(active("#mobile-theme")).not.toBeNull();
    expect(active("#mobile-glass-effect")).toBeNull();
    expect(button("Glass").textContent).toContain("Solid");
    act(() => button("Glass").click());
    expect(active("#mobile-glass-effect")!.textContent).toBe("Solid");
    expect(active("#mobile-glass-effect")!.getAttribute("aria-expanded")).toBe("false");
    back();
    expect(active("#mobile-glass-effect")).toBeNull();
    expect(active("header strong")?.textContent).toBe("OmniCode");
  });

  it("shows the installed version and opens app updates from the About menu", async () => {
    await render();
    act(() => button("About").click());
    const about = active('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')!;
    expect(about.getAttribute("aria-label")).toBe("About");
    expect(about.querySelector(".mobile-about-version")?.textContent).toContain("OmniCode");
    act(() => [...about.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) => item.textContent?.trim() === "App updates")!.click());
    expect(active("header strong")?.textContent).toBe("App updates");
  });

  async function openConnectedSettings() {
    host.restore.mockResolvedValue(true);
    await render();
    await act(async () => button("Menu").click());
    await act(async () => button("Settings").click());
    await act(async () => vi.dynamicImportSettled());
  }

  async function openConnections() {
    await openConnectedSettings();
    const row = button("Connections");
    expect(row.textContent).toContain("My computer · Connected");
    expect(active(".mobile-connection-list")).toBeNull();
    await act(async () => row.click());
    expect(active("header strong")?.textContent).toBe("Connections");
  }

  it("opens Accounts and usage from Settings and returns with native Back", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    await openConnectedSettings();
    await act(async () => button("Accounts and usage").click());
    await act(async () => vi.dynamicImportSettled());
    expect(active("header strong")?.textContent).toBe("Accounts and usage");
    expect(active(".mobile-provider-accounts")?.textContent).toContain("My computer");
    await act(async () => nativeBack.listener?.());
    expect(active("header strong")?.textContent).toBe("OmniCode");
    expect(button("Accounts and usage")).toBeDefined();
  });

  it("lists devices with their status and no per-row switch or refresh button", async () => {
    await openConnections();
    const list = active(".mobile-connection-list")!;
    expect(list.textContent).toContain("My computer");
    expect(list.textContent).toContain("Connected");
    expect(list.querySelector('[aria-label="Add connection"]')).not.toBeNull();
    expect(list.querySelector('[role="switch"]')).toBeNull();
    expect(list.querySelector('[aria-label^="Reconnect to"]')).toBeNull();
    expect(host.reconnect).not.toHaveBeenCalled();
  });

  it("reconnects the current device once when the page opens disconnected", async () => {
    healthyStatus.state = "disconnected";
    host.connection.disabled = true;
    await openConnectedSettings();
    const before = host.reconnect.mock.calls.length;
    await act(async () => button("Connections").click());
    expect(host.reconnect).toHaveBeenCalledTimes(before + 1);
    expect(host.disconnect).not.toHaveBeenCalled();
    expect(host.suspend).not.toHaveBeenCalled();
  });

  it("switches to another saved Host from its row", async () => {
    const other = { endpoint: "http://other:3774", token: "saved-token", name: "Other Host", environmentId: "other" };
    host.savedConnections.mockResolvedValue([other] as never);
    await openConnections();
    await act(async () => button("Switch to Other Host").click());
    expect(host.switchTo).toHaveBeenCalledWith(other.endpoint);
    expect(host.connect).not.toHaveBeenCalled();
    expect(host.forget).not.toHaveBeenCalled();
  });

  it("offers reconnect from the saved connection's action menu", async () => {
    await openConnections();
    act(() => active(".mobile-connection-details")!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    const menu = active('[role="dialog"][aria-label="Connection options"]')!;
    await act(async () => [...menu.querySelectorAll<HTMLButtonElement>("button")]
      .find(item => item.textContent?.trim() === "Reconnect")!.click());
    expect(host.reconnect).toHaveBeenCalledOnce();
    expect(menu.closest<HTMLElement>(".mobile-sheet-backdrop")!.inert).toBe(true);
    expect(host.connect).not.toHaveBeenCalled();
  });

  it("opens connection actions on a hold, edits the local alias and icon, and preserves the Host name", async () => {
    await openConnections();
    vi.useFakeTimers();
    const details = active<HTMLButtonElement>(".mobile-connection-details")!;
    act(() => details.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 70, clientY: 140 })));
    act(() => vi.advanceTimersByTime(449));
    expect(active('[role="dialog"][aria-label="Connection options"]')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(active('[role="dialog"][aria-label="Connection options"]')).not.toBeNull();
    act(() => button("Edit").click());
    expect(active('[role="dialog"][aria-label="Edit connection"]')).not.toBeNull();
    expect(button("Save").disabled).toBe(true);
    input(".mobile-connection-name-field input", "Workstation");
    act(() => button("Terminal").click());
    act(() => active(".mobile-connection-editor")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(active(".mobile-connection-name")!.textContent).toBe("Workstation");
    expect(active(".mobile-header-title")!.textContent).toBe("Connections");
    expect(host.connection.name).toBe("My computer");
    expect(JSON.parse(localStorage.getItem("monocode.mobile.connectionAppearance:http://computer:3774")!)).toEqual({ displayName: "Workstation", icon: "terminal" });
    vi.useRealTimers();
  });

  it("cancels long press when scrolling and keeps the switch separate from deletion", async () => {
    await openConnections();
    vi.useFakeTimers();
    const details = active<HTMLButtonElement>(".mobile-connection-details")!;
    act(() => details.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 70, clientY: 140 })));
    act(() => details.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 70, clientY: 165 })));
    act(() => vi.advanceTimersByTime(500));
    expect(active('[role="dialog"][aria-label="Connection options"]')).toBeNull();
    act(() => details.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    act(() => button("Delete").click());
    expect(host.disconnect).not.toHaveBeenCalled();
    await act(async () => button("Delete connection").click());
    expect(host.disconnect).toHaveBeenCalledTimes(1);
    expect(host.suspend).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("lists every paired device and switches, renames or forgets one that is not active", async () => {
    const other = { endpoint: "http://100.64.0.1:3774/", token: "tailnet", name: "My computer", environmentId: "settings-host" };
    host.savedConnections.mockResolvedValue([{ ...host.connection, token: "lan" }, other] as never);
    await openConnections();
    const rows = () => [...active(".mobile-connection-list")!.querySelectorAll(".mobile-connection-device")];
    expect(rows().map((row) => row.querySelector(".mobile-connection-status")!.textContent)).toEqual([
      "Connectedcomputer:3774",
      "Available100.64.0.1:3774",
    ]);
    expect(host.probeConnection).toHaveBeenCalledWith(other);

    const details = rows()[1].querySelector<HTMLButtonElement>(".mobile-connection-details")!;
    expect(details.getAttribute("aria-label")).toBe("Switch to My computer");
    act(() => details.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    act(() => button("Edit").click());
    input(".mobile-connection-name-field input", "Tailnet");
    act(() => active(".mobile-connection-editor")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(JSON.parse(localStorage.getItem("monocode.mobile.connectionAppearance:http://100.64.0.1:3774/")!)).toMatchObject({ displayName: "Tailnet" });
    expect(localStorage.getItem("monocode.mobile.connectionAppearance:http://computer:3774")).toBeNull();
    expect(rows()[1].querySelector(".mobile-connection-name")!.textContent).toBe("Tailnet");

    act(() => rows()[1].querySelector(".mobile-connection-details")!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    act(() => button("Delete").click());
    await act(async () => button("Delete connection").click());
    expect(host.forget).toHaveBeenCalledWith("http://100.64.0.1:3774/");
    expect(host.disconnect).not.toHaveBeenCalled();
    expect(localStorage.getItem("monocode.mobile.connectionAppearance:http://100.64.0.1:3774/")).toBeNull();
  });

  it("switches to another paired device from its row", async () => {
    const other = { endpoint: "http://100.64.0.1:3774/", token: "tailnet", name: "My computer", environmentId: "settings-host" };
    host.savedConnections.mockResolvedValue([{ ...host.connection, token: "lan" }, other] as never);
    await openConnections();
    const row = active(".mobile-connection-list")!.querySelectorAll<HTMLButtonElement>(".mobile-connection-details")[1];
    await act(async () => row.click());
    expect(host.switchTo).toHaveBeenCalledWith("http://100.64.0.1:3774/");
    expect(host.forget).not.toHaveBeenCalled();
  });

  it("opens the plain Home title as a project menu anchored to that title", async () => {
    host.restore.mockResolvedValue(true);
    await render();
    const title = active<HTMLButtonElement>('.mobile-header-title[data-capsule="false"]')!;
    expect(title.tagName).toBe("BUTTON");
    expect(title.matches(MOBILE_MATERIAL_SELECTOR)).toBe(false);
    expect(title.getAttribute("aria-expanded")).toBe("false");
    await act(async () => { title.focus(); title.click(); });
    expect(title.getAttribute("aria-expanded")).toBe("true");
    const menu = active<HTMLElement>('[role="dialog"][aria-label="Projects"]')!;
    expect(menu.closest(".mobile-sheet-backdrop")?.getAttribute("data-placement")).toBe("anchor");
    expect([...menu.querySelectorAll("button")].map((button) => button.textContent))
      .toEqual(["Connections/projects/Connections"]);
    act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(active('[role="dialog"][aria-label="Projects"]')).toBeNull();
    await finishClosingSheet(menu);
    expect(document.activeElement).toBe(title);
    expect(title.getAttribute("aria-expanded")).toBe("false");
    expect(active(".mobile-app")?.getAttribute("data-view")).toBe("home");
  });

  it("opens Settings from the drawer and returns to Home with translated labels", async () => {
    host.restore.mockResolvedValue(true);
    await render();
    await act(async () => setUiLanguage("zh-CN"));
    await act(async () => button("菜单").click());
    await act(async () => button("设置").click());
    expect(active(".mobile-app")?.getAttribute("data-view")).toBe("settings");
    expect(active("header strong")?.textContent).toBe("OmniCode");
    await act(async () => active<HTMLButtonElement>('[aria-label="返回"]')!.click());
    expect(active(".mobile-app")?.getAttribute("data-view")).toBe("home");
    expect(active('.mobile-header-title')?.getAttribute("aria-expanded")).toBe("false");
    expect(active('.mobile-header-title')?.getAttribute("aria-label")).toBe("项目");
  });

  it("renders the connection screen when LAN HTTP has no native randomUUID", async () => {
    const native = globalThis.crypto;
    const api = { getRandomValues: native.getRandomValues.bind(native) } as unknown as Crypto;
    vi.stubGlobal("crypto", api);
    ensureRandomUUID();
    await render();
    expect(button("Connections")).toBeDefined();
    expect(api.randomUUID()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("keeps connection fields in a dialog and cancels without connecting", async () => {
    await render();
    act(() => button("Connections").click());
    expect(active('input[type="url"], input.mobile-pairing-code')).toBeNull();
    await open();
    input('input[type="url"]', "http://computer:3774");
    input('input.mobile-pairing-code', "device-token");
    act(() =>
      node
        .querySelector('[role="dialog"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
    );
    expect(active('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')).toBeNull();
    expect(host.connect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button("Add connection"));
    await open();
    expect(
      active<HTMLInputElement>('input[type="url"]')!.value,
    ).toBe("http://computer:3774");
    expect(
      active<HTMLInputElement>('input.mobile-pairing-code')!.value,
    ).toBe("");
  });

  it("switches and remembers language immediately without losing open form values", async () => {
    await render();
    const language = active<HTMLButtonElement>("#mobile-language")!;
    act(() => {
      language.focus();
      language.click();
    });
    act(() => {
      [...node.querySelectorAll<HTMLButtonElement>('[role="radio"]')].filter(item => !item.closest('[inert]'))
        .find((item) => item.textContent?.trim() === "简体中文")!
        .click();
    });
    expect(localStorage.getItem(UI_LANGUAGE_KEY)).toBe("zh-CN");
    expect(active("header strong")!.textContent).toBe("OmniCode");
    expect(active("#mobile-theme")!.textContent).toBe("深色");
    expect(button("通知").querySelector(".mobile-settings-value")?.textContent).toBe("关闭");
    expect(button("编写器").querySelector(".mobile-settings-value")?.textContent).toBe("引导");
    act(() => button("连接").click());
    act(() => button("添加连接").click());
    await act(async () => vi.dynamicImportSettled());
    chooseMethod("配对码");
    input('input[type="url"]', "http://computer:3774");
    input('input.mobile-pairing-code', "device-token");
    act(() => setUiLanguage("en"));
    expect(
      active('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')!.getAttribute("aria-label"),
    ).toBe("Add connection");
    expect(
      active<HTMLInputElement>('input[type="url"]')!.value,
    ).toBe("http://computer:3774");
    expect(
      active<HTMLInputElement>('input.mobile-pairing-code')!.value,
    ).toBe("device-token");
    expect(host.connect).not.toHaveBeenCalled();
  });

  it("opens the color mode dialog from the keyboard, cancels without changes and saves a selected option", async () => {
    await render();
    const appearance = active<HTMLButtonElement>("#mobile-theme")!;
    act(() => {
      appearance.focus();
      appearance.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(
      active('[role="radio"][aria-checked="true"]')!.textContent,
    ).toBe("Dark");
    expect(
      active('.mobile-sheet-backdrop[data-placement="dialog"] .mobile-sheet-title')?.textContent,
    ).toBe("Color mode");
    act(() =>
      node
        .querySelector('[role="dialog"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
    );
    expect(active('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')).toBeNull();
    expect(appearance.textContent).toBe("Dark");
    expect(document.activeElement).toBe(appearance);
    act(() => appearance.click());
    act(() =>
      [...node.querySelectorAll<HTMLButtonElement>('[role="radio"]')].filter(item => !item.closest('[inert]'))
        .find((item) => item.textContent?.trim() === "Light")!
        .click(),
    );
    expect(active('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')).toBeNull();
    expect(appearance.textContent).toBe("Light");
    expect(loadThemePreference()).toBe("light");
    expect(active("#mobile-theme")!.textContent).toBe("Light");
  });

  it("retains failed connection input for retry and confirms success until Done", async () => {
    await render();
    act(() => button("Connections").click());
    await open();
    input('input[type="url"]', "http://computer:3774");
    input('input.mobile-pairing-code', "device-token");
    host.connect.mockRejectedValueOnce(new Error("Host rejected this token"));
    await submit();
    expect(host.connect).toHaveBeenCalledWith(
      "http://computer:3774",
      "device-token",
    );
    expect(
      active('[role="dialog"] [role="alert"]')!.textContent,
    ).toBe("Host rejected this token");
    expect(
      active<HTMLInputElement>('input.mobile-pairing-code')!.value,
    ).toBe("device-token");
    act(() => setUiLanguage("zh-CN"));
    await submit();
    const success = active('[role="dialog"] [role="status"]')!;
    expect(success.textContent).toContain("配对成功");
    expect(success.textContent).toContain("已连接到 My computer。");
    expect(active('input.mobile-pairing-code, [role="tablist"], .mobile-qr-scanner')).toBeNull();
    act(() => button("完成").click());
    expect(active('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')).toBeNull();
    // A successful connection opens Home on the connected computer.
    expect(active(".mobile-app")?.getAttribute("data-view")).toBe("home");
    expect(active("header strong")!.textContent).toBe("OmniCode");
    await act(async () => button("菜单").click());
    expect(active(".mobile-drawer-device")!.textContent).toBe("My computer");
  });

  it("stops scanning during pairing and replaces the camera with a success card", async () => {
    let finish!: () => void;
    host.connect.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    await render();
    act(() => button("Connections").click());
    act(() => button("Add connection").click());
    await act(async () => vi.dynamicImportSettled());
    act(() => {
      button("Scan test QR code").click();
      button("Scan test QR code").click();
    });
    expect(host.connect).toHaveBeenCalledExactlyOnceWith("http://computer:3774", "XD5J-2J3U");
    expect(button("Scan test QR code").disabled).toBe(true);
    expect(active('[role="dialog"] [role="status"]')).toBeNull();
    await act(async () => finish());
    expect(active(".mobile-qr-scanner")).toBeNull();
    expect(active('[role="dialog"] [role="status"]')!.textContent).toContain("Pairing successful");
    expect(active('[role="dialog"] [role="status"]')!.textContent).toContain("access this computer from your phone");
    const dialog = active('[role="dialog"]')!;
    act(() => button("Done").click());
    await finishClosingSheet(dialog);
    act(() => button("Menu").click());
    act(() => button("Settings").click());
    act(() => button("Connections").click());
    await open();
    expect(active('input.mobile-pairing-code')).not.toBeNull();
    expect(active('[role="dialog"] [role="status"]')).toBeNull();
  });

  it("explains a consumed pairing code without showing success", async () => {
    await render();
    act(() => button("Connections").click());
    await open();
    input('input[type="url"]', "http://computer:3774");
    input('input.mobile-pairing-code', "XD5J-2J3U");
    host.connect.mockRejectedValueOnce(new Error("Pairing code has already been used. Generate a new code on the computer."));
    act(() => setUiLanguage("zh-CN"));
    await submit();
    expect(active('[role="dialog"] [role="alert"]')!.textContent).toBe("此配对码已使用，请在电脑上生成新的配对码。");
    expect(active('[role="dialog"] [role="status"]')).toBeNull();
  });

  it("confirms pairing before project loading completes and lets Done close the card", async () => {
    let finish!: (projects: { id: string; name: string; cwd: string }[]) => void;
    host.projects.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await render();
    act(() => button("Connections").click());
    await open();
    input('input[type="url"]', "http://computer:3774");
    input('input.mobile-pairing-code', "XD5J-2J3U");
    await submit();
    expect(active('[role="dialog"] [role="status"]')!.textContent).toContain("Pairing successful");
    expect(button("Done").disabled).toBe(false);
    act(() => button("Done").click());
    expect(active('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')).toBeNull();
    await act(async () => finish([]));
    expect(active(".mobile-app")?.getAttribute("data-view")).toBe("home");
  });
});
