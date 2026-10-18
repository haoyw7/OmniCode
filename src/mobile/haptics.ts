import { Capacitor, registerPlugin } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { loadHapticPreferences, subscribeHapticPreferences } from "./hapticPreferences";
import { OutputHaptics } from "./outputHaptics";

type Cue = "light" | "success" | "attention";
export type HapticResult = "requested" | "system-disabled" | "unavailable" | "inactive" | "failed" | "native-required";
const native = registerPlugin<{
  pulse(options: { strength: "gentle" | "standard" }): Promise<{ status: HapticResult } | void>;
  feedback(options: { cue: Cue }): Promise<{ status: HapticResult } | void>;
  cancel(): Promise<void>;
}>("MonoCodeHaptics");
let foreground = true;
const lifecycleListeners = new Set<() => void>();
const previewListeners = new Set<(result: HapticResult) => void>();
const android = () => Capacitor.getPlatform() === "android";
// The hosted UI can update before the APK containing this plugin is installed.
const hasNativeHaptics = () => android() && Capacitor.isPluginAvailable("MonoCodeHaptics");
const available = () => Capacitor.isNativePlatform() && foreground && (typeof document === "undefined" || !document.hidden);

async function cancel() {
  try { if (hasNativeHaptics()) await native.cancel(); } catch { /* optional */ }
}
async function pulse() {
  if (!available() || !loadHapticPreferences().output) return;
  const listeners = [...previewListeners];
  let result: HapticResult = "requested";
  try {
    await withFallback(async () => {
      const response = await native.pulse({ strength: loadHapticPreferences().strength });
      result = response?.status ?? "requested";
    }, () => Haptics.impact({ style: android() && loadHapticPreferences().strength === "standard"
      ? ImpactStyle.Medium : ImpactStyle.Light }));
  } catch { result = "failed"; }
  for (const listener of listeners) if (previewListeners.has(listener)) listener(result);
}

/** Only a missing method should fall back; system-disabled feedback must stay disabled. */
async function withFallback(custom: () => Promise<void>, bundled: () => Promise<void>) {
  if (hasNativeHaptics()) {
    try { await custom(); return; }
    catch (error) {
      if ((error as { code?: string })?.code !== "UNIMPLEMENTED") throw error;
    }
  }
  await bundled();
}
export const outputHaptics = new OutputHaptics(() => void pulse(), () => void cancel());

/** Feedback must never interrupt an action or vibrate the browser preview. */
async function feedback(cue: Cue) {
  if (!available() || !loadHapticPreferences().interactions) return;
  outputHaptics.interrupt();
  try {
    await withFallback(async () => { await native.feedback({ cue }); }, () => cue === "light"
      ? Haptics.impact({ style: ImpactStyle.Light })
      : Haptics.notification({ type: cue === "success" ? NotificationType.Success : NotificationType.Warning }));
  } catch { /* unsupported native plugin */ }
}
export const lightImpact = () => feedback("light");
export const successHaptic = () => feedback("success");
export const attentionHaptic = () => feedback("attention");

/** Resume always establishes a fresh text baseline; missed output is never replayed. */
export function setHapticsForeground(value: boolean) {
  const changed = foreground !== value;
  foreground = value;
  if (!value) {
    outputHaptics.stop();
  }
  if (changed) for (const listener of lifecycleListeners) listener();
}
export function hapticsCanTrack() { return available(); }
export function subscribeHapticsLifecycle(listener: () => void) {
  lifecycleListeners.add(listener);
  const visibility = () => {
    setHapticsForeground(!document.hidden);
  };
  document.addEventListener("visibilitychange", visibility);
  const unsubscribe = subscribeHapticPreferences(() => {
    outputHaptics.stop();
    listener();
  });
  return () => {
    lifecycleListeners.delete(listener);
    document.removeEventListener("visibilitychange", visibility);
    unsubscribe();
  };
}

export function previewOutputHaptics(onResult?: (result: HapticResult) => void) {
  if (!Capacitor.isNativePlatform() || !available()) {
    onResult?.(Capacitor.isNativePlatform() ? "inactive" : "native-required");
    return () => {};
  }
  const owner = {};
  outputHaptics.claim(owner);
  const report = (result: HapticResult) => onResult?.(result);
  previewListeners.add(report);
  let elapsed = 0;
  const timer = setInterval(() => {
    elapsed += 100;
    if (elapsed > 1500 || !hapticsCanTrack()) {
      clearInterval(timer);
      previewListeners.delete(report);
      outputHaptics.release(owner);
    } else outputHaptics.add(owner, elapsed < 700 ? 2 : 14);
  }, 100);
  return () => { clearInterval(timer); previewListeners.delete(report); outputHaptics.release(owner); };
}
