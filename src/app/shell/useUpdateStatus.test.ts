// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryClient } from "../../shared/lib/queryClient";
import { useUpdateStatus } from "./useUpdateStatus";
import { installPendingUpdate, probeForUpdate, readAppVersion } from "../model/updater";
import { loadUpdatePreferences } from "../model/updatePreferences";

vi.mock("../model/updater", () => ({
  readAppVersion: vi.fn(async () => "1.0"), probeForUpdate: vi.fn(), installPendingUpdate: vi.fn(),
}));
vi.mock("../model/updatePreferences", () => ({
  loadUpdatePreferences: vi.fn(() => ({ autoInstall: false })), saveUpdatePreferences: vi.fn(),
}));
let root: Root, status: ReturnType<typeof useUpdateStatus>;
const View = () => { status = useUpdateStatus(); return null; };
const mount = () => act(async () => root.render(createElement(View)));
beforeEach(() => {
  queryClient.clear(); vi.clearAllMocks(); vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
  vi.mocked(probeForUpdate).mockResolvedValue(null);
});
afterEach(() => { act(() => root.unmount()); queryClient.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("retries an offline probe and only auto-installs an update found on the initial attempt", async () => {
  vi.mocked(loadUpdatePreferences).mockReturnValue({ autoInstall: true, skippedVersion: null });
  vi.mocked(probeForUpdate).mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ version: "2.0" } as NonNullable<Awaited<ReturnType<typeof probeForUpdate>>>);
  await mount();
  expect(status.snapshot.phase).toBe("idle");
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(status.snapshot.phase).toBe("available");
  expect(installPendingUpdate).not.toHaveBeenCalled();
  expect(readAppVersion).toHaveBeenCalledOnce();
});

it("does not let a slow background probe overwrite installation progress", async () => {
  let finishProbe!: (value: null) => void;
  let finishInstall!: (value: Awaited<ReturnType<typeof installPendingUpdate>>) => void;
  vi.mocked(loadUpdatePreferences).mockReturnValue({ autoInstall: false, skippedVersion: null });
  vi.mocked(probeForUpdate).mockImplementation(() => new Promise(resolve => { finishProbe = resolve; }));
  vi.mocked(installPendingUpdate).mockImplementation(() => new Promise(resolve => { finishInstall = resolve; }));
  await mount();
  let install!: Promise<void>;
  await act(async () => { install = status.install(); });
  expect(status.snapshot.phase).toBe("downloading");
  await act(async () => finishProbe(null));
  expect(status.snapshot.phase).toBe("downloading");
  await act(async () => { finishInstall({ phase: "current", currentVersion: "2.0" }); await install; });
});
