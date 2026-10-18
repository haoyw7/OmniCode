import { useId } from "react";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { Radio } from "../../../../../shared/ui/forms/Radio";
import {
  DESKTOP_SKIN_IDS,
  DESKTOP_SKIN_INFO,
  type DesktopSkinId,
  type DesktopSkinPreference,
} from "../../../../../shared/theme/desktopSkin";

/** The real palette paints a miniature conversation, independent of the active skin. */
function SkinScene({ skin }: { skin: DesktopSkinId }) {
  return (
    <span className="desktop-skin-scene" data-skin={skin} aria-hidden="true">
      <span className="desktop-skin-scene-sidebar">
        <span />
        <span />
        <span />
      </span>
      <span className="desktop-skin-scene-thread">
        <span className="desktop-skin-scene-message" />
        <span className="desktop-skin-scene-user" />
        <span className="desktop-skin-scene-message" />
        <span className="desktop-skin-scene-composer"><span /></span>
      </span>
    </span>
  );
}

export function DesktopSkinPicker({
  value,
  onChange,
}: {
  value: DesktopSkinPreference;
  onChange: (value: DesktopSkinPreference) => void;
}) {
  const { t } = useTranslation();
  const name = useId();
  const selected = value === "classic" ? "auto" : value;
  return (
    <div className="desktop-skin-picker" role="radiogroup" aria-label={t("Skin")}>
      {(["auto", ...DESKTOP_SKIN_IDS] as const).map((skin) => (
        <label key={skin} className="desktop-skin-option">
          <span className="desktop-skin-preview">
            {skin === "auto" ? (
              <span className="desktop-skin-preview-auto">
                <SkinScene skin="midnight" />
                <SkinScene skin="daylight" />
              </span>
            ) : <SkinScene skin={skin} />}
          </span>
          <span className="desktop-skin-option-label">
            <Radio
              name={name}
              value={skin}
              checked={selected === skin}
              onChange={() => onChange(skin)}
            />
            <span>{t(skin === "auto" ? "Automatic" : DESKTOP_SKIN_INFO[skin].label)}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
