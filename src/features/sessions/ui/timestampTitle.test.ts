import { afterEach, describe, expect, it, vi } from "vitest";
import { timestampTitle } from "./timestampTitle";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("timestampTitle", () => {
  it("preserves the full native date and time in each supported locale", () => {
    for (const zone of ["UTC", "America/Los_Angeles", "Asia/Shanghai"]) {
      vi.stubEnv("TZ", zone);
      for (const language of ["en", "zh-CN"]) {
        for (const epoch of [0, Date.UTC(2026, 0, 7, 2, 3, 41), Date.UTC(2026, 6, 7, 2, 3, 41)]) {
          expect(timestampTitle(epoch, language)).toBe(new Date(epoch).toLocaleString(language));
        }
      }
    }
  });

  it("reuses unchanged titles and invalidates when the local time zone changes", () => {
    const epoch = Date.UTC(2026, 9, 10, 20, 59, 13);
    vi.stubEnv("TZ", "UTC");
    const format = vi.spyOn(Date.prototype, "toLocaleString");
    const utc = timestampTitle(epoch, "en");
    expect(timestampTitle(epoch, "en")).toBe(utc);
    expect(format).toHaveBeenCalledTimes(1);
    vi.stubEnv("TZ", "America/Los_Angeles");
    const local = timestampTitle(epoch, "en");
    expect(format).toHaveBeenCalledTimes(2);
    expect(local).toBe(new Date(epoch).toLocaleString("en"));
    expect(local).not.toBe(utc);
  });

  it("bounds retained history while preserving exact output after eviction", () => {
    const epoch = Date.UTC(2025, 1, 3, 4, 5, 6);
    const title = timestampTitle(epoch, "en");
    for (let i = 1; i <= 513; i++) timestampTitle(epoch + i * 1000, "en");
    const format = vi.spyOn(Date.prototype, "toLocaleString");
    expect(timestampTitle(epoch, "en")).toBe(title);
    expect(format).toHaveBeenCalledTimes(1);
  });
});
