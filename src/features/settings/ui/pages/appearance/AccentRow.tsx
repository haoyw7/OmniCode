import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { useRef, useState } from "react";
import { ColorPickerPopover, ColorSwatchRow } from "../../../../../shared/ui/ColorPickerPopover";
import { Popover } from "../../../../../shared/ui/Popover";
import {
  ACCENT_COLOR_DEFAULT,
  ACCENT_COLOR_PRESET_LABELS,
  ACCENT_COLOR_PRESETS,
} from "../../../model/appearance";
import { type AppearanceSettings } from "./useAppearanceSettings";
import { Row } from "../../settingsLayout";



export function AccentRow({ appearance }: { appearance: AppearanceSettings }) {
  const { t: uiT } = useTranslation();
  return (
    <Row
      id="accent-color"
      label={uiT("Accent color")}
      description={uiT(
        "Used for the composer send button and your message bubbles.",
      )}
    >
      <AccentColorPicker
        value={appearance.accentColor}
        onChange={appearance.onAccentColor}
      />
    </Row>
  );
}

function AccentColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const colorIndex = value
    ? ACCENT_COLOR_PRESETS.indexOf(
        value as (typeof ACCENT_COLOR_PRESETS)[number],
      )
    : -1;
  const presetIndex = value == null ? 0 : colorIndex >= 0 ? colorIndex + 1 : -1;

  return (
    <div ref={root} className="w-48">
      <ColorSwatchRow
        colors={["var(--color-content)", ...ACCENT_COLOR_PRESETS]}
        labels={["Default", ...ACCENT_COLOR_PRESET_LABELS]}
        colorIndex={presetIndex >= 0 ? presetIndex : undefined}
        customColor={presetIndex < 0 ? (value ?? undefined) : undefined}
        customPickerOpen={open}
        onPickIndex={(index) => {
          setOpen(false);
          onChange(
            index === 0
              ? ACCENT_COLOR_DEFAULT
              : (ACCENT_COLOR_PRESETS[index - 1] ?? ACCENT_COLOR_PRESETS[0]),
          );
        }}
        onToggleCustom={() => setOpen((current) => !current)}
      />
      <Popover
        open={open}
        anchor={root}
        side="bottom"
        align="end"
        width={248}
        onDismiss={() => setOpen(false)}
        className="px-2 pb-2"
      >
        <ColorPickerPopover
          value={value ?? ACCENT_COLOR_PRESETS[0]}
          onChange={onChange}
        />
      </Popover>
    </div>
  );
}
