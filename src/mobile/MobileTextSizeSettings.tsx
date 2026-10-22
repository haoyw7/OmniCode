import { useTranslation } from "../shared/i18n/useTranslation";
import { Button } from "../shared/ui/forms/Button";
import { Slider } from "../shared/ui/forms/Slider";
import {
  MOBILE_TEXT_SIZE,
  saveMobileTextSize,
  useMobileTextSize,
} from "./textSize";

export function MobileTextSizeSettings() {
  const { t } = useTranslation();
  const size = useMobileTextSize();
  return (
    <section
      className="mobile-settings-group"
      aria-labelledby="mobile-text-size-label"
    >
      <h2 id="mobile-text-size-label">{t("Text size")}</h2>
      <div className="mobile-settings-card">
        <div className="mobile-text-size-card">
          <div className="mobile-text-size-heading">
            <span aria-hidden="true">Aa</span>
            <output htmlFor="mobile-text-size">{size}%</output>
            <span aria-hidden="true">Aa</span>
          </div>
          <Slider
            id="mobile-text-size"
            aria-labelledby="mobile-text-size-label"
            aria-valuetext={`${size}%`}
            min={MOBILE_TEXT_SIZE.min}
            max={MOBILE_TEXT_SIZE.max}
            step={MOBILE_TEXT_SIZE.step}
            value={[size]}
            onValueChange={([value]) => saveMobileTextSize(value)}
          />
          <div
            className="mobile-text-size-preview"
            role="region"
            aria-label={t("Conversation preview")}
          >
            <p className="mobile-text-size-question">
              {t("What is the truth of the universe?")}
            </p>
            <p>{t("The universe is a vast system of laws and mysteries.")}</p>
          </div>
          <Button
            variant="ghost"
            onClick={() => saveMobileTextSize(MOBILE_TEXT_SIZE.default)}
          >
            {t("Reset")}
          </Button>
        </div>
      </div>
      <p className="mobile-settings-footer">
        {t("Adjust text size on this device. Changes apply immediately.")}
      </p>
    </section>
  );
}
