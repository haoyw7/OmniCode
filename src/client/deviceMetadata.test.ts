import { expect, it, vi } from "vitest";
import { DeviceMetadata } from "./deviceMetadata";

it("uses one platform device read for pairing and description while sync stays device independent", async () => {
  const read = vi.fn(async () => ({ model: "phone", installationId: "installation" }));
  const metadata = new DeviceMetadata({ read });
  const params = { sessionId: "session" };
  expect(await metadata.params("sessions.sync", params)).toBe(params);
  expect(read).not.toHaveBeenCalled();
  expect(await metadata.params("devices.pair", {})).toEqual({ deviceInfo: { model: "phone", installationId: "installation" } });
  await metadata.params("environment.describe", {});
  expect(read).toHaveBeenCalledTimes(1);
});
