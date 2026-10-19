import { registerCustomTheme } from "@pierre/diffs";
import { codeThemeInput, codeThemeName, type CodeThemeSelection } from "../../../shared/theme/codeThemes";
import { loadCodeTheme } from "../../settings/model/codeAppearance";

/** Shared by the main-thread renderer and the worker pool's resolved themes. */
export const REVIEW_THEMES = {
  light: "omnicode-review-light",
  dark: "omnicode-review-dark",
} as const;

export function reviewThemes(selection?: CodeThemeSelection) {
  return Object.fromEntries((["light", "dark"] as const).map((scheme) => [
    scheme,
    (selection?.[scheme] ?? loadCodeTheme(scheme)) === `github-${scheme}`
      ? REVIEW_THEMES[scheme] : codeThemeName(selection?.[scheme] ?? loadCodeTheme(scheme)),
  ])) as Record<"light" | "dark", string>;
}

for (const scheme of ["light", "dark"] as const) {
  const id = `claude-${scheme}` as const;
  registerCustomTheme(codeThemeName(id), async () => codeThemeInput(id) as import("shiki").ThemeRegistration);
  registerCustomTheme(REVIEW_THEMES[scheme], async () => {
    const { bundledThemes } = await import("shiki");
    const { default: base } = await bundledThemes[`github-${scheme}`]();
    const foreground = scheme === "light" ? "#1a1a1a" : "#eaecf0";
    // Markdown colors from the supplied diff screenshot: neutral prose and
    // delimiters, green link labels, blue headings, no heading/bold font weight.
    return {
      ...base,
      name: REVIEW_THEMES[scheme],
      tokenColors: [
        ...(base.tokenColors ?? []),
        {
          scope: ["text.html.markdown", "markup.bold.markdown", "markup.italic.markdown", "markup.underline.link.markdown"],
          settings: { foreground, fontStyle: "" },
        },
        {
          scope: ["markup.heading.markdown", "entity.name.section.markdown"],
          settings: { foreground: scheme === "light" ? "#0073e6" : "#0099ff", fontStyle: "" },
        },
        {
          scope: ["string.other.link.title.markdown", "string.other.link.description.markdown"],
          settings: { foreground: scheme === "light" ? "#1e9e3c" : "#32d74b", fontStyle: "" },
        },
        {
          scope: ["punctuation.definition.heading.markdown", "punctuation.definition.bold.markdown", "punctuation.definition.italic.markdown", "punctuation.definition.string.begin.markdown", "punctuation.definition.string.end.markdown", "punctuation.definition.metadata.markdown"],
          settings: { foreground: "#898781", fontStyle: "" },
        },
      ],
    };
  });
}
