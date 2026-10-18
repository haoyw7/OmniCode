import { SearchableSelect } from "../../../../../shared/ui/SearchableSelect";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { useEffect, useState } from "react";
import { Input } from "../../../../../shared/ui/forms/Input";
import {
  CODE_FONT_PRESETS,
  CONTENT_FONT_PRESETS,
  CONTRAST_MAX,
  CONTRAST_MIN,
  FONT_SIZE_LIMITS,
  FONT_WEIGHT_LABELS,
  FONT_WEIGHTS,
  loadSystemFonts,
  normalizeFontFamily,
  type FontSizeKind,
  type FontWeight,
  type SystemFonts,
} from "../../../model/typography";
import { type AppearanceSettings } from "./useAppearanceSettings";
import { Group, LiveSlider, Row, Segmented, Slider, Toggle } from "../../settingsLayout";
import { AccentRow } from "./AccentRow";



const CUSTOM_FONT = "__custom__";

/** Installed families, or `fallback` until/unless the backend answers. */
function useSystemFonts(
  kind: keyof SystemFonts,
  fallback: readonly string[],
): readonly string[] {
  const [fonts, setFonts] = useState<readonly string[] | null>(null);
  useEffect(() => {
    let alive = true;
    void loadSystemFonts().then((fonts) => {
      const list = fonts[kind];
      if (alive && list.length > 0) setFonts(list);
    });
    return () => {
      alive = false;
    };
  }, [kind]);
  return fonts ?? fallback;
}

/** Installed font list plus a free-text family for anything else. */
function FontFamilySelect({
  label,
  value,
  defaultLabel,
  presets,
  monospace = false,
  onChange,
}: {
  label: string;
  value: string;
  defaultLabel: string;
  presets: readonly string[];
  /** Code fonts list only fixed-pitch families. */
  monospace?: boolean;
  onChange: (value: string) => void;
}) {
  const { t: uiT } = useTranslation();
  presets = useSystemFonts(monospace ? "monospace" : "all", presets);
  const isPreset = value === "" || presets.includes(value);
  const [custom, setCustom] = useState(!isPreset);
  const [draft, setDraft] = useState(isPreset ? "" : value);
  useEffect(() => {
    if (value !== "" && !presets.includes(value)) {
      setCustom(true);
      setDraft(value);
    }
  }, [value, presets]);

  const commit = () => {
    const next = normalizeFontFamily(draft);
    setDraft(next);
    if (next !== value) onChange(next);
  };

  return (
    <>
      {custom ? (
        <Input
          size="lg"
          value={draft}
          aria-label={uiT("Custom {font}", { font: label })}
          placeholder={uiT("Font name")}
          spellCheck={false}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="w-36 rounded-lg"
        />
      ) : null}
      <div className="w-40">
        <SearchableSelect searchable={false} align="end" width={280} maxHeight={320} commitOnTab checkPosition="end" className="max-w-52"
          label={label}
          menuClassName="settings-font-select-menu"
          value={custom ? CUSTOM_FONT : value}
          options={[
            { value: "", label: defaultLabel },
            ...presets.map((font) => ({ value: font, label: font })),
            { value: CUSTOM_FONT, label: uiT("Custom…") },
          ]}
          onChange={(next) => {
            if (next === CUSTOM_FONT) {
              setCustom(true);
              return;
            }
            setCustom(false);
            setDraft("");
            onChange(next);
          }}
        />
      </div>
    </>
  );
}

function FontWeightSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: FontWeight;
  onChange: (value: FontWeight) => void;
}) {
  const { t: uiT } = useTranslation();
  return (
    <div className="w-28">
      <SearchableSelect searchable={false} align="end" width={280} maxHeight={320} commitOnTab checkPosition="end" className="max-w-52"
        label={label}
        menuClassName="settings-font-select-menu"
        value={String(value)}
        options={FONT_WEIGHTS.map((weight) => ({
          value: String(weight),
          label: uiT(FONT_WEIGHT_LABELS[weight]),
        }))}
        onChange={(next) => onChange(Number(next) as FontWeight)}
      />
    </div>
  );
}

