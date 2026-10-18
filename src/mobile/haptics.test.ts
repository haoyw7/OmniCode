import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { lightImpact } from "./haptics";

vi.mock("@capacitor/haptics", async (importOriginal) => ({
  ...await importOriginal<typeof import("@capacitor/haptics")>(),
  Haptics: { impact: vi.fn() },
}));

beforeEach(() => vi.mocked(Haptics.impact).mockReset());
afterEach(() => vi.restoreAllMocks());

it("does not invoke haptics in the browser", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
  const impact = vi.mocked(Haptics.impact).mockResolvedValue();
  await lightImpact();
  expect(impact).not.toHaveBeenCalled();
});

it("requests a light impact on native platforms", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  const impact = vi.mocked(Haptics.impact).mockResolvedValue();
  await lightImpact();
  expect(impact).toHaveBeenCalledExactlyOnceWith({ style: ImpactStyle.Light });
});

it.each(["rejection", "throw"])("swallows a native plugin %s", async (failure) => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  const impact = vi.mocked(Haptics.impact);
  if (failure === "rejection") impact.mockRejectedValue(new Error("Unavailable"));
  else impact.mockImplementation(() => { throw new Error("Unavailable"); });
  await expect(lightImpact()).resolves.toBeUndefined();
});
