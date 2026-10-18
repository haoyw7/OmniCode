// Rewrites the compiled stylesheet so Settings → Appearance can resize text
// and override the reduced-motion preference without touching every class.
//
// - `font-size: 13px` and `font-size: var(--text-*)` become
//   `calc(<value> * var(--font-scale, 1))`. Containers pick which scale their
//   text follows by setting `--font-scale` (UI, content or code). Relative
//   sizes (em, %, rem keywords) already inherit the scaled parent size.
// - `@media (prefers-reduced-motion: reduce) { R }` is kept for the system
//   preference unless the user turned motion back on, and duplicated outside
//   the media query for users who asked to reduce motion explicitly.
//   `no-preference` queries are handled the same way in reverse.

const SCALABLE_FONT_SIZE = /^(-?\d*\.?\d+px|var\(--(?:text-[\w-]+|mobile-font-(?:xs|sm|md|lg|xl))\))$/;
const MOTION_QUERY =
  /^\(\s*prefers-reduced-motion\s*:\s*(reduce|no-preference)\s*\)$/;
const ALREADY_SCALED = "var(--font-scale";
// For each system query: the guard that keeps it unless the user overrode
// it, and the guard for users who forced the same outcome.
const MOTION_GUARDS = {
  reduce: [
    ':root:not([data-reduced-motion="off"])',
    ':root[data-reduced-motion="on"]',
  ],
  "no-preference": [
    ':root:not([data-reduced-motion="on"])',
    ':root[data-reduced-motion="off"]',
  ],
};

export function scaleFontSize(value) {
  const trimmed = value.trim();
  if (trimmed.includes(ALREADY_SCALED)) return value;
  const important = /\s*!important$/i.exec(trimmed);
  const core = important ? trimmed.slice(0, important.index) : trimmed;
  if (!SCALABLE_FONT_SIZE.test(core)) return value;
  return `calc(${core} * var(--font-scale, 1))`;
}

function guardSelector(selector, guard) {
  return selector
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return trimmed;
      // `:root`/`html` rules target the guard element itself.
      if (/^(:root|html)\b/.test(trimmed)) {
        return trimmed.replace(/^(:root|html)/, guard);
      }
      return `${guard} ${trimmed}`;
    })
    .join(", ");
}

function guardRules(container, guard) {
  container.walkRules((rule) => {
    // Keyframe steps are not selectors.
    if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) {
      return;
    }
    rule.selector = guardSelector(rule.selector, guard);
  });
}

/** @returns {import("postcss").Plugin} */
export default function fontScale() {
  return {
    postcssPlugin: "monocode-font-scale",
    OnceExit(root) {
      root.walkDecls("font-size", (decl) => {
        decl.value = scaleFontSize(decl.value);
      });
      root.walkAtRules("media", (atRule) => {
        const match = MOTION_QUERY.exec(atRule.params.trim());
        if (!match || atRule.raws.monocodeReducedMotion) return;
        atRule.raws.monocodeReducedMotion = true;
        const [systemGuard, forcedGuard] = MOTION_GUARDS[match[1]];
        const forced = atRule.clone();
        // Unwrap the clone: its rules apply whenever the user forces it.
        guardRules(forced, forcedGuard);
        guardRules(atRule, systemGuard);
        atRule.after((forced.nodes ?? []).map((node) => node.clone()));
      });
    },
  };
}
fontScale.postcss = true;