/** Sizes, motion and the per-mode font/contrast card (ZCode settings cards). */
export function TypographyCards({ appearance }: { appearance: AppearanceSettings }) {
  const { t: uiT } = useTranslation();
  const { profile, updateProfile } = appearance;
  const sizeRows: { kind: FontSizeKind; label: string; description: string }[] =
    [
      {
        kind: "ui",
        label: uiT("Interface font size"),
        description: uiT("Adjust the base font size of OmniCode."),
      },
      {
        kind: "content",
        label: uiT("Content font size"),
        description: uiT("Adjust the base font size of conversations and documents."),
      },
      {
        kind: "code",
        label: uiT("Code font size"),
        description: uiT(
          "Adjust the base font size of code in chat and diff views.",
        ),
      },
    ];

  return (
    <>
      <Group>
        {sizeRows.map((row) => (
          <Row
            key={row.kind}
            id={`${row.kind}-font-size`}
            label={row.label}
            description={row.description}
          >
            <FontSizeSlider
              label={row.label}
              value={appearance.fontSizes[row.kind]}
              min={FONT_SIZE_LIMITS[row.kind].min}
              max={FONT_SIZE_LIMITS[row.kind].max}
              onChange={(value) => appearance.onFontSize(row.kind, value)}
            />
          </Row>
        ))}
      </Group>

      <Group>
        <Row
          id="reduced-motion"
          label={uiT("Reduce motion")}
          description={uiT(
            "Reduce animations, or follow the system setting.",
          )}
        >
          <Segmented
            label={uiT("Reduce motion")}
            value={appearance.reducedMotion}
            options={[
              { value: "system", label: uiT("System") },
              { value: "on", label: uiT("On") },
              { value: "off", label: uiT("Off") },
            ]}
            onChange={appearance.onReducedMotion}
          />
        </Row>
        <Row
          id="separate-schemes"
          label={uiT("Separate light and dark settings")}
          description={uiT(
            "Choose colors, fonts and contrast for each mode separately.",
          )}
        >
          <Toggle
            label={uiT("Separate light and dark settings")}
            on={appearance.separateSchemes}
            onChange={appearance.onSeparateSchemes}
          />
        </Row>
      </Group>

      <Group>
        {appearance.separateSchemes ? (
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <span className="text-ui-base font-medium text-foreground">
              {uiT("Editing")}
            </span>
            <Segmented
              label={uiT("Editing")}
              value={appearance.editingScheme}
              options={[
                { value: "light", label: uiT("Light") },
                { value: "dark", label: uiT("Dark") },
              ]}
              onChange={appearance.onEditingScheme}
            />
          </div>
        ) : null}
        {appearance.separateSchemes ? (
          <>
            <AccentRow appearance={appearance} />
          </>
        ) : null}
        <Row id="ui-font-weight" label={uiT("Interface font")}>
          <FontFamilySelect
            label={uiT("Interface font")}
            value={profile.uiFont}
            defaultLabel={uiT("System")}
            presets={CONTENT_FONT_PRESETS}
            onChange={(uiFont) => updateProfile({ uiFont })}
          />
          <FontWeightSelect
            label={uiT("Interface font style")}
            value={profile.uiWeight}
            onChange={(uiWeight) => updateProfile({ uiWeight })}
          />
        </Row>
        <Row id="content-font" label={uiT("Content font")}>
          <FontFamilySelect
            label={uiT("Content font")}
            value={profile.contentFont}
            defaultLabel={uiT("Same as interface font")}
            presets={CONTENT_FONT_PRESETS}
            onChange={(contentFont) => updateProfile({ contentFont })}
          />
          <FontWeightSelect
            label={uiT("Content font style")}
            value={profile.contentWeight}
            onChange={(contentWeight) => updateProfile({ contentWeight })}
          />
        </Row>
        <Row id="code-font" label={uiT("Code font")}>
          <FontFamilySelect
            label={uiT("Code font")}
            value={profile.codeFont}
            defaultLabel={uiT("Default (Anthropic Mono)")}
            presets={CODE_FONT_PRESETS}
            monospace
            onChange={(codeFont) => updateProfile({ codeFont })}
          />
          <FontWeightSelect
            label={uiT("Code font style")}
            value={profile.codeWeight}
            onChange={(codeWeight) => updateProfile({ codeWeight })}
          />
        </Row>
        <Row id="contrast" label={uiT("Contrast")}>
          <LiveSlider
            label={uiT("Contrast")}
            value={profile.contrast}
            format={String}
            min={CONTRAST_MIN}
            max={CONTRAST_MAX}
            preview={(contrast) => appearance.previewProfile({ contrast })}
            onChange={(contrast) => updateProfile({ contrast })}
          />
        </Row>
      </Group>
    </>
  );
}

/** Shows the size while dragging; applies it only on release (no re-layout per frame). */
function FontSizeSlider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Slider
      label={label}
      value={draft}
      display={`${draft}px`}
      min={min}
      max={max}
      onChange={setDraft}
      onCommit={(next) => {
        if (next !== value) onChange(next);
      }}
    />
  );
}
