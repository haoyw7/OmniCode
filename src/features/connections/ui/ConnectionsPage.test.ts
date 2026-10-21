// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { configureSharedHost } from "../model/remoteProjects";
import { ConnectionsPage } from "./ConnectionsPage";
import { queryClient } from "../../../shared/lib/queryClient";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../../shared/ui/primitives/Sonner", () => ({
  withToast: (task: () => Promise<unknown>) => task(),
}));

let container: HTMLDivElement;
let root: Root;
const phone = { id: "phone", name: "My phone", admin: false, manufacturer: "Samsung", model: "SM-S9280" };

beforeEach(() => {
  queryClient.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  configureSharedHost("local", [], "computer");
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    const { method } = input as { method: string };
    if (command === "remote_request" && method === "devices.list")
      return {
        devices: [
          { id: "desktop", name: "Desktop credential", admin: true },
          phone,
        ],
      };
    if (command === "remote_request" && method === "devices.revoke")
      return { revoked: true };
    throw new Error(`Unexpected operation: ${command} ${method}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  queryClient.clear();
  container.remove();
  configureSharedHost(undefined, []);
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(strict = false) {
  const page = createElement(ConnectionsPage);
  await act(async () =>
    root.render(strict ? createElement(StrictMode, null, page) : page),
  );
}

const refreshButton = () =>
  container.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!;
const button = (text: string) =>
  [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === text,
  )!;

it("loads controlling devices and revokes access after StrictMode effect replay", async () => {
  await render(true);
  expect(invoke).toHaveBeenCalledWith("remote_request", {
    machineId: "computer",
    method: "devices.list",
    params: {},
  });
  expect(container.textContent).toContain("My phone");
  expect(container.textContent).toContain("Samsung SM-S9280 · Never connected");
  expect(container.textContent).not.toContain("Desktop credential");
  expect(container.textContent).not.toContain("Loading devices…");
  expect(refreshButton().disabled).toBe(false);

  await act(async () => button("Revoke access").click());
  await act(async () => button("Confirm revoke").click());
  expect(invoke).toHaveBeenCalledWith("remote_request", {
    machineId: "computer",
    method: "devices.revoke",
    params: { deviceId: "phone" },
  });
  expect(container.textContent).not.toContain("My phone");
  expect(container.textContent).toContain("No devices yet.");
});

it("stops loading after a failed list and lets refresh retry the request", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("Host unavailable"));
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Host unavailable",
  );
  expect(container.textContent).not.toContain("Loading devices…");
  expect(container.textContent).not.toContain("No devices yet.");
  expect(refreshButton().disabled).toBe(false);

  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementationOnce(
    () => new Promise((resolve) => { finish = resolve; }),
  );
  await act(async () => refreshButton().click());
  expect(container.textContent).toContain("Loading devices…");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(refreshButton().disabled).toBe(true);
  await act(async () => finish({ devices: [] }));
  expect(container.textContent).toContain("No devices yet.");
  expect(container.textContent).not.toContain("Loading devices…");
  expect(refreshButton().disabled).toBe(false);
});

it("shows a desktop hostname in the hardware subtitle and keeps its credential name", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ devices: [
    { id: "laptop", name: "Work computer", admin: false, deviceType: "desktop", hostname: "wy-ubuntu", online: true },
    phone,
  ] });
  await render();
  const desktopRow = [...container.querySelectorAll("div")].find(
    (node) => node.textContent === "Work computer",
  )!.parentElement!.parentElement!;
  expect(desktopRow.textContent).toContain("wy-ubuntu · Online");
  expect(desktopRow.querySelector(".lucide-monitor")).not.toBeNull();
  expect(desktopRow.querySelector(".lucide-smartphone")).toBeNull();
  expect(container.textContent).toContain("Samsung SM-S9280 · Never connected");
  expect(container.querySelector(".lucide-smartphone")).not.toBeNull();
});

it("shows the unavailable service state without requesting devices", async () => {
  configureSharedHost(undefined, []);
  await render(true);
  expect(container.textContent).toContain(
    "The conversation service on this computer is not running.",
  );
  expect(container.textContent).not.toContain("Loading devices…");
  expect(refreshButton().disabled).toBe(true);
  expect(button("Add").disabled).toBe(true);
  expect(invoke).not.toHaveBeenCalled();
});

async function createPairingCode() {
  await render();
  await act(async () => button("Add").click());
  const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
  const name = dialog.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "New phone");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  return dialog;
}

function mockPairingRequests(list: () => unknown | Promise<unknown>) {
  const fallback = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    const { method } = input as { method: string };
    if (command === "remote_request" && method === "devices.issue")
      return { id: "issued", token: "ABCD-EFGH" };
    if (command === "remote_request" && method === "devices.pairingHosts")
      return { hosts: [{ url: "http://192.168.1.5:3774", kind: "lan", reachable: true }] };
    if (command === "remote_request" && method === "devices.list") return list();
    return fallback(command, input);
  });
}

it.each([false, true])("retires the QR after pairing, including a grouped network connection (%s)", async (grouped) => {
  vi.useFakeTimers();
  let paired = false;
  mockPairingRequests(() => ({ devices: paired && grouped ? [
    { ...phone, pairedAt: 100, connectionIds: [phone.id, "issued"] },
  ] : [
    { ...phone, pairedAt: 100 },
    { id: "issued", name: "New phone", admin: false, pairedAt: paired ? 200 : undefined },
  ] }));
  const dialog = await createPairingCode();
  expect(dialog.querySelector('[aria-label="Pairing QR code"]')).not.toBeNull();
  expect(dialog.textContent).toContain("ABCD-EFGH");
  expect(dialog.textContent).toContain("Each code can pair only one device.");
  expect(dialog.textContent).not.toContain("Pairing successful");

  paired = true;
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(dialog.querySelector('[role="status"]')?.textContent).toContain("Pairing successful");
  expect(dialog.textContent).toContain("This pairing code has been used and cannot pair another device.");
  expect(dialog.querySelector('[aria-label="Pairing QR code"]')).toBeNull();
  expect(dialog.querySelector("code")).toBeNull();
  expect(dialog.textContent).not.toContain("ABCD-EFGH");
  const calls = vi.mocked(invoke).mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(invoke).toHaveBeenCalledTimes(calls);
});

it("retries pairing status failures and ignores the pending response after unmount", async () => {
  vi.useFakeTimers();
  let requests = 0;
  let fail = false;
  let pending = false;
  let finish!: (value: unknown) => void;
  mockPairingRequests(() => {
    requests += 1;
    if (fail) throw new Error("Host unavailable");
    if (pending) return new Promise((resolve) => { finish = resolve; });
    return { devices: [] };
  });
  const dialog = await createPairingCode();
  const initialRequests = requests;
  fail = true;
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("Host unavailable");
  fail = false;
  pending = true;
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(requests).toBe(initialRequests + 2);
  // A slow request does not start another concurrent status check.
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(requests).toBe(initialRequests + 2);
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => finish({ devices: [{ id: "issued", pairedAt: 200 }] }));
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(requests).toBe(initialRequests + 2);
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
});
