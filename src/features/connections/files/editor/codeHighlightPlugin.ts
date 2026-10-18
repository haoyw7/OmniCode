import type {
  CodeHighlighterPlugin,
  HighlightResult,
  ThemeInput,
} from "@streamdown/code";
import {
  bundledLanguages,
  bundledLanguagesInfo,
  type BundledLanguage,
} from "shiki";
import {
  createCodeTokenizer,
  themeName,
  type CodeTokenizeRequest,
  type CodeTokenizeResponse,
  type CodeTokenizer,
} from "./codeTokenizer";

/**
 * `@streamdown/code` keeps every token result in a module-level Map that is
 * never evicted. Streamdown highlights a fence again on every streamed update,
 * so each partial version of every code block an agent wrote stayed in memory
 * for the life of the window. Its key (length plus the first and last 100
 * characters) also let different blocks share a result. This keeps the same
 * `CodeHighlighterPlugin` shape with a bounded LRU and an exact key, and loads
 * languages into one highlighter per theme pair instead of one per language.
 *
 * Mounted blocks hold their tokens in component state, so eviction only means
 * a remounted block briefly shows plain text while it is highlighted again.
 */
const DEFAULT_THEMES: [ThemeInput, ThemeInput] = [
  "github-light",
  "github-dark",
];
const MAX_ENTRIES = 100;
const MAX_CACHED_CHARS = 500_000;

type HighlightCallback = (result: HighlightResult) => void;

export type BoundedCodePlugin = CodeHighlighterPlugin & {
  /** Number of token results currently cached. */
  cachedResults(): number;
};

const aliases: Record<string, string> = Object.fromEntries(
  bundledLanguagesInfo.flatMap((info) =>
    (info.aliases ?? []).map((alias) => [alias, info.id]),
  ),
);
const supported = new Set(Object.keys(bundledLanguages));

function normalizeLanguage(language: string): string {
  const lower = language.trim().toLowerCase();
  return aliases[lower] ?? lower;
}

export function createBoundedCodePlugin(
  options: {
    themes?: [ThemeInput, ThemeInput];
    maxEntries?: number;
    maxChars?: number;
    /** Where grammars load and code is tokenized; the main thread by default. */
    tokenize?: CodeTokenizer;
  } = {},
): BoundedCodePlugin {
  const themes = options.themes ?? DEFAULT_THEMES;
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  const maxChars = options.maxChars ?? MAX_CACHED_CHARS;
  const tokenize = options.tokenize ?? createCodeTokenizer(maxChars);
  const results = new Map<string, HighlightResult>();
  const pending = new Map<string, Set<HighlightCallback>>();
  let cachedChars = 0;
  let completed:
    | { config: string; source: string; tokens: HighlightResult["tokens"] }
    | undefined;

  const remember = (key: string, result: HighlightResult) => {
    if (results.delete(key)) cachedChars -= key.length;
    // A block larger than the whole budget is delivered but never cached.
    if (key.length > maxChars) return;
    results.set(key, result);
    cachedChars += key.length;
    while (results.size > maxEntries || cachedChars > maxChars) {
      const oldest = results.keys().next().value;
      if (oldest === undefined) break;
      results.delete(oldest);
      cachedChars -= oldest.length;
    }
  };

  return {
    name: "shiki",
    type: "code-highlighter",
    supportsLanguage: (language) => supported.has(normalizeLanguage(language)),
    getSupportedLanguages: () => Array.from(supported) as BundledLanguage[],
    getThemes: () => themes,
    cachedResults: () => results.size,
    highlight({ code, language, themes: pair }, callback) {
      const lang = normalizeLanguage(language);
      const names = [themeName(pair[0]), themeName(pair[1])] as const;
      const key = `${lang}\u0000${names[0]}\u0000${names[1]}\u0000${code}`;
      const cached = results.get(key);
      if (cached) {
        // Refresh recency so blocks still on screen are evicted last.
        results.delete(key);
        results.set(key, cached);
        return cached;
      }
      const waiting = pending.get(key);
      if (waiting) {
        if (callback) waiting.add(callback);
        return null;
      }
      pending.set(key, new Set(callback ? [callback] : []));
      void tokenize(code, lang, pair)
        .then((result) => {
          const config = `${lang}\u0000${names[0]}\u0000${names[1]}`;
          // Worker messages clone token arrays. Restore complete-line identity
          // so memoized code rows survive streaming updates on the UI thread.
          if (
            completed?.config === config &&
            code.startsWith(completed.source)
          ) {
            for (let i = 0; i < completed.tokens.length; i += 1)
              result.tokens[i] = completed.tokens[i];
          }
          const boundary = code.lastIndexOf("\n") + 1;
          completed =
            boundary > 0 && boundary <= maxChars
              ? {
                  config,
                  source: code.slice(0, boundary),
                  tokens: result.tokens.slice(0, -1),
                }
              : undefined;
          remember(key, result);
          const callbacks = pending.get(key);
          pending.delete(key);
          callbacks?.forEach((notify) => notify(result));
        })
        .catch((error: unknown) => {
          pending.delete(key);
          console.error("[Code highlight] Failed to highlight code:", error);
        });
      return null;
    },
  };
}

/**
 * Tokenizes in a worker so grammar compilation and long blocks never hold the
 * window; a worker that cannot start or fails hands its work to the main
 * thread instead of leaving blocks unhighlighted.
 */
function createWorkerTokenizer(): CodeTokenizer {
  const fallback = createCodeTokenizer();
  let worker: Worker | null | undefined;
  let nextId = 0;
  const waiting = new Map<
    number,
    {
      request: CodeTokenizeRequest;
      resolve: (result: HighlightResult) => void;
      reject: (error: unknown) => void;
    }
  >();

  const retire = () => {
    worker?.terminate();
    worker = null;
    for (const { request, resolve, reject } of waiting.values()) {
      fallback(request.code, request.lang, request.themes).then(
        resolve,
        reject,
      );
    }
    waiting.clear();
  };

  const start = (): Worker | null => {
    if (worker !== undefined) return worker;
    try {
      worker = new Worker(
        new URL("./codeHighlight.worker.ts", import.meta.url),
        {
          type: "module",
        },
      );
    } catch {
      worker = null;
      return worker;
    }
    worker.onmessage = (event: MessageEvent<CodeTokenizeResponse>) => {
      const entry = waiting.get(event.data.id);
      if (!entry) return;
      waiting.delete(event.data.id);
      if ("result" in event.data) entry.resolve(event.data.result);
      else entry.reject(new Error(event.data.error));
    };
    worker.onerror = retire;
    return worker;
  };

  return (code, lang, themes) => {
    const active = start();
    if (!active) return fallback(code, lang, themes);
    return new Promise((resolve, reject) => {
      const request = { id: nextId++, code, lang, themes };
      waiting.set(request.id, { request, resolve, reject });
      try {
        active.postMessage(request);
      } catch {
        // A theme that cannot be cloned is tokenized here instead.
        waiting.delete(request.id);
        fallback(code, lang, themes).then(resolve, reject);
      }
    });
  };
}

export const boundedCode = createBoundedCodePlugin({
  tokenize: typeof Worker === "undefined" ? undefined : createWorkerTokenizer(),
});
