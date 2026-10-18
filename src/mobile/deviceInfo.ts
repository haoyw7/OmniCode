import { Capacitor } from "@capacitor/core";
import type { HostDeviceInfo } from "../features/connections/model/protocol";

/** Older app shells may not have the native plugin yet; connecting still works. */
export async function readMobileDeviceInfo(): Promise<HostDeviceInfo | undefined> {
  if (!Capacitor.isNativePlatform()) return undefined;
  try {
    const { Device } = await import("@capacitor/device");
    const info = await Device.getInfo();
    const model = info.model.trim();
    if (!model) return undefined;
    return { model, ...(info.manufacturer.trim() ? { manufacturer: info.manufacturer.trim() } : {}) };
  } catch {
    return undefined;
  }
}
