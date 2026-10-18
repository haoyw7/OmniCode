import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => vi.fn());
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  CapacitorHttp: { get: http },
  registerPlugin: vi.fn(),
}));
vi.mock("@capacitor/app", () => ({ App: {} }));

const source =
  "https://github.com/yyy0107/ohmymonocode/releases/latest/download";
const manifest = {
  packageId: "com.monocode.mobile",
  versionName: "0.7.0",
  versionCode: 5,
  downloadPath: "/monocode-5.apk",
  sha256: "a".repeat(64),
  size: 1234,
  publishedAt: "2026-10-09T12:00:00Z",
};

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("MONOCODE_UPDATE_CHANNEL", undefined);
  http.mockReset().mockResolvedValue({ status: 200, data: manifest });
});
afterEach(() => vi.unstubAllEnvs());

describe.each(["production", "development", "release"])("GitHub mobile updates in %s mode", (mode) => {
  beforeEach(() => {
    vi.stubEnv("MODE", mode);
    if (mode === "release") vi.stubEnv("MONOCODE_UPDATE_CHANNEL", "lan");
  });
  it("uses the mobile manifest and a flat GitHub APK asset", async () => {
    const updates = await import("./updates");
    expect(updates.updateBaseUrls).toEqual([source]);
    const update = await updates.checkMobileUpdate();
    expect(http).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${source}/mobile-latest.json` }),
    );
    expect(updates.updateDownloadUrl(update)).toBe(`${source}/monocode-5.apk`);
  });

  it.each([
    "/apk/monocode-5.apk",
    "/monocode-6.apk",
    "/../monocode-5.apk",
    "https://other.example/monocode-5.apk",
  ])("rejects mismatched release asset %s", async (downloadPath) => {
    const { parseMobileUpdate } = await import("./updates");
    expect(() => parseMobileUpdate({ ...manifest, downloadPath })).toThrow();
  });

  it("ignores a manifest-supplied source and never falls back to LAN", async () => {
    const updates = await import("./updates");
    http.mockResolvedValueOnce({
      status: 200,
      data: { ...manifest, sourceUrl: "https://other.example" },
    });
    expect(updates.updateDownloadUrl(await updates.checkMobileUpdate())).toBe(
      `${source}/monocode-5.apk`,
    );
    http.mockClear().mockRejectedValue(new Error("GitHub unavailable"));
    await expect(updates.checkMobileUpdate()).rejects.toThrow(
      "GitHub unavailable",
    );
    expect(http).toHaveBeenCalledTimes(1);
  });
});
