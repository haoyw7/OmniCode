import { memo, useMemo, useSyncExternalStore } from "react";

type Props = {
  name: string;
  isDir: boolean;
  isOpen?: boolean;
  isRoot?: boolean;
  size?: number;
};

type IconPack = typeof import("react-material-icon-theme");

/**
 * The Material icon pack inlines every glyph as a component — ~1.1 MB, the
 * single largest thing in the boot chunk, for 16px decorations. Load it after
 * first paint and hold a same-sized blank until it lands, so the app starts
 * without it and nothing reflows when it arrives.
 */
let pack: IconPack | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function loadPack() {
  if (pack || loading) return;
  loading = import("react-material-icon-theme").then((mod) => {
    pack = mod;
    for (const listener of listeners) listener();
  });
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  loadPack();
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getSnapshot() {
  return pack;
}

const MARKDOWN_FILE = /\.(md|markdown)$/i;
const MARKDOWN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="22 -21 170 170"><path fill="#42a5f5" d="M30 98V30h20l20 25 20-25h20v68H90V59L70 84 50 59v39zm125 0l-30-33h20V30h20v35h20z"/></svg>';

/** Filename maps to the matching Material Icon Theme icon. */
export const FileTypeIcon = memo(function FileTypeIcon({
  name,
  isDir,
  isOpen = false,
  isRoot = false,
  size = 16,
}: Props) {
  const icons = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // The pack draws Markdown (and README.md) as an info glyph; use the M↓ mark.
  const markdown = !isDir && MARKDOWN_FILE.test(name);
  const iconName = icons && !markdown
    ? isDir
      ? icons.getFolderIcon({ folderName: name, isOpen, isRoot })
      : resolveFileIcon(icons, name)
    : "";
  const svg = markdown ? MARKDOWN_SVG : (icons?.getIconSvg(iconName) ?? "");
  // React compares this prop by identity. A fresh object replaces the SVG
  // subtree even when the glyph is unchanged (for example, on resize).
  const markup = useMemo(() => ({ __html: svg }), [svg]);

  if (!icons && !markdown) {
    return (
      <span
        aria-hidden
        className="inline-block shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className="material-icon inline-block shrink-0 align-middle"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={markup}
    />
  );
});

/**
 * The package only checks `fileExtension` when that prop is set — it does not
 * peel an extension off `fileName`. Try the full name, then compound suffixes
 * (`d.ts`, then `ts`) so `.rs` / `.toml` / `.json` resolve by compound suffix.
 */
function resolveFileIcon(icons: IconPack, fileName: string): string {
  const key = fileName.toLowerCase();
  const fromName = icons.getFileIcon({
    fileName: key,
    fallback: "",
    iconPack: "",
  });
  if (fromName) return fromName;

  for (const ext of compoundExtensions(key)) {
    const fromExt = icons.getFileIcon({
      fileExtension: ext,
      fallback: "",
      iconPack: "",
    });
    if (fromExt) return fromExt;
  }

  return "file";
}

function compoundExtensions(fileName: string): string[] {
  const parts = fileName.split(".");
  const start = parts[0] === "" ? 1 : 0;
  const exts: string[] = [];
  for (let i = start + 1; i < parts.length; i++) {
    exts.push(parts.slice(i).join("."));
  }
  return exts;
}
