import type { HostDeviceInfo } from "../contracts/protocol";
import type { DevicePort } from "./ports";

/** Device discovery only runs for pairing and description, never for sync. */
export class DeviceMetadata {
  private pending?: Promise<HostDeviceInfo | undefined>;
  constructor(private readonly device: DevicePort) {}

  async params(method: string, params: object): Promise<object> {
    if (method !== "environment.describe" && method !== "devices.pair") return params;
    const pending = this.pending ??= this.device.read();
    try {
      const deviceInfo = await pending;
      return deviceInfo ? { ...params, deviceInfo } : params;
    } catch (error) {
      if (this.pending === pending) this.pending = undefined;
      throw error;
    }
  }
}
