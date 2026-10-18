import { beforeEach, expect, it, vi } from "vitest";
import { readMobileDeviceInfo } from "./deviceInfo";

const native = vi.hoisted(() => ({ isNativePlatform: vi.fn(), getInfo: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: native.isNativePlatform } }));
vi.mock("@capacitor/device", () => ({ Device: { getInfo: native.getInfo } }));
beforeEach(() => {
  vi.resetAllMocks();
  native.isNativePlatform.mockReturnValue(true);
});

it("reports only hardware model and manufacturer from native device info", async () => {
  native.getInfo.mockResolvedValue({ model: " Pixel 9 ", manufacturer: " Google ", name: "Personal phone", osVersion: "16", memUsed: 123 });
  expect(await readMobileDeviceInfo()).toEqual({ model: "Pixel 9", manufacturer: "Google" });
});

it("keeps older native shells connectable when the plugin is unavailable", async () => {
  native.getInfo.mockRejectedValue(new Error("Plugin not implemented"));
  expect(await readMobileDeviceInfo()).toBeUndefined();
});

it("does not report a browser as phone hardware", async () => {
  native.isNativePlatform.mockReturnValue(false);
  expect(await readMobileDeviceInfo()).toBeUndefined();
  expect(native.getInfo).not.toHaveBeenCalled();
});
