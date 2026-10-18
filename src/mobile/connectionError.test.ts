import { expect, it } from "vitest";
import { connectionErrorMessage } from "./connectionError";

it("explains unreachable Tailscale and local network Hosts", () => {
  const timeout = new Error("failed to connect to /100.69.154.36 (port 3774) from /192.168.0.205 (port 34500) after 10000ms");
  expect(connectionErrorMessage(timeout, "http://100.69.154.36:3774")).toMatch(/Tailscale.*100\.69\.154\.36:3774|100\.69\.154\.36:3774.*Tailscale/);
  expect(connectionErrorMessage(new TypeError("Failed to fetch"), "http://192.168.0.209:3774")).toMatch(/same Wi-Fi/);
});

it("keeps Host-provided errors", () => {
  expect(connectionErrorMessage(new Error("Device credential is invalid or revoked"), "http://192.168.0.209:3774"))
    .toBe("Device credential is invalid or revoked");
});
