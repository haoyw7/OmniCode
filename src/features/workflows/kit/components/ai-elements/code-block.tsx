// Monocode shim for ZCode's CodeBlock: a read-only scrollable code view.
import type { HTMLAttributes } from "react";
import { cn } from "../../../../../shared/lib/cn";

export function CodeBlock({ code, language, className, showLineNumbers, renderMermaid: _renderMermaid, ...props }: HTMLAttributes<HTMLDivElement> & { code: string; language?: string; showLineNumbers?: boolean; renderMermaid?: boolean }) {
  const lines = code.replace(/\n$/, "").split("\n");
  return (
    <div className={cn("overflow-auto rounded-md border border-border bg-surface", className)} data-language={language} {...props}>
      <pre className="m-0 p-3 font-mono text-ui-sm leading-relaxed text-foreground">
        {showLineNumbers
          ? lines.map((line, index) => (
              <div key={index} className="flex gap-3">
                <span className="w-8 shrink-0 select-none text-right text-foreground-subtlest">{index + 1}</span>
                <span className="whitespace-pre">{line}</span>
              </div>
            ))
          : <code>{code}</code>}
      </pre>
    </div>
  );
}
