import { useContext, useEffect, useMemo, useState, type CSSProperties } from "react";
import { isLongText, ReadonlyTextView } from "../shared/ui/ReadonlyTextView";
import { TranscriptPlatformContext } from "../features/sessions/ui/TranscriptPlatform";
import { AgentMarkdown } from "../features/sessions/ui/AgentMarkdown";
import { sniffImageMime } from "../features/connections/files/model/filePreview";
import { FileTypeIcon } from "../features/connections/files/ui/FileTypeIcon";
import { displayPath } from "../shared/lib/paths";
import { useTranslation } from "../shared/i18n/useTranslation";
import { MobileSheet, MobileSheetHeader } from "./MobileSheet";

/** Large files stay readable on a phone only up to a point; past it we just say so. */
export const MAX_PREVIEW_BYTES = 512 * 1024;
/** Match the Host's binary read limit; images do not use the text preview cap. */
export const MAX_IMAGE_PREVIEW_BYTES = 10 * 1024 * 1024;
/** Syntax highlighting gets slow on long files, so they fall back to plain text. */
const MAX_HIGHLIGHT_BYTES = 96 * 1024;

type Loaded =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "image"; url: string }
  | { kind: "image-error" }
  | { kind: "text"; text: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "large"; size: number };

export type FilePreviewContent = Exclude<
  Loaded,
  { kind: "loading" } | { kind: "error" } | { kind: "image" } | { kind: "image-error" }
>;

export function fileExtension(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Decode a host file for display, refusing binaries and very large files. */
export function decodePreview(bytes: Uint8Array): FilePreviewContent {
  if (bytes.length > MAX_PREVIEW_BYTES)
    return { kind: "large", size: bytes.length };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0")) return { kind: "binary", size: bytes.length };
    return { kind: "text", text, size: bytes.length };
  } catch {
    return { kind: "binary", size: bytes.length };
  }
}

