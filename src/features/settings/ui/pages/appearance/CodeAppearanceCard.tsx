import { useEffect, useState, type CSSProperties } from "react";
import type { HighlightResult } from "@streamdown/code";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { CODE_THEMES, type CodeColorScheme, type CodeThemeId } from "../../../../../shared/theme/codeThemes";
import { SearchableSelect } from "../../../../../shared/ui/SearchableSelect";
import { Input } from "../../../../../shared/ui/forms/Input";
import { boundedCode } from "../../../../connections/files/editor/codeHighlightPlugin";
import { codeHighlightThemes, saveCodeTheme, useCodeThemePalette, useCodeThemes } from "../../../model/codeAppearance";
import { normalizeFontFamily } from "../../../model/typography";
import { Group, Row } from "../../settingsLayout";
import type { AppearanceSettings } from "./useAppearanceSettings";

const SAMPLE_LINES = [
  "function greet(name: string) {",
  '  return "Hello, " + name;',
  '  return `Hello, ${name}!`;',
  "}",
];

function CodeThemePreview({ scheme, theme, result, font }: {
  scheme: CodeColorScheme;
  theme: CodeThemeId;
  result?: HighlightResult;
  font: string;
}) {
  const { t } = useTranslation();
  const palette = useCodeThemePalette(theme);
  const style = {
    background: palette.background,
    color: palette.foreground,
    fontFamily: font ? `"${normalizeFontFamily(font)}", var(--font-mono)` : "var(--font-mono)",
    "--code-preview-muted": palette.comment,
    "--code-preview-addition": palette.addition,
    "--code-preview-deletion": palette.deletion,
    "--code-preview-addition-word": palette.additionWord,
    "--code-preview-deletion-word": palette.deletionWord,
    "--code-preview-added": palette.added,
    "--code-preview-removed": palette.removed,
  } as CSSProperties;
  return (
    <div className="settings-code-preview" style={style} role="img"
      aria-label={t(scheme === "light" ? "Light code theme preview" : "Dark code theme preview")}>
      {SAMPLE_LINES.map((line, index) => {
        const change = index === 1 ? "deletion" : index === 2 ? "addition" : undefined;
        const changedStart = change ? line.indexOf(index === 1 ? '"' : "`") : -1;
        const changedEnd = change ? line.lastIndexOf(index === 1 ? "+" : "`") + 1 : -1;
        let offset = 0;
        const tokens: HighlightResult["tokens"][number] = result?.tokens[index] ?? [{ content: line, offset: 0 }];
        return (
          <div key={index} className="settings-code-preview-line" data-change={change}>
            <span className="settings-code-preview-number">{index > 1 ? index : index + 1}</span>
            <span className="settings-code-preview-sign">{index === 1 ? "−" : index === 2 ? "+" : ""}</span>
            <code>{tokens.map((token, tokenIndex) => {
              const start = offset;
              offset += token.content.length;
              const cuts = [start, ...[changedStart, changedEnd].filter((cut) => cut > start && cut < offset), offset];
              const color = scheme === "dark"
                ? token.htmlStyle?.["--shiki-dark"] ?? token.color
                : token.htmlStyle?.color ?? token.color;
              return <span key={tokenIndex} style={{ color }}>
                {cuts.slice(0, -1).map((cut, part) => <span key={part}
                  data-word-change={change && cut >= changedStart && cut < changedEnd ? "" : undefined}>
                  {token.content.slice(cut - start, cuts[part + 1] - start)}
                </span>)}
              </span>;
            })}</code>
          </div>
        );
      })}
    </div>
  );
}

export function CodeAppearanceCard({ appearance }: { appearance: AppearanceSettings }) {
  const { t } = useTranslation();
  const themes = useCodeThemes();
  const themeKey = `${themes.light}:${themes.dark}`;
  const [preview, setPreview] = useState<{ key: string; result: HighlightResult }>();
  const [font, setFont] = useState(appearance.profile.codeFont);
  useEffect(() => setFont(appearance.profile.codeFont), [appearance.profile.codeFont]);
  useEffect(() => {
    let current = true;
    const apply = (result: HighlightResult) => { if (current) setPreview({ key: themeKey, result }); };
    const cached = boundedCode.highlight({ code: SAMPLE_LINES.join("\n"), language: "typescript", themes: codeHighlightThemes() }, apply);
    if (cached) apply(cached);
    return () => { current = false; };
  }, [themeKey]);
  const commitFont = () => {
    const next = normalizeFontFamily(font);
    setFont(next);
    if (next !== appearance.profile.codeFont) appearance.updateProfile({ codeFont: next });
  };

  return (
    <Group id="code-appearance" title={t("Code appearance")}>
      <div className="settings-code-themes">
        {(["light", "dark"] as const).map((scheme) => <div className="settings-code-theme" key={scheme}>
          <SearchableSelect
            label={t(scheme === "light" ? "Light code theme" : "Dark code theme")}
            value={themes[scheme]}
            options={CODE_THEMES[scheme]}
            searchable={false} checkPosition="end" commitOnTab maxHeight={320}
            onChange={(value) => saveCodeTheme(scheme, value)}
          />
          <CodeThemePreview scheme={scheme} theme={themes[scheme]} result={preview?.key === themeKey ? preview.result : undefined} font={appearance.profile.codeFont} />
        </div>)}
      </div>
      <Row id="code-font" label={t("Code font")} description={t("Set a custom monospace font for code and terminal.")}>
        <Input aria-label={t("Code font")} value={font} placeholder={t("e.g. {font}", { font: "JetBrains Mono" })}
          spellCheck={false} className="w-60 max-w-full"
          onChange={(event) => setFont(event.currentTarget.value)} onBlur={commitFont}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
      </Row>
    </Group>
  );
}
