import { afterEach, describe, expect, it, vi } from "vitest";

const { getVersion, check, message, ask, relaunch } = vi.hoisted(() => ({
  getVersion: vi.fn(),
  check: vi.fn(),
  message: vi.fn(),
  ask: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask, message }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));
vi.mock("../../features/settings/model/sounds", () => ({
  announceUpdateAvailable: vi.fn(),
}));

import { runUpdateFlow } from "./updater";

describe("updater", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("keeps automatic checks quiet when updater endpoints are missing", async () => {
    getVersion.mockResolvedValue("0.1.23");
    check.mockRejectedValue(
      new Error("Updater does not have any endpoints set"),
    );

    await expect(runUpdateFlow(false)).resolves.toEqual({
      phase: "idle",
      currentVersion: "0.1.23",
    });
    expect(message).not.toHaveBeenCalled();
  });

  it("points manual checks without updater endpoints to GitHub releases", async () => {
    getVersion.mockResolvedValue("0.1.23");
    check.mockRejectedValue(
      new Error("Updater does not have any endpoints set"),
    );

    await expect(runUpdateFlow(true)).resolves.toEqual({
      phase: "idle",
      currentVersion: "0.1.23",
    });
    expect(message).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://github.com/yyy0107/ohmymonocode/releases/latest",
      ),
      { title: "OmniCode" },
    );
  });

  it("still reports real updater failures", async () => {
    getVersion.mockResolvedValue("0.1.23");
    check.mockRejectedValue(new Error("network failed"));

    await expect(runUpdateFlow(true)).resolves.toMatchObject({
      phase: "error",
      error: "network failed",
    });
    expect(message).toHaveBeenCalledOnce();
  });

  it("shows date labels in prompts while keeping native versions in update state", async () => {
    const current = `0.7.1-lan.${Date.parse("2026-10-07T15:30:00Z")}`;
    const available = `0.7.1-lan.${Date.parse("2026-10-07T15:40:00Z")}`;
    getVersion.mockResolvedValue(current);
    check.mockResolvedValue({ version: available });
    ask.mockResolvedValue(false);
    await expect(runUpdateFlow(true)).resolves.toMatchObject({
      phase: "available",
      currentVersion: current,
      availableVersion: available,
    });
    expect(ask).toHaveBeenCalledWith(
      expect.stringContaining(
        "OmniCode 10-07-0840 is available (you have 10-07-0830).",
      ),
      expect.anything(),
    );
  });
});
