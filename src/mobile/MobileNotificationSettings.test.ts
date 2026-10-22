// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileNotificationSettings } from "./MobileNotificationSettings";
import { notificationDefaults, saveMobileNotificationPreferences, saveMobileNotificationsEnabled, useMobileNotificationPreferences } from "./notificationPreferences";
import { devicePreferences } from "../shared/lib/persistedPreferences";
import { setUiLanguage } from "../shared/i18n/language";
import { applyReducedMotion } from "../shared/lib/reducedMotion";
import type { MobileNotificationPermission } from "./notifications";

let root: Root;
let node: HTMLDivElement;
let permission: MobileNotificationPermission;
let channelBlocked: boolean;
const requestPermission = vi.fn();
const openSettings = vi.fn();
function Fixture() {
  const settings = useMobileNotificationPreferences();
  return createElement(MobileNotificationSettings, { activity: {
    ...settings, permission, channelBlocked, permissionPending: false, preferencesPending: false,
    canOpenSettings: permission !== "unsupported", requestPermission, openSettings, notificationError: "",
    setNotificationPreferences: saveMobileNotificationPreferences,
    setNotificationsEnabled: async enabled => saveMobileNotificationsEnabled(enabled),
  } });
}
function render() { act(() => root.render(createElement(Fixture))); }
function toggle(label: string) {
  const control = [...node.querySelectorAll("label")].find(element => element.firstElementChild?.textContent === label)!;
  return node.querySelector<HTMLButtonElement>(`[id="${control.htmlFor}"]`)!;
}
function action(label: string) { return [...node.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label)!; }

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  devicePreferences.dispose();
  setUiLanguage("en");
  applyReducedMotion("on");
  permission = "granted";
  channelBlocked = false;
  vi.clearAllMocks();
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount()); node.remove(); devicePreferences.dispose();
  applyReducedMotion("system"); vi.unstubAllGlobals();
});

it("retains legacy master-off and category choices across toggling and remounting", () => {
  localStorage.setItem("omnicode.mobileNotifications", "0");
  render();
  expect(toggle("System notifications").getAttribute("aria-checked")).toBe("false");
  expect(toggle("Conversation replies").disabled).toBe(true);
  act(() => toggle("System notifications").click());
  act(() => toggle("Conversation replies").click());
  expect(toggle("Permissions and questions").getAttribute("aria-checked")).toBe("true");
  act(() => toggle("System notifications").click());
  act(() => toggle("System notifications").click());
  expect(toggle("Conversation replies").getAttribute("aria-checked")).toBe("false");
  act(() => root.render(null)); devicePreferences.dispose(); render();
  expect(toggle("Conversation replies").getAttribute("aria-checked")).toBe("false");
  expect(toggle("Bots replies").getAttribute("aria-checked")).toBe("true");
  act(() => toggle("Show notification previews").click());
  expect(JSON.parse(localStorage.getItem("omnicode.mobile.notificationPreferences")!)).toEqual({ ...notificationDefaults, replies: false, preview: false });
});

it.each(["prompt", "denied"] as const)("offers the correct permission action for %s without losing category choices", state => {
  permission = state; render();
  expect(node.textContent).toContain("Notifications are disabled on this device");
  act(() => action("Allow notifications").click());
  expect(requestPermission).toHaveBeenCalledTimes(state === "prompt" ? 1 : 0);
  expect(openSettings).toHaveBeenCalledTimes(state === "denied" ? 1 : 0);
  act(() => toggle("Permissions and questions").click());
  expect(toggle("Permissions and questions").getAttribute("aria-checked")).toBe("false");
});

it("reports a blocked Android channel despite granted app permission", () => {
  channelBlocked = true; render();
  expect(node.textContent).toContain("Conversation notifications are blocked in system settings.");
  act(() => action("Allow notifications").click());
  expect(openSettings).toHaveBeenCalledOnce();
});

it("shows an honest unsupported state and uses localized category descriptions", () => {
  permission = "unsupported"; render();
  expect(node.textContent).toContain("Notifications unavailable");
  expect(action("Allow notifications")).toBeUndefined();
  expect([...node.querySelectorAll<HTMLButtonElement>('[role="switch"]')].every(control => control.disabled)).toBe(true);
  act(() => setUiLanguage("zh-CN"));
  expect(node.textContent).toContain("权限与问题请求");
  expect(node.textContent).toContain("显示通知内容预览");
});

it("preserves recognized preference fields while ignoring invalid and unknown fields", () => {
  localStorage.setItem("omnicode.mobile.notificationPreferences", JSON.stringify({ replies: false, input: "no", preview: false, unknown: false }));
  render();
  expect(toggle("Conversation replies").getAttribute("aria-checked")).toBe("false");
  expect(toggle("Permissions and questions").getAttribute("aria-checked")).toBe("true");
  expect(toggle("Show notification previews").getAttribute("aria-checked")).toBe("false");
});
