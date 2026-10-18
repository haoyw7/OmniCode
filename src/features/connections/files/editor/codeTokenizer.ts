import type { HighlightResult, ThemeInput } from "@streamdown/code";
import {
  bundledLanguages,
  createHighlighter,
  type BundledLanguage,
  type GrammarState,
} from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

type Highlighter = Awaited<ReturnType<typeof createHighlighter>>;

export type CodeTokenizer = (
  code: string,
  lang: string,
  themes: [ThemeInput, ThemeInput],
) => Promise<HighlightResult>;

export type CodeTokenizeRequest = {
  id: number;
  code: string;
  lang: string;
  themes: [ThemeInput, ThemeInput];
};

export type CodeTokenizeResponse =
  { id: number; result: HighlightResult } | { id: number; error: string };

const supported = new Set(Object.keys(bundledLanguages));

export function themeName(theme: ThemeInput): string {
  return typeof theme === "string" ? theme : (theme.name ?? "custom");
}

/**
 * Loads languages into one highlighter per theme pair and tokenizes with it.
 * Shared by the highlight worker and the main-thread fallback.
 */
export function createCodeTokenizer(maxChars = 500_000): CodeTokenizer {
  const engine = createJavaScriptRegexEngine({ forgiving: true });
  const highlighters = new Map<string, Promise<Highlighter>>();
  // Grammar state stays inside the worker (or its fallback). Only the newest
  // fence's complete lines are retained, within the same source-size budget.
  let checkpoint:
    | {
        config: string;
        source: string;
        tokens: HighlightResult["tokens"];
        state: GrammarState | undefined;
      }
    | undefined;

  const highlighterFor = (pair: [ThemeInput, ThemeInput]) => {
    const key = `${themeName(pair[0])}\u0000${themeName(pair[1])}`;
    let highlighter = highlighters.get(key);
    if (!highlighter) {
      highlighter = createHighlighter({ themes: pair, langs: [], engine });
      highlighters.set(key, highlighter);
      highlighter.catch(() => highlighters.delete(key));
    }
    return highlighter;
  };

  return async (code, lang, pair) => {
    const highlighter = await highlighterFor(pair);
    if (
      supported.has(lang) &&
      !highlighter.getLoadedLanguages().includes(lang)
    ) {
      await highlighter.loadLanguage(lang as BundledLanguage);
    }
    const usable = highlighter.getLoadedLanguages().includes(lang)
      ? lang
      : "text";
    const config = `${usable}\u0000${themeName(pair[0])}\u0000${themeName(pair[1])}`;
    const previous =
      checkpoint?.config === config && code.startsWith(checkpoint.source)
        ? checkpoint
        : undefined;
    const offset = previous?.source.length ?? 0;
    const boundary = code.lastIndexOf("\n") + 1;
    const settings = {
      lang: usable as BundledLanguage,
      themes: { light: themeName(pair[0]), dark: themeName(pair[1]) },
    };
    let prefix = previous?.tokens ?? [];
    let state = previous?.state;
    if (boundary > offset) {
      const lineEnd = code[boundary - 2] === "\r" ? boundary - 2 : boundary - 1;
      const complete = highlighter.codeToTokens(code.slice(offset, lineEnd), {
        ...settings,
        grammarState: state,
      });
      prefix = [
        ...prefix,
        ...complete.tokens.map((line) =>
          line.map((token) => ({ ...token, offset: token.offset + offset })),
        ),
      ];
      state = complete.grammarState;
    }
    const tail = highlighter.codeToTokens(code.slice(boundary), {
      ...settings,
      grammarState: state,
    });
    checkpoint =
      boundary > 0 && boundary <= maxChars
        ? { config, source: code.slice(0, boundary), tokens: prefix, state }
        : undefined;
    // Shiki's grammar state is needed only for subsequent tokenization. Do not
    // serialize its internal stacks with every worker response.
    const { grammarState: _grammarState, ...highlight } = tail;
    return {
      ...highlight,
      tokens: [
        ...prefix,
        ...tail.tokens.map((line) =>
          line.map((token) => ({ ...token, offset: token.offset + boundary })),
        ),
      ],
    };
  };
}
