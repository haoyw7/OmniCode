import { expect, it } from "vitest";
import { HOST_PROTOCOL_VERSION, type HostDescriptor } from "../contracts/protocol";
import { requireHostDescriptor } from "./hostProtocol";

const descriptor = { protocolVersion: HOST_PROTOCOL_VERSION, environmentId: "host", name: "Host", providers: ["codex"], capabilities: [] } as HostDescriptor;

it("reads an older Host with missing capabilities without enabling newer actions", () => {
  const { capabilities: _capabilities, ...older } = descriptor;
  expect(requireHostDescriptor(older as HostDescriptor)).toEqual(descriptor);
});

it("keeps additive capabilities and rejects an incompatible protocol identity", () => {
  const newer = { ...descriptor, capabilities: ["sessions.sync.wait.v1", "future.capability"] };
  expect(requireHostDescriptor(newer)).toBe(newer);
  expect(() => requireHostDescriptor({ ...descriptor, protocolVersion: HOST_PROTOCOL_VERSION + 1 })).toThrow("incompatible");
  expect(() => requireHostDescriptor({ ...descriptor, environmentId: "" })).toThrow("incompatible");
});
