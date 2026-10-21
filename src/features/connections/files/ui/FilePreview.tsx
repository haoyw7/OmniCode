import { Button } from "../../../../shared/ui/forms/Button";
import { cn } from "../../../../shared/lib/cn";
import { RotatingIcon } from "../../../../shared/ui/RotatingIcon";
import { motionGeometry } from "../../../../shared/motion/tokens";
import { useId, useMemo, useState } from "react";
import { isLongText, ReadonlyTextView } from "../../../../shared/ui/ReadonlyTextView";
import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { ChevronDown, CircleDashed, X } from "../../../../shared/ui/icons";
import { AnimatedCollapse } from "../../../../shared/ui/AnimatedCollapse";
import { MAX_PREVIEW_LINES } from "../../../../integrations/harness/core/preview";
import { formatInteger } from "../../../../shared/lib/numbers";
import { displayPath, resolveWorkspacePath } from "../../../../shared/lib/paths";
import type {
  ToolPreview,
  ToolPreviewLine,
} from "../../../sessions/model/session";
import { FileTypeIcon } from "./FileTypeIcon";

type Status = "pending" | "accepted" | "rejected";

const KEYWORDS = new Set([
  "import",
  "export",
  "from",
  "type",
  "interface",
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "switch",
  "case",
  "class",
  "struct",
  "enum",
  "extends",
  "implements",
  "new",
  "async",
  "await",
  "try",
  "catch",
  "throw",
  "true",
  "false",
  "null",
  "undefined",
  "this",
  "in",
  "of",
  "as",
  "is",
  "void",
  "public",
  "private",
  "protected",
  "static",
  "default",
  "package",
  "def",
  "func",
]);

type Props = {
  preview: ToolPreview;
  status: Status;
  cwd?: string;
  onOpenFile?: (path: string) => void;
  variant?: "card" | "list";
};

