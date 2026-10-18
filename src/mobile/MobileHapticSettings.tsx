import { Switch } from "../shared/ui/forms/Switch";
import { MobileSelect } from "./MobileSelect";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../shared/i18n/useTranslation";
import { useHapticPreferences, saveHapticPreferences } from "./hapticPreferences";
import { previewOutputHaptics, type HapticResult } from "./haptics";
import { MobileSettingsIcon } from "./MobileSettingsIcon";
import { AnimatedCollapse } from "../shared/ui/AnimatedCollapse";

const resultMessages: Record<HapticResult, string> = {
  requested: "Vibration requested. If you felt nothing, check system vibration settings and install the latest APK.",
  "system-disabled": "Touch vibration is disabled in system settings.",
  unavailable: "No vibration motor is available on this device.",
  inactive: "Keep the app in the foreground to try vibration.",
  failed: "Vibration could not be started. Install the latest APK and try again.",
  "native-required": "Vibration requires the installed mobile app.",
};

export function MobileHapticSettings() {
  const { t } = useTranslation();
  const [strengthOpen, setStrengthOpen] = useState(false);
  const [previewResult, setPreviewResult] = useState<HapticResult>();
  const preferences = useHapticPreferences();
  const stopPreview = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => stopPreview.current?.(), []);
  return <>
    {(["interactions", "output"] as const).map((key) => (
      <div className="mobile-settings-row mobile-settings-notifications" key={key}>
        <MobileSettingsIcon name={key === "interactions" ? "haptics" : "outputHaptics"} />
        <label className="mobile-settings-label">
          <span>{t(key === "interactions" ? "Interaction haptics" : "AI output haptics")}</span>
          <Switch checked={preferences[key]}
            onCheckedChange={(checked) => saveHapticPreferences({ ...preferences, [key]: checked })} />
        </label>
      </div>
    ))}
    <div className="mobile-settings-row">
      <MobileSettingsIcon name="intensity" />
      <label className="mobile-settings-label" htmlFor="output-haptic-strength">
        <span>{t("Output haptic strength")}</span>
      </label>
      <MobileSelect id="output-haptic-strength" label={t("Output haptic strength")}
        value={preferences.strength} disabled={!preferences.output}
        open={strengthOpen} onOpenChange={setStrengthOpen}
        options={[{ value: "gentle", label: t("Gentle") }, { value: "standard", label: t("Standard") }]}
        onChange={(strength) => saveHapticPreferences({ ...preferences, strength })} />
    </div>
    <button type="button" className="mobile-settings-row mobile-settings-action" disabled={!preferences.output} onClick={() => {
      stopPreview.current?.();
      stopPreview.current = previewOutputHaptics(setPreviewResult);
    }}>
      <MobileSettingsIcon name="play" />
      <span className="mobile-settings-label">{t("Try output haptics")}</span>
    </button>
    <AnimatedCollapse expanded={previewResult !== undefined}>
      <div className="mobile-settings-row mobile-settings-note" role="status">
        <span className="mobile-muted">{previewResult && t(resultMessages[previewResult])}</span>
      </div>
    </AnimatedCollapse>
  </>;
}