/** Wrap source in a fence longer than any backtick run inside it. */
export function fencedSource(text: string, language: string): string {
  const longest = Math.max(
    2,
    ...(text.match(/`+/g) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}`;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** Read-only file preview for a phone, fed by the Host's workspace reads. */
export function MobileFileSheet({
  open = true,
  onExited,
  path,
  line,
  cwd,
  readBinaryFile,
  onOpenFile,
  onBack,
  onClose,
  embedded = false,
}: {
  embedded?: boolean;
  open?: boolean;
  onExited?: () => void;
  path: string;
  line?: number;
  cwd?: string;
  readBinaryFile: (path: string) => Promise<Uint8Array>;
  onOpenFile?: (path: string) => void;
  onBack?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { copyText } = useContext(TranscriptPlatformContext);
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const extension = fileExtension(path);
  const name = path.split(/[\\/]/).pop() || path;

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    setLoaded({ kind: "loading" });
    readBinaryFile(path)
      .then((bytes) => {
        if (cancelled) return;
        const imageType = sniffImageMime(bytes) ??
          (extension === "svg" ? "image/svg+xml" : null);
        if (imageType) {
          if (bytes.length > MAX_IMAGE_PREVIEW_BYTES) {
            setLoaded({ kind: "large", size: bytes.length });
            return;
          }
          objectUrl = URL.createObjectURL(
            new Blob([bytes as BlobPart], { type: imageType }),
          );
          setLoaded({ kind: "image", url: objectUrl });
          return;
        }
        setLoaded(decodePreview(bytes));
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setLoaded({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, extension, readBinaryFile]);

  const source = useMemo(() => {
    if (loaded.kind !== "text") return undefined;
    // Rendered markdown and highlighting are all-at-once; long files fall
    // back to the lazily rendered plain view.
    if (loaded.size > MAX_HIGHLIGHT_BYTES || isLongText(loaded.text)) return undefined;
    if (extension === "md" || extension === "markdown") return loaded.text;
    // A cited line needs the numbered plain view to scroll to it.
    if (line) return undefined;
    return fencedSource(loaded.text, extension);
  }, [loaded, extension, line]);

  // Bring a cited line into view once the text has rendered.
  useEffect(() => {
    if (!line || loaded.kind !== "text") return;
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(
        `.mobile-file-sheet [data-line="${line}"]`,
      );
      target?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [line, loaded]);

  // Source reads edge to edge like a diff; rendered markdown stays a document.
  const isDocument = (extension === "md" || extension === "markdown") &&
    source !== undefined;
  const view = loaded.kind === "text" && !isDocument ? "source" : undefined;
  // Size the line-number gutter to the widest number, so short files stay tight.
  const gutter = view && loaded.kind === "text"
    ? { "--mobile-file-gutter": `${String(loaded.text.split("\n").length).length}ch` } as CSSProperties
    : undefined;

  const content = (
      <div className="mobile-file-sheet" data-view={view} style={gutter}>
        {loaded.kind === "loading" ? (
          <p className="mobile-muted mobile-detail-note">{t("Loading…")}</p>
        ) : loaded.kind === "error" ? (
          <p className="mobile-form-error mobile-detail-note" role="alert">
            {t("Could not open this file.")} {loaded.message}
          </p>
        ) : loaded.kind === "image" ? (
          <div className="mobile-file-image-frame">
            <img
              key={loaded.url}
              className="mobile-file-image"
              src={loaded.url}
              alt={name}
              onError={() => setLoaded((current) =>
                current.kind === "image" && current.url === loaded.url
                  ? { kind: "image-error" }
                  : current,
              )}
            />
          </div>
        ) : loaded.kind === "image-error" ? (
          <p className="mobile-form-error mobile-detail-note" role="alert">
            {t("Could not display this image.")}
          </p>
        ) : loaded.kind === "binary" ? (
          <p className="mobile-muted mobile-detail-note">
            {t("Binary file ({size}) cannot be previewed.", {
              size: formatBytes(loaded.size),
            })}
          </p>
        ) : loaded.kind === "large" ? (
          <p className="mobile-muted mobile-detail-note">
            {t("File is too large to preview ({size}).", {
              size: formatBytes(loaded.size),
            })}
          </p>
        ) : source !== undefined ? (
          <AgentMarkdown
            className="mobile-file-markdown"
            text={source}
            cwd={cwd}
            onOpenFile={onOpenFile}
          />
        ) : (
          isLongText(loaded.text)
            ? <ReadonlyTextView key={path} text={loaded.text} line={line} stateKey={`file:${path}`} onCopy={copyText} />
            : <PlainLines text={loaded.text} line={line} />
        )}
      </div>
  );
  const header = {
    className: "mobile-file-sheet-header",
    title: (
      <span className="mobile-file-sheet-name">
        <FileTypeIcon name={name} isDir={false} size={16} />
        <span title={name}>{name}</span>
      </span>
    ),
    subtitle: displayPath(path, cwd),
  };
  if (embedded) return <><MobileSheetHeader {...header} onBack={onBack} onClose={onClose} />
    <div className="mobile-sheet-page-scroll" data-mobile-page-scroll>{content}</div></>;
  return <MobileSheet open={open} onExited={onExited} title="File preview" onClose={onClose} onBack={onBack}
    detents surface="solid" header={header}>{content}</MobileSheet>;
}

/** Only short cited files reach this path; long sources use the virtual viewport. */
function PlainLines({ text, line }: { text: string; line?: number }) {
  const lines = useMemo(() => text.split("\n"), [text]);

  return (
    <>
      <pre className="mobile-detail-pre mobile-file-plain">
        {lines.map((text, index) => (
          <span
            key={index}
            data-line={index + 1}
            data-current={index + 1 === line ? "true" : undefined}
          >
            {text}
            {"\n"}
          </span>
        ))}
      </pre>
    </>
  );
}
