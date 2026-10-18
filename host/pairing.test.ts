import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";

const cleanups: (() => void)[] = [];
const installationId = "dff432f1-16ca-45af-812d-d8d370642645";
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

it("groups a phone's network credentials across restarts and revokes all of them", () => {
  const directory = mkdtempSync(join(tmpdir(), "omnicode-phone-identity-test-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "host.db");
  let store = new HostStore(path);
  cleanups.push(() => store.close());
  const lan = store.redeemPairingCode(store.issuePairingDevice("Phone LAN").token);
  const tail = store.redeemPairingCode(store.issuePairingDevice("Phone Tailscale").token);
  const other = store.issueDevice("Same model, different phone");
  const info = { installationId, model: "Pixel 9", manufacturer: "Google" };
  store.updateDeviceInfo(lan.token, info);
  store.updateDeviceInfo(tail.token, info);
  store.updateDeviceInfo(other.token, { ...info, installationId: "b3394850-0750-45ad-9d4e-ad08db4f7581" });
  store.touchDevice(lan.token, 100_000);
  store.touchDevice(tail.token, 200_000);
  const group = store.deviceGroups(200_001).find(device => device.connectionIds?.includes(lan.id))!;
  expect(group.connectionIds).toEqual(expect.arrayContaining([lan.id, tail.id]));
  expect(group).toMatchObject({ online: true, lastSeen: 200_000, model: "Pixel 9" });
  expect(store.deviceGroups()).toHaveLength(2);
  expect(JSON.stringify(store.deviceGroups())).not.toContain(installationId);
  const identityId = group.identityId;
  store.close();
  store = new HostStore(path);
  expect(store.deviceGroups().find(device => device.identityId === identityId)?.connectionIds).toHaveLength(2);
  expect(store.authenticated(lan.token)).toBe(true);
  expect(store.authenticated(tail.token)).toBe(true);
  expect(store.authenticated(installationId)).toBe(false);
  expect(store.authenticated(identityId!)).toBe(false);
  expect(store.revokeDevice(tail.id)).toBe(true);
  expect(store.authenticated(lan.token)).toBe(false);
  expect(store.authenticated(tail.token)).toBe(false);
  expect(store.authenticated(other.token)).toBe(true);
});

it("backfills legacy credentials without allowing identity reassignment or admin grouping", () => {
  const store = new HostStore(":memory:");
  cleanups.push(() => store.close());
  const first = store.issueDevice("Legacy LAN");
  const second = store.issueDevice("Legacy Tailscale");
  const admin = store.issueDevice("Desktop");
  store.markAdminDevice(admin.id);
  for (const device of [first, second, admin]) store.updateDeviceInfo(device.token, { installationId });
  const group = store.deviceGroups().find(device => device.connectionIds?.includes(first.id))!;
  expect(group.connectionIds).toHaveLength(2);
  expect(group.deviceType).toBe("mobile");
  store.updateDeviceInfo(first.token, { installationId: "b3394850-0750-45ad-9d4e-ad08db4f7581" });
  store.updateDeviceInfo(second.token, {});
  expect(store.deviceGroups().find(device => device.id === group.id)?.identityId).toBe(group.identityId);
  expect(store.deviceGroups().find(device => device.id === admin.id)?.identityId).toBeUndefined();
  expect(store.revokeDevice(first.id)).toBe(true);
  expect(store.authenticated(admin.token)).toBe(true);
});

it("leaves legacy, malformed and desktop identities separate and scopes identity to each Host", () => {
  const first = new HostStore(":memory:"), second = new HostStore(":memory:");
  cleanups.push(() => first.close(), () => second.close());
  for (const store of [first, second]) {
    const phone = store.issueDevice("Phone");
    store.updateDeviceInfo(phone.token, { installationId });
    const desktop = store.issueDevice("Desktop");
    store.updateDeviceInfo(desktop.token, { installationId, deviceType: "desktop", hostname: "laptop" });
    for (const value of [undefined, "", "invalid", 123]) {
      store.updateDeviceInfo(store.issueDevice("Legacy").token, { installationId: value, model: "Pixel 9" });
    }
    expect(store.deviceGroups()).toHaveLength(6);
    expect(store.deviceGroups().filter(device => device.identityId)).toHaveLength(1);
  }
  expect(first.deviceGroups().find(device => device.identityId)?.identityId)
    .not.toBe(second.deviceGroups().find(device => device.identityId)?.identityId);
});

it("self-revocation removes only that route's credential", () => {
  const store = new HostStore(":memory:");
  cleanups.push(() => store.close());
  const first = store.issueDevice("LAN"), second = store.issueDevice("Tailscale");
  for (const device of [first, second]) store.updateDeviceInfo(device.token, { installationId });
  expect(store.revokeToken(first.token)).toBe(true);
  expect(store.authenticated(second.token)).toBe(true);
  expect(store.deviceGroups()[0].connectionIds).toEqual([second.id]);
});

it("persists pairing redemption across Host restarts while keeping the phone credential", () => {
  const directory = mkdtempSync(join(tmpdir(), "omnicode-pairing-test-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "host.db");
  let store = new HostStore(path);
  cleanups.push(() => store.close());
  const first = store.issuePairingDevice("First phone");
  const second = store.issuePairingDevice("Second phone");
  expect(first.token).not.toBe(second.token);
  expect(store.authenticated(first.token)).toBe(false);
  const credential = store.redeemPairingCode(first.token);
  const pairedAt = store.devices().find(device => device.id === first.id)?.pairedAt;
  expect(pairedAt).toEqual(expect.any(Number));
  store.close();
  store = new HostStore(path);
  expect(store.authenticated(credential.token)).toBe(true);
  expect(store.authenticated(first.token)).toBe(false);
  expect(() => store.redeemPairingCode(first.token)).toThrow("Pairing code has already been used");
  expect(store.devices().find(device => device.id === first.id)?.pairedAt).toBe(pairedAt);
  expect(store.redeemPairingCode(second.token).id).toBe(second.id);
});

it("rejects another store connection's attempt after it observed the same pending code", async () => {
  const directory = mkdtempSync(join(tmpdir(), "omnicode-pairing-race-test-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "host.db");
  const first = new HostStore(path);
  cleanups.push(() => first.close());
  const second = new HostStore(path);
  cleanups.push(() => second.close());
  const issued = first.issuePairingDevice("Phone");
  expect(first.hasPairingCode(issued.token)).toBe(true);
  expect(second.hasPairingCode(issued.token)).toBe(true);
  const attempts = await Promise.allSettled([first, second].map(store =>
    Promise.resolve().then(() => store.redeemPairingCode(issued.token))));
  expect(attempts.filter(attempt => attempt.status === "fulfilled")).toHaveLength(1);
  const rejected = attempts.find(attempt => attempt.status === "rejected") as PromiseRejectedResult;
  expect(rejected.reason.message).toContain("already been used");
  const redeemed = attempts.find(attempt => attempt.status === "fulfilled") as PromiseFulfilledResult<{ id: string; token: string }>;
  expect(first.authenticated(redeemed.value.token)).toBe(true);
  expect(second.authenticated(redeemed.value.token)).toBe(true);
});
