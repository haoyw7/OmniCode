import { useId } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Radio } from "../../../shared/ui/forms/Radio";
import { Omi } from "../../../shared/ui/branding/Omi";
import { avatarExpressions, avatarShapes, avatarTones, avatarVariants, type BotAvatarAppearance } from "./botAvatarAppearance";

const labels = {
  original: "Original", circle: "Circle", triangle: "Triangle", square: "Square",
  ready: "Ready", curious: "Curious", focused: "Focused", joyful: "Joyful",
  encouraging: "Encouraging", sleepy: "Sleepy", inspired: "Inspired", surprised: "Surprised",
  outline: "Outline", filled: "Filled",
  violet: "Violet", blue: "Blue", teal: "Teal", amber: "Amber", rose: "Rose", green: "Green",
} as const;
const groups = [
  { key: "shape", label: "Shape", options: avatarShapes },
  { key: "expression", label: "Expression", options: avatarExpressions },
  { key: "variant", label: "Fill style", options: avatarVariants },
  { key: "tone", label: "Color", options: avatarTones },
] as const;

export function BotAvatarPicker({ value, disabled, onChange }: {
  value: BotAvatarAppearance; disabled: boolean; onChange: (value: BotAvatarAppearance) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return <div className="desktop-bot-avatar-picker">
    {groups.map(group => <fieldset key={group.key} disabled={disabled} className="desktop-bot-avatar-options" data-part={group.key}>
      <legend>{t(group.label)}</legend>
      <div className="desktop-bot-avatar-option-grid">
        {group.options.map(option => {
          const appearance = { ...value, [group.key]: option };
          return <label key={option} className="desktop-bot-avatar-option" title={t(labels[option])}>
            <Radio name={`${id}-${group.key}`} value={option} checked={value[group.key] === option} aria-label={t(labels[option])} onChange={() => onChange(appearance)} />
            <span className="desktop-bot-avatar-option-content" style={{ color: `var(--color-omi-${appearance.tone}, currentColor)` }}>
              {group.key === "tone" ? <span className="desktop-bot-avatar-swatch" /> : <Omi compact expression={appearance.expression} shape={appearance.shape} variant={appearance.variant} width={32} height={32} aria-hidden="true" focusable="false" />}
              {group.key !== "tone" && <span>{t(labels[option])}</span>}
            </span>
          </label>;
        })}
      </div>
    </fieldset>)}
  </div>;
}
