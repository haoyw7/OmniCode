// @vitest-environment happy-dom
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { attentionHaptic, lightImpact, outputHaptics, previewOutputHaptics, setHapticsForeground, successHaptic } from "./haptics";
import { saveHapticPreferences } from "./hapticPreferences";

const native = vi.hoisted(() => ({ pulse: vi.fn(), feedback: vi.fn(), cancel: vi.fn() }));
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    isPluginAvailable: vi.fn(() => false),
  },
  registerPlugin: () => native,
}));
vi.mock("@capacitor/haptics", async (importOriginal) => ({
  ...await importOriginal<typeof import("@capacitor/haptics")>(),
  Haptics: { impact: vi.fn(), notification: vi.fn(), vibrate: vi.fn() },
}));

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  for (const method of Object.values(native)) method.mockReset();
  vi.mocked(Haptics.impact).mockReset();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
  saveHapticPreferences({ interactions: true, output: true, strength: "gentle" });
  setHapticsForeground(true);
  vi.clearAllMocks();
});
afterEach(() => {
  outputHaptics.stop(); setHapticsForeground(true);
  vi.restoreAllMocks(); vi.useRealTimers();
});

it("uses bundled feedback when a hosted UI runs inside an older Android APK", async () => {
  await lightImpact(); await successHaptic(); await attentionHaptic();
  expect(Capacitor.isPluginAvailable).toHaveBeenCalledWith("MonoCodeHaptics");
  expect(Haptics.impact).toHaveBeenCalledExactlyOnceWith({ style: ImpactStyle.Light });
  expect(Haptics.notification).toHaveBeenNthCalledWith(1, { type: NotificationType.Success });
  expect(Haptics.notification).toHaveBeenNthCalledWith(2, { type: NotificationType.Warning });
  expect(native.feedback).not.toHaveBeenCalled();
  expect(native.cancel).not.toHaveBeenCalled();
});

it.each(["gentle", "standard"] as const)("previews %s output with bundled impacts and stops cleanly", async (strength) => {
  saveHapticPreferences({ interactions: true, output: true, strength });
  const stop = previewOutputHaptics();
  await vi.advanceTimersByTimeAsync(1000);
  expect(Haptics.impact).toHaveBeenCalledWith({ style: strength === "standard" ? ImpactStyle.Medium : ImpactStyle.Light });
  expect(native.pulse).not.toHaveBeenCalled();
  stop();
  const count = vi.mocked(Haptics.impact).mock.calls.length;
  await vi.advanceTimersByTimeAsync(1000);
  expect(Haptics.impact).toHaveBeenCalledTimes(count);
  expect(vi.getTimerCount()).toBe(0);
});

it("falls back when a native method is absent in an older APK", async () => {
  vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
  native.pulse.mockRejectedValue({ code: "UNIMPLEMENTED" });
  native.feedback.mockRejectedValue({ code: "UNIMPLEMENTED" });
  await lightImpact();
  expect(Haptics.impact).toHaveBeenCalledOnce();
  const report = vi.fn();
  const stop = previewOutputHaptics(report);
  await vi.advanceTimersByTimeAsync(500);
  expect(report).toHaveBeenCalledWith("requested");
  expect(vi.mocked(Haptics.impact).mock.calls.length).toBeGreaterThan(1);
  stop();
});

it.each(["system-disabled", "unavailable", "inactive"])("reports %s without bypassing native policy", async (status) => {
  vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
  native.pulse.mockResolvedValue({ status });
  const report = vi.fn();
  const stop = previewOutputHaptics(report);
  await vi.advanceTimersByTimeAsync(500);
  expect(report).toHaveBeenCalledWith(status);
  expect(Haptics.impact).not.toHaveBeenCalled();
  stop();
});

it("reports bridge errors and drops late preview results after cleanup", async () => {
  vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
  native.pulse.mockRejectedValue(new Error("VIBRATE permission denied"));
  const report = vi.fn();
  const stop = previewOutputHaptics(report);
  await vi.advanceTimersByTimeAsync(500);
  expect(report).toHaveBeenCalledWith("failed");
  expect(Haptics.impact).not.toHaveBeenCalled();
  stop();

  let resolve!: (value: { status: string }) => void;
  native.pulse.mockImplementation(() => new Promise((done) => { resolve = done; }));
  report.mockClear();
  const stopPending = previewOutputHaptics(report);
  await vi.advanceTimersByTimeAsync(100);
  stopPending();
  resolve({ status: "requested" });
  await vi.advanceTimersByTimeAsync(100);
  expect(report).not.toHaveBeenCalled();
});

it("keeps custom motor control on APKs that include the plugin", async () => {
  vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
  await lightImpact();
  const stop = previewOutputHaptics();
  await vi.advanceTimersByTimeAsync(1000);
  expect(native.feedback).toHaveBeenCalledWith({ cue: "light" });
  expect(native.pulse).toHaveBeenCalledWith({ strength: "gentle" });
  stop();
  expect(native.cancel).toHaveBeenCalled();
  expect(Haptics.impact).not.toHaveBeenCalled();
  expect(Haptics.vibrate).not.toHaveBeenCalled();
});

it("respects device preferences and foreground state on older APKs", async () => {
  saveHapticPreferences({ interactions: false, output: false, strength: "gentle" });
  await lightImpact();
  const stop = previewOutputHaptics();
  await vi.advanceTimersByTimeAsync(500);
  stop();
  saveHapticPreferences({ interactions: true, output: true, strength: "gentle" });
  setHapticsForeground(false);
  await attentionHaptic();
  const stopBackground = previewOutputHaptics();
  await vi.advanceTimersByTimeAsync(500);
  stopBackground();
  expect(Haptics.impact).not.toHaveBeenCalled();
  expect(Haptics.notification).not.toHaveBeenCalled();
  expect(Haptics.vibrate).not.toHaveBeenCalled();
});