export function FilePreview({
  preview,
  status,
  cwd,
  onOpenFile,
  variant = "card",
}: Props) {
  const { t: uiT } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  const path = preview.path;
  const filePath = path ? (resolveWorkspacePath(path, cwd) ?? path) : undefined;
  const fileName = preview.fileName || fileNameOf(path);
  const lines = useMemo(() => (preview.lines ?? [])
    .filter(
      (line) =>
        line.kind === "add" || line.kind === "del" || line.kind === "context",
    )
    .slice(0, variant === "list" ? undefined : MAX_PREVIEW_LINES), [preview.lines, variant]);
  const longDiff = useMemo(() => {
    if (variant !== "list") return undefined;
    const text = lines.map(line => `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.number ?? ""}\t${line.text}`).join("\n");
    return isLongText(text) ? text : undefined;
  }, [lines, variant]);
  const showDiff =
    preview.contentOnly ||
    lines.some((line) => line.kind === "add" || line.kind === "del");
  const added = preview.additions ?? 0;
  const deleted = preview.deletions ?? 0;
  const label = path
    ? displayPath(path, cwd)
    : fileName || preview.title || "File";

  if (variant === "list") {
    return (
      <section className="file-preview-list min-w-0 border-y border-content/10">
        <Button variant="ghost" size="content"
          type="button"
          className="flex min-h-11 w-full items-center justify-start gap-3 bg-content/3 px-4 py-2 text-left"
          aria-expanded={expanded}
          aria-controls={contentId}
          title={path}
          onClick={() => setExpanded((value) => !value)}
        >
          <RotatingIcon icon={ChevronDown} angle={expanded ? 0 : -motionGeometry.disclosureAngle} className="size-4 shrink-0 text-content/45" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-content/90">
            {label}
          </span>
          <span className="flex shrink-0 gap-2 text-[12px] tabular-nums">
            <span className="text-success dark:text-success">
              +{formatInteger(added)}
            </span>
            <span className="text-danger dark:text-danger">
              -{formatInteger(deleted)}
            </span>
          </span>
          <StatusIcon status={status} />
        </Button>
        <AnimatedCollapse
          expanded={expanded}
          motion="height"
          animateContentResize
        >
          <div
            id={contentId}
            className="select-text overflow-x-auto border-t border-content/10 py-2"
            tabIndex={0}
            aria-label={uiT("Preview lines")}
          >
            {preview.contentOnly && !lines.length ? (
              <p className="px-4 py-2 font-mono text-xs text-content/50">
                {uiT("Empty file")}
              </p>
            ) : null}
            {longDiff !== undefined ? <ReadonlyTextView text={longDiff} diff stateKey={`diff:${path ?? contentId}`} /> : <div className="w-max min-w-full">
              {lines.map((line, index) => (
                <PreviewLine
                  key={`${line.number ?? index}-${line.kind}-${index}`}
                  line={line}
                  showGutter={false}
                  scrollable
                  list
                />
              ))}
            </div>}
          </div>
        </AnimatedCollapse>
      </section>
    );
  }

  return (
    <div className="overflow-hidden rounded-[10px] border border-content/10 bg-content/6">
      <div className="flex items-center gap-2 px-2.5 py-2">
        <FileTypeIcon name={fileName || "file"} isDir={false} />
        {filePath && onOpenFile ? (
          <Button variant="ghost" size="content"
            type="button"
            className="block min-w-0 flex-1 truncate text-left font-mono text-[12px] font-medium text-content/85 hover:text-accent hover:underline"
            title={path}
            onClick={() => onOpenFile(filePath)}
          >
            {label}
          </Button>
        ) : (
          <span
            className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium text-content/85"
            title={path}
          >
            {label}
          </span>
        )}
        {added > 0 || deleted > 0 ? (
          <span className="shrink-0 font-sans text-[11px] font-semibold tabular-nums">
            {added > 0 ? (
              <span className="text-success">+{formatInteger(added)}</span>
            ) : null}
            {added > 0 && deleted > 0 ? " " : null}
            {deleted > 0 ? (
              <span className="text-danger">-{formatInteger(deleted)}</span>
            ) : null}
          </span>
        ) : (
          <StatusIcon status={status} />
        )}
      </div>
      {showDiff ? (
        <>
          <div className="h-px bg-content/10" />
          <div>
            {preview.contentOnly && !lines.length ? (
              <p className="px-3 py-2 font-mono text-xs text-content/50">
                {uiT("Empty file")}
              </p>
            ) : null}
            {lines.map((line, index) => (
              <PreviewLine
                key={`${line.number ?? index}-${line.kind}-${index}`}
                line={line}
                showGutter
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function PreviewLine({
  line,
  showGutter,
  scrollable = false,
  list = false,
}: {
  line: ToolPreviewLine;
  showGutter: boolean;
  scrollable?: boolean;
  list?: boolean;
}) {
  const bg =
    line.kind === "add"
      ? "bg-accent/20"
      : line.kind === "del"
        ? "bg-danger/20"
        : "";
  const bar =
    line.kind === "add"
      ? "bg-accent"
      : line.kind === "del"
        ? "bg-danger"
        : "bg-transparent";
  const mark = line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
  const markColor =
    line.kind === "add"
      ? "text-accent"
      : line.kind === "del"
        ? "text-danger"
        : "text-transparent";

  return (
    <div
      className={cn("relative flex items-baseline", scrollable ? "w-max min-w-full" : "", bg)}
    >
      <span className={cn("absolute inset-y-0 left-0 w-0.5", bar)} />
      <span
        className={
          list
            ? "w-10 shrink-0 border-r border-content/8 pr-2 text-right font-mono text-[12px] text-content/45"
            : "w-7 shrink-0 pr-1 text-right font-mono text-[10px] text-content/35"
        }
      >
        {line.number ?? " "}
      </span>
      {showGutter ? (
        <span
          className={cn("w-3 shrink-0 text-center font-mono text-[10px] font-bold", markColor)}
        >
          {mark}
        </span>
      ) : null}
      <span
        className={cn("min-w-0 flex-1 pr-2 font-mono", list ? "pl-3 text-[13px] leading-6 text-content/90" : "text-[11px] leading-4.5", scrollable ? "whitespace-pre" : "truncate")}
      >
        {list
          ? line.text || " "
          : highlight(line.text, line.kind === "context")}
      </span>
    </div>
  );
}

function StatusIcon({ status }: { status: Status }) {
  if (status === "rejected") {
    return <X className="size-3.5 shrink-0 text-danger" />;
  }
  if (status === "pending") {
    return <CircleDashed className="size-3.5 shrink-0 text-content/40" />;
  }
  return null;
}

function highlight(text: string, dimmed: boolean) {
  const dim = dimmed ? "opacity-70" : "";
  const trimmed = text.trimStart();
  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("///") ||
    trimmed.startsWith("#")
  ) {
    return <span className={cn("text-content/45", dim)}>{text}</span>;
  }

  const parts: { text: string; color: string }[] = [];
  const regex = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    if (match.index > last) {
      parts.push({ text: text.slice(last, match.index), color: "" });
    }
    const token = match[1];
    const color = KEYWORDS.has(token)
      ? "text-accent"
      : /^[A-Z]/.test(token)
        ? "text-warning/90"
        : "";
    parts.push({ text: token, color });
    last = match.index + token.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), color: "" });

  return (
    <span className={cn("text-content/80", dim)}>
      {parts.map((part, index) =>
        part.color ? (
          <span key={index} className={part.color}>
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </span>
  );
}

function fileNameOf(path?: string): string | undefined {
  if (!path) return undefined;
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1];
}
