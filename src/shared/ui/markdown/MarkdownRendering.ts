import { createContext, type ReactNode } from "react";
import type { CodeHighlighterPlugin } from "@streamdown/code";

/** The renderer receives presentation settings and trusted media from its owner. */
export type MarkdownRendering = {
  code?: CodeHighlighterPlugin;
  codeThemeKey?: string;
  codePalette?: { background: string; foreground: string };
  media?: {
    allowedPrefixes: string[];
    accepts: (url: string) => boolean;
    render: (url: string, alt?: string) => ReactNode;
  };
};

export const MarkdownRenderingContext = createContext<MarkdownRendering>({});
