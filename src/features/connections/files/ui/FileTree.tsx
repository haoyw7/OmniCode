import { Button } from "../../../../shared/ui/forms/Button";
import { cn } from "../../../../shared/lib/cn";
import { Input } from "../../../../shared/ui/forms/Input";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../../shared/lib/queryClient";
import { errorMessage } from "../../../../shared/lib/errorMessage";
import { directoryQuery } from "../model/directoryQueries";
import { PresenceBoundary } from "../../../../shared/ui/PresenceBoundary";
import { DisclosureChevron } from "../../../../shared/ui/DisclosureChevron";
import { translate as translateUi } from "../../../../shared/i18n/language";
import { useTranslation } from "../../../../shared/i18n/useTranslation";
import {
  ChevronRight,
  FilePlus,
  FolderPlus,
  FoldVertical,
  Search,
} from "../../../../shared/ui/icons";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  leafName,
  validateFileName,
  wellFormedFileName,
  type NameIssue,
} from "../model/fileName";
import { useLockOverscroll } from "../../../../shared/hooks/useLockOverscroll";
import {
  loadShowExcludedFiles,
  subscribeShowExcludedFiles,
} from "../../../settings/model/appearance";
import {
  createParentOf,
  dirsTouchedByCreate,
  dirsTouchedByMove,
  forgetDir,
  loadExpanded,
  loadSelected,
  notifyDirsChanged,
  peekDir,
  refreshDir,
  saveExpanded,
  saveSelected,
} from "../model/fileTree";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { REMOTE_PATH_PREFIX } from "../../../../shared/lib/remotePaths";
import { dragPointToClient } from "../../../../shared/lib/dragPoint";
import {
  basename,
  listDir,
  clipboardFilePaths,
  copyPath,
  createPath,
  deletePath,
  movePath,
  renamePath,
  revealPath,
  type FsEntry,
} from "../../../../platform/tauri/fs";
import { displayPath, parentPath, rebasePath } from "../../../../shared/lib/paths";
import { IS_MAC, IS_WIN, MOD, SHIFT } from "../../../../platform/tauri/platform";
import type { OpenFileFn } from "../../../search/model/search";
import type { GitStatusMap } from "../../../source-control/hooks/useGitFileStatuses";
import { useDraggableItem, useActiveDragPayload } from "../../../../shared/ui/primitives/Sortable";
import { ActionMenu, type ActionMenuItem } from "../../../../shared/ui/primitives/ActionMenu";
import { FileTypeIcon } from "./FileTypeIcon";
import { AnimatedCollapse } from "../../../../shared/ui/AnimatedCollapse";
import { CollapsingVirtualRows } from "../../../../shared/ui/CollapsingVirtualRows";
import { Spinner } from "../../../../shared/ui/primitives/Spinner";

const GIT_STATUS_COLOR: Record<string, string> = {
  modified: "text-warning",
  added: "text-success",
  untracked: "text-success",
  deleted: "text-danger",
};

type Props = {
  cwd: string;
  compact?: boolean;
  activePath?: string;
  /** A transient file picker: local expansion/selection, navigation only. */
  navigationOnly?: boolean;
  /** Display identity for the root when it differs from the physical folder. */
  rootLabel?: string;
  onOpenFile: OpenFileFn;
  onOpenTerminal?: (cwd: string) => void;
  onFileMoved?: (from: string, to: string) => void;
  onFileDeleted?: (path: string) => void;
  onSearch?: () => void;
  gitStatuses?: GitStatusMap;
};

type Creating = { id: number; parent: string; isDir: boolean };
type Clip = { mode: "copy" | "cut"; path: string; isDir: boolean };
type MenuTarget = { path: string; isDir: boolean; isRoot: boolean };
type MenuState = { x: number; y: number; target: MenuTarget };

const REVEAL_LABEL = IS_MAC
  ? "Reveal in Finder"
  : IS_WIN
    ? "Reveal in File Explorer"
    : "Open Containing Folder";

type TreeCtxValue = {
  expanded: Set<string>;
  selectedPath: string | null;
  creating: Creating | null;
  renaming: string | null;
  cutPath: string | null;
  dragOverPath: string | null;
  showExcludedFiles: boolean;
  gitStatuses?: GitStatusMap;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  navigationOnly: boolean;
  onOpenFile: OpenFileFn;
  onCreateCommit: (id: number, raw: string) => Promise<void>;
  onCreateCancel: (id: number) => void;
  onRenameCommit: (path: string, raw: string) => Promise<void>;
  onRenameCancel: () => void;
  onItemContextMenu: (
    entry: { path: string; isDir: boolean },
    e: ReactMouseEvent,
  ) => void;
};

const TreeCtx = createContext<TreeCtxValue | null>(null);

function useTree(): TreeCtxValue {
  const ctx = useContext(TreeCtx);
  if (!ctx) throw new Error("TreeCtx missing");
  return ctx;
}

function isDirAt(cwd: string, path: string): boolean {
  if (path === cwd) return true;
  return (
    peekDir(parentPath(path))?.find((entry) => entry.path === path)?.isDir ??
    peekDir(path) != null
  );
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    el.remove();
  }
}

/** Non-Latin layouts put the local letter in `key`, so fall back to the physical key. */
function shortcutLetter(e: ReactKeyboardEvent): string {
  const key = e.key.toLowerCase();
  if (/^[a-z]$/.test(key)) return key;
  return /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : key;
}

function explorerItems(
  target: MenuTarget,
  clip: Clip | null,
  canOpenTerminal: boolean,
): ActionMenuItem[] {
  const pasteParent = target.isDir ? target.path : parentPath(target.path);
  const pasteBlocked =
    !!clip?.isDir &&
    (pasteParent === clip.path || pasteParent.startsWith(`${clip.path}/`));
  return [
    { kind: "item", id: "new-file", label: translateUi("New File") },
    { kind: "item", id: "new-folder", label: translateUi("New Folder") },
    { kind: "sep" },
    {
      kind: "item",
      id: "cut",
      label: translateUi("Cut"),
      shortcut: `${MOD}X`,
      disabled: target.isRoot,
    },
    {
      kind: "item",
      id: "copy",
      label: translateUi("Copy"),
      shortcut: `${MOD}C`,
      disabled: target.isRoot,
    },
    {
      kind: "item",
      id: "paste",
      label: translateUi("Paste"),
      shortcut: `${MOD}V`,
      disabled: pasteBlocked,
    },
    {
      kind: "item",
      id: "duplicate",
      label: translateUi("Duplicate"),
      disabled: target.isRoot,
    },
    { kind: "sep" },
    {
      kind: "item",
      id: "copy-path",
      label: translateUi("Copy Path"),
      shortcut: `${MOD}${SHIFT}C`,
    },
    {
      kind: "item",
      id: "copy-relative-path",
      label: translateUi("Copy Relative Path"),
    },
    { kind: "sep" },
    {
      kind: "item",
      id: "rename",
      label: translateUi("Rename"),
      shortcut: "F2",
      disabled: target.isRoot,
    },
    {
      kind: "item",
      id: "delete",
      label: translateUi("Delete"),
      shortcut: "⌫",
      disabled: target.isRoot,
      danger: true,
    },
    { kind: "sep" },
    ...(canOpenTerminal
      ? [
          {
            kind: "item" as const,
            id: "open-terminal",
            label: translateUi("Open in Terminal"),
          },
        ]
      : []),
    { kind: "item", id: "reveal", label: REVEAL_LABEL },
  ];
}

// Chat updates rerender the sidebar even when Files is hidden. Keep its tree
// intact unless file-tree props, local state, or subscriptions actually change.
export const FileTree = memo(function FileTree({
  cwd,
  compact = false,
  activePath,
  navigationOnly = false,
  rootLabel,
  onOpenFile,
  onOpenTerminal,
  onFileMoved,
  onFileDeleted,
  onSearch,
  gitStatuses,
}: Props) {
  const { t: uiT } = useTranslation();
  const [expanded, setExpanded] = useState(() => navigationOnly ? new Set([cwd]) : loadExpanded(cwd));
  const [selectedPath, setSelectedPath] = useState(() => navigationOnly ? activePath ?? null : loadSelected(cwd));
  useEffect(() => {
    if (!activePath) return;
    setSelectedPath(activePath);
    if (!navigationOnly) saveSelected(cwd, activePath);
  }, [activePath, cwd, navigationOnly]);
  const listing = useQuery({
    ...directoryQuery(cwd, listDir),
    refetchInterval: cwd.startsWith(REMOTE_PATH_PREFIX) ? 5000 : false,
  }, queryClient);
  const children = listing.data ?? (listing.isError ? [] : null);
  const error = errorMessage(listing.error) ?? null;
  const [creating, setCreating] = useState<Creating | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const showExcludedFiles = useSyncExternalStore(
    subscribeShowExcludedFiles,
    loadShowExcludedFiles,
    loadShowExcludedFiles,
  );
  const creatingRef = useRef(creating);
  creatingRef.current = creating;
  const rootRef = useRef<HTMLDivElement>(null);
  const flatPaths = useRef<string[]>([]);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const name = rootLabel?.trim() || basename(cwd);
  const rootOpen = (compact && !navigationOnly) || expanded.has(cwd);
  const rootLoading = rootOpen && children === null && !error;

  useEffect(() => {
    const root = rootRef.current;
    if (!navigationOnly || !root) return;
    let done = false;
    let frame = 0;
    const focusInitialRow = () => {
      if (done) return;
      const rows = Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]'));
      const row = activePath ? rows.find(item => item.title === activePath) : rows[0];
      if (!row) return;
      row.focus({ preventScroll: true });
      row.scrollIntoView?.({ block: "nearest" });
      done = document.activeElement === row;
    };
    const scheduleFocus = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(focusInitialRow);
    };
    const observer = new MutationObserver(scheduleFocus);
    observer.observe(root, { childList: true, subtree: true });
    scheduleFocus();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [navigationOnly, activePath, cwd]);

  const toggle = (path: string) => {
    setMenu(null);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      if (!navigationOnly) saveExpanded(cwd, next);
      return next;
    });
  };

  const onSelect = (path: string) => {
    setSelectedPath(path);
    if (!navigationOnly) saveSelected(cwd, path);
  };


  const expandDirs = (dirs: string[]) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const dir of dirs) next.add(dir);
      saveExpanded(cwd, next);
      return next;
    });
  };

  const refreshTouched = async (touched: string[], forget: string[] = []) => {
    for (const path of forget) forgetDir(path);
    await Promise.all([...new Set(touched)].map((path) => refreshDir(path)));
  };

  const remapTreePaths = (from: string, to: string) => {
    setExpanded((prev) => {
      const next = new Set<string>();
      for (const path of prev) next.add(rebasePath(path, from, to));
      saveExpanded(cwd, next);
      return next;
    });
    setSelectedPath((prev) => {
      const next = prev ? rebasePath(prev, from, to) : prev;
      saveSelected(cwd, next);
      return next;
    });
    setClip((cur) =>
      cur && (cur.path === from || cur.path.startsWith(`${from}/`))
        ? { ...cur, path: rebasePath(cur.path, from, to) }
        : cur,
    );
  };

  const startCreate = (
    isDir: boolean,
    atPath: string | null = selectedPath,
  ) => {
    const parent = createParentOf(cwd, atPath);
    setRenaming(null);
    expandDirs([cwd, parent]);
    setCreating({ id: Date.now(), parent, isDir });
  };

  const startRename = (path: string) => {
    if (path === cwd) return;
    setCreating(null);
    setMenu(null);
    onSelect(path);
    setRenaming(path);
  };

  const onCreateCancel = (id: number) => {
    setCreating((cur) => (cur?.id === id ? null : cur));
  };

  const onCreateCommit = async (id: number, raw: string) => {
    const session = creatingRef.current;
    if (!session || session.id !== id) return;
    const asFolder = session.isDir || /[/\\]$/.test(raw);
    const fileName = wellFormedFileName(raw);
    const created = await createPath(session.parent, fileName, asFolder);
    const touched = dirsTouchedByCreate(session.parent, fileName);
    await refreshTouched(touched);
    setCreating((cur) => (cur?.id === id ? null : cur));
    expandDirs(touched);
    setSelectedPath(created);
    saveSelected(cwd, created);
    if (!asFolder) onOpenFile(created, undefined, { exact: true });
  };

  const onRenameCancel = () => setRenaming(null);

  const onRenameCommit = async (path: string, raw: string) => {
    const fileName = wellFormedFileName(raw);
    if (!fileName || (fileName === basename(path) && !/[/\\]/.test(raw))) {
      setRenaming(null);
      return;
    }
    const next = await renamePath(path, fileName);
    const wasDir = isDirAt(cwd, path);
    const parent = parentPath(path);
    await refreshTouched(
      [...dirsTouchedByCreate(parent, fileName), parent],
      wasDir ? [path] : [],
    );
    setRenaming(null);
    expandDirs(dirsTouchedByCreate(parent, fileName));
    remapTreePaths(path, next);
    onFileMoved?.(path, next);
  };

  const removeEntry = async (path: string) => {
    if (path === cwd) return;
    const isDir = isDirAt(cwd, path);
    const label = basename(path);
    const ok = window.confirm(
      isDir
        ? `Delete folder “${label}” and everything inside it?`
        : `Delete “${label}”?`,
    );
    if (!ok) return;
    await deletePath(path);
    await refreshTouched([parentPath(path)], isDir ? [path] : []);
    setSelectedPath((prev) => {
      if (!prev || prev === path || prev.startsWith(`${path}/`)) {
        const parent = parentPath(path);
        saveSelected(cwd, parent);
        return parent;
      }
      return prev;
    });
    setClip((cur) =>
      cur && (cur.path === path || cur.path.startsWith(`${path}/`))
        ? null
        : cur,
    );
    onFileDeleted?.(path);
  };

  const copyExternalFiles = async (paths: string[], destParent: string) => {
    let created: string | null = null;
    try {
      for (const from of paths) created = await copyPath(from, destParent);
    } finally {
      if (created) {
        await refreshTouched([destParent]);
        expandDirs([destParent]);
        setSelectedPath(created);
        saveSelected(cwd, created);
      }
    }
  };

  const pasteAt = async (targetPath: string) => {
    const destParent = createParentOf(cwd, targetPath);
    if (!clip) {
      await copyExternalFiles(await clipboardFilePaths(), destParent);
      return;
    }
    if (
      clip.isDir &&
      (destParent === clip.path || destParent.startsWith(`${clip.path}/`))
    ) {
      throw new Error("Cannot paste a folder into itself.");
    }
    const from = clip.path;
    const mode = clip.mode;
    const isDir = clip.isDir;
    const created =
      mode === "cut"
        ? await movePath(from, destParent)
        : await copyPath(from, destParent);
    if (mode === "cut") {
      await refreshTouched(
        dirsTouchedByMove(from, created),
        isDir ? [from] : [],
      );
      remapTreePaths(from, created);
      onFileMoved?.(from, created);
      setClip(null);
    } else {
      await refreshTouched([destParent]);
    }
    expandDirs([destParent]);
    setSelectedPath(created);
    saveSelected(cwd, created);
  };

  const duplicateAt = async (path: string) => {
    if (path === cwd) return;
    const destParent = parentPath(path);
    const created = await copyPath(path, destParent);
    await refreshTouched([destParent]);
    setSelectedPath(created);
    saveSelected(cwd, created);
  };

  const fileAction = useMutation({ mutationFn: (work: () => Promise<void>) => work() }, queryClient);
  const run = async (work: () => Promise<void>) => {
    setOpError(null);
    try {
      await fileAction.mutateAsync(work);
    } catch (err: unknown) {
      setOpError(err instanceof Error ? err.message : String(err));
    }
  };

  const dropFiles = (paths: string[], targetPath: string) =>
    run(() => copyExternalFiles(paths, createParentOf(cwd, targetPath)));
  const dropFilesRef = useRef(dropFiles);
  dropFilesRef.current = dropFiles;

  const openMenu = (target: MenuTarget, x: number, y: number) => {
    if (navigationOnly) return;
    setCreating(null);
    setRenaming(null);
    onSelect(target.path);
    setMenu({ x, y, target });
  };

  const runAction = async (id: string, target: MenuTarget) => {
    switch (id) {
      case "new-file":
        startCreate(false, target.path);
        return;
      case "new-folder":
        startCreate(true, target.path);
        return;
      case "cut":
        if (target.isRoot) return;
        setClip({ mode: "cut", path: target.path, isDir: target.isDir });
        return;
      case "copy":
        if (target.isRoot) return;
        setClip({ mode: "copy", path: target.path, isDir: target.isDir });
        return;
      case "paste":
        await run(() => pasteAt(target.path));
        return;
      case "duplicate":
        await run(() => duplicateAt(target.path));
        return;
      case "copy-path":
        await copyText(target.path);
        return;
      case "copy-relative-path":
        await copyText(displayPath(target.path, cwd));
        return;
      case "rename":
        startRename(target.path);
        return;
      case "delete":
        await run(() => removeEntry(target.path));
        return;
      case "reveal":
        await run(() => revealPath(target.path));
        return;
      case "open-terminal":
        onOpenTerminal?.(target.isDir ? target.path : parentPath(target.path));
        return;
    }
  };

  const onItemContextMenu = (
    entry: { path: string; isDir: boolean },
    e: ReactMouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu(
      { path: entry.path, isDir: entry.isDir, isRoot: false },
      e.clientX,
      e.clientY,
    );
  };

  const onBackgroundMenu = (e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest("input")) return;
    e.preventDefault();
    openMenu({ path: cwd, isDir: true, isRoot: true }, e.clientX, e.clientY);
  };

  const visibleRows = () => [
    ...(!compact || navigationOnly ? [{ title: cwd }] : []),
    ...(rootOpen ? flatPaths.current.map(title => ({ title })) : []),
  ];

  const focusRow = (row: { title: string } | undefined) => {
    if (!row) return;
    onSelect(row.title);
    const focus = () => {
      const element = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-explorer-root], [role='treeitem']") ?? [])
        .find(element => element.title === row.title && !element.closest("[inert], [hidden], [aria-hidden='true']"));
      element?.focus({ preventScroll: true });
      element?.scrollIntoView?.({ block: "nearest" });
      return !!element;
    };
    if (!focus()) requestAnimationFrame(focus);
  };

  const typeahead = useRef({ text: "", at: 0 });

  // Navigate the full flattened model, including rows outside the viewport.
  const onNavigationKey = (
    e: ReactKeyboardEvent<HTMLDivElement>,
    path: string,
    isDir: boolean,
  ): boolean => {
    if (e.altKey || e.ctrlKey || (e.metaKey && e.key !== "ArrowDown")) {
      return false;
    }
    const rows = visibleRows();
    const index = rows.findIndex((row) => row.title === path);
    const open = path === cwd ? rootOpen : expanded.has(path);
    const pageSize = () => {
      const scroller = rootRef.current?.querySelector(".overflow-y-auto");
      const rowHeight = 28;
      return Math.max(
        1,
        Math.floor((scroller?.clientHeight ?? 0) / rowHeight) - 1,
      );
    };
    const step = (delta: number) =>
      focusRow(
        rows[
          index < 0
            ? delta > 0
              ? 0
              : rows.length - 1
            : Math.min(rows.length - 1, Math.max(0, index + delta))
        ],
      );
    const activate = (keepFocus: boolean) => {
      onSelect(path);
      if (isDir) {
        toggle(path);
        return;
      }
      onOpenFile(path, undefined, { exact: true });
      if (keepFocus) {
        const row = rows[index];
        requestAnimationFrame(() => focusRow(row));
      }
    };

    switch (e.key) {
      case "ArrowDown":
        // Cmd+Down opens, as in VS Code on macOS.
        if (e.metaKey) activate(false);
        else step(1);
        return true;
      case "ArrowUp":
        step(-1);
        return true;
      case "PageDown":
        step(pageSize());
        return true;
      case "PageUp":
        step(-pageSize());
        return true;
      case "Home":
        focusRow(rows[0]);
        return true;
      case "End":
        focusRow(rows[rows.length - 1]);
        return true;
      case "ArrowRight":
        if (!isDir) return true;
        if (!open) toggle(path);
        else if (rows[index + 1] && parentPath(rows[index + 1].title) === path)
          focusRow(rows[index + 1]);
        return true;
      case "ArrowLeft":
        if (isDir && open) toggle(path);
        else if (path !== cwd)
          focusRow(rows.find((row) => row.title === parentPath(path)));
        return true;
      case "Enter":
        activate(false);
        return true;
      case " ":
        activate(true);
        return true;
    }

    // Type a name prefix to jump to the next matching row.
    if (e.metaKey || e.key.length !== 1 || e.key === " ") return false;
    const now = performance.now();
    const buffer = typeahead.current;
    buffer.text = now - buffer.at > 700 ? e.key : buffer.text + e.key;
    buffer.at = now;
    // Repeating one letter cycles through its matches instead of narrowing.
    const lower = buffer.text.toLowerCase();
    const cycling = [...lower].every((ch) => ch === lower[0]);
    const needle = cycling ? lower[0] : lower;
    const start = cycling ? index + 1 : Math.max(index, 0);
    const ordered = [...rows.slice(start), ...rows.slice(0, start)];
    const match = ordered.find(
      (row) =>
        row.title !== cwd &&
        basename(row.title).toLowerCase().startsWith(needle),
    );
    if (match) focusRow(match);
    return true;
  };

  const activeDrag = useActiveDragPayload();
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || activeDrag) return;
    const target = e.target as HTMLElement;
    if (
      e.nativeEvent.isComposing ||
      target.closest("input, [inert], [hidden], [aria-hidden='true']")
    ) {
      return;
    }
    if (
      (e.target as HTMLElement).closest("button") &&
      !(e.target as HTMLElement).closest(
        "[role='treeitem'], [data-explorer-root]",
      )
    ) {
      return;
    }
    const path =
      target.closest<HTMLElement>("[role='treeitem'], [data-explorer-root]")
        ?.title ??
      selectedPath ??
      cwd;
    const isRoot = path === cwd;
    const isDir = isDirAt(cwd, path);
    if (onNavigationKey(e, path, isDir)) {
      e.preventDefault();
      return;
    }
    if (navigationOnly) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = shortcutLetter(e);
    if (mod && !e.altKey && e.shiftKey && key === "c") {
      e.preventDefault();
      void copyText(path);
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && key === "c") {
      if (isRoot) return;
      e.preventDefault();
      setClip({ mode: "copy", path, isDir });
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && key === "x") {
      if (isRoot) return;
      e.preventDefault();
      setClip({ mode: "cut", path, isDir });
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && key === "v") {
      e.preventDefault();
      void run(() => pasteAt(path));
      return;
    }
    if (e.key === "F2") {
      e.preventDefault();
      startRename(path);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      void run(() => removeEntry(path));
      return;
    }
    if (e.key === "Escape" && clip?.mode === "cut") {
      e.preventDefault();
      setClip(null);
    }
  };

  useEffect(() => {
    if (!menu) return;
    const onScroll = () => setMenu(null);
    const scrollParent = rootRef.current?.closest(".overflow-y-auto") ?? window;
    scrollParent.addEventListener("scroll", onScroll, true);
    return () => scrollParent.removeEventListener("scroll", onScroll, true);
  }, [menu]);

  useEffect(() => {
    const treePathAt = (x: number, y: number): string | null => {
      const root = rootRef.current;
      if (!root) return null;
      const point = dragPointToClient(x, y);
      const el = document.elementFromPoint(point.x, point.y);
      if (!el || !root.contains(el)) return null;
      return el.closest<HTMLElement>("[role='treeitem']")?.title ?? cwd;
    };

    if (navigationOnly) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "leave") {
          setDragOverPath(null);
          return;
        }
        const { x, y } = event.payload.position;
        const target = treePathAt(x, y);
        if (event.payload.type !== "drop") {
          setDragOverPath(target ? createParentOf(cwd, target) : null);
          return;
        }
        setDragOverPath(null);
        if (target) void dropFilesRef.current(event.payload.paths, target);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [cwd, navigationOnly]);

  useEffect(() => {
    const onResume = () => {
      if (!document.hidden) notifyDirsChanged();
    };
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, []);

  const rootRow = (
    <div className="flex h-7 shrink-0 items-center">
      <Button variant="ghost" size="content"
        type="button"
        data-explorer-root
        role={navigationOnly ? "treeitem" : undefined}
        data-active={dragOverPath === cwd || (navigationOnly && selectedPath === cwd) || undefined}
        aria-level={navigationOnly ? 1 : undefined}
        aria-selected={navigationOnly ? selectedPath === cwd : undefined}
        aria-expanded={rootOpen}
        aria-busy={rootLoading || undefined}
        title={cwd}
        onClick={() => {
          onSelect(cwd);
          toggle(cwd);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openMenu(
            { path: cwd, isDir: true, isRoot: true },
            e.clientX,
            e.clientY,
          );
        }}
        className={cn("flex min-w-0 flex-1 items-center justify-start gap-1 h-full rounded-lg pl-2 text-left outline-none  hover:bg-surface-hover", dragOverPath === cwd || (navigationOnly && selectedPath === cwd) ? "bg-selection" : "")}
      >
        <span className="grid size-4 shrink-0 place-items-center text-content/50">
          {rootLoading ? (
            <Spinner className="size-3.5" aria-hidden="true" />
          ) : (
            <DisclosureChevron expanded={rootOpen} className="size-3.5" />
          )}
        </span>
        <span className={navigationOnly ? "min-w-0 truncate text-ui-base text-content" : "min-w-0 truncate text-[11px] font-semibold tracking-[0.08em] text-content/50 uppercase"}>
          {name}
        </span>
      </Button>
    </div>
  );

  return (
    <TreeCtx.Provider
      value={{
        expanded,
        selectedPath,
        creating,
        renaming,
        cutPath: clip?.mode === "cut" ? clip.path : null,
        dragOverPath,
        showExcludedFiles,
        gitStatuses,
        onToggle: toggle,
        onSelect,
        navigationOnly,
        onOpenFile,
        onCreateCommit,
        onCreateCancel,
        onRenameCommit,
        onRenameCancel,
        onItemContextMenu,
      }}
    >
      <div
        ref={rootRef}
        tabIndex={-1}
        className="flex h-full min-h-0 flex-col outline-none"
        onKeyDown={onKeyDown}
        onContextMenu={onBackgroundMenu}
      >
        {!compact ? <><div
          className="desktop-toolbar flex h-9 shrink-0 items-center gap-px overflow-visible border-b border-stroke px-2"
          onContextMenu={(e) => e.stopPropagation()}
        >
          <HeaderIcon
            label={uiT("New File")}
            onClick={() => startCreate(false)}
          >
            <FilePlus className="size-3.5" />
          </HeaderIcon>
          <HeaderIcon
            label={uiT("New Folder")}
            onClick={() => startCreate(true)}
          >
            <FolderPlus className="size-3.5" />
          </HeaderIcon>
          <HeaderIcon
            label={uiT("Collapse All")}
            onClick={() => {
              setMenu(null);
              setCreating(null);
              setRenaming(null);
              const next = new Set([cwd]);
              saveExpanded(cwd, next);
              setExpanded(next);
            }}
          >
            <FoldVertical className="size-3.5" />
          </HeaderIcon>
          {onSearch ? (
            <HeaderIcon
              label={uiT("Search in files ({value0}Shift+F)", {
                value0: String(MOD),
              })}
              onClick={onSearch}
            >
              <Search className="size-3.5" />
            </HeaderIcon>
          ) : null}
        </div>
        {rootRow}
        </> : null}
        <div
          ref={lockOverscroll}
          className="min-h-0 flex-1 overflow-y-auto overscroll-none"
        >
          {opError ? (
            <p className="px-3 py-1 text-[12px] leading-4 text-danger">
              {opError}
            </p>
          ) : null}
          <div className="relative" role="tree" aria-busy={rootLoading || undefined} aria-label={uiT("{value0} files", { value0: String(name) })}>
            {compact && !navigationOnly && rootLoading ? (
              <span role="status" className="absolute left-2 top-1 text-content/50">
                <Spinner className="size-3.5" aria-hidden="true" />
                <span className="sr-only">{uiT("Loading folders…")}</span>
              </span>
            ) : null}
            {navigationOnly ? rootRow : null}
            <AnimatedCollapse expanded={rootOpen && children !== null}>
              <div role={navigationOnly ? "group" : undefined}>
                <TreeChildren
                  parent={cwd}
                  depth={navigationOnly ? 1 : 0}
                  entries={children}
                  error={error}
                  onPaths={paths => { flatPaths.current = paths; }}
                />
              </div>
            </AnimatedCollapse>
          </div>
        </div>
      </div>
      <PresenceBoundary propagate>{menu ? (
        <ActionMenu
          x={menu.x}
          y={menu.y}
          items={explorerItems(menu.target, clip, !!onOpenTerminal)}
          onPick={(id) => {
            const target = menu.target;
            setMenu(null);
            void runAction(id, target);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}</PresenceBoundary>
    </TreeCtx.Provider>
  );
});

function HeaderIcon({
  label,
  onClick,
  active = false,
  children,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Button variant="ghost" size="content"
      type="button"
      title={label}
      aria-label={label}
      data-active={active || undefined}
      aria-pressed={active || undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn("flex h-6 min-w-0 flex-1 items-center justify-center self-center rounded-md", active
          ? "bg-selection text-content"
          : "text-content/50 hover:bg-content/3 hover:text-content")}
    >
      {children}
    </Button>
  );
}

function TreeChildren({
  parent,
  depth,
  entries,
  error,
  onPaths,
}: {
  parent: string;
  depth: number;
  entries: FsEntry[] | null;
  error: string | null;
  onPaths: (paths: string[]) => void;
}) {
  const ctx = useTree();
  const paths = [...ctx.expanded].filter(path => {
    if (path === parent) return false;
    let ancestor = parentPath(path);
    while (ancestor !== parent) {
      if (!ctx.expanded.has(ancestor)) return false;
      const next = parentPath(ancestor);
      if (next === ancestor) return false;
      ancestor = next;
    }
    return true;
  });
  const listings = useQueries({ queries: paths.map(path => ({
    ...directoryQuery(path, listDir),
    refetchInterval: path.startsWith(REMOTE_PATH_PREFIX) ? 5000 : false as const,
  })) }, queryClient);
  const byPath = new Map(paths.map((path, index) => [path, listings[index]]));
  type Row = { key: string; depth: number; entry?: FsEntry; creating?: Creating; siblings?: string[]; error?: string; loading?: boolean };
  const rows: Row[] = [];
  const flatten = (path: string, level: number, children: FsEntry[] | null, issue: string | null) => {
    if (issue) rows.push({ key: `error:${path}`, depth: level, error: issue });
    const creating = ctx.creating?.parent === path ? ctx.creating : null;
    const addCreate = () => {
      if (creating) rows.push({ key: `create:${creating.id}`, depth: level, creating, siblings: (children ?? []).map(entry => entry.name) });
    };
    const visible = (children ?? []).filter(entry => ctx.showExcludedFiles || !entry.ignored);
    if (creating?.isDir) addCreate();
    for (const entry of visible.filter(entry => entry.isDir)) {
      const listing = byPath.get(entry.path);
      rows.push({ key: entry.path, depth: level, entry, loading: listing?.isPending });
      if (ctx.expanded.has(entry.path)) flatten(entry.path, level + 1, listing?.data ?? null, errorMessage(listing?.error) ?? null);
    }
    if (creating && !creating.isDir) addCreate();
    for (const entry of visible.filter(entry => !entry.isDir)) rows.push({ key: entry.path, depth: level, entry });
  };
  flatten(parent, depth, entries, error);
  onPaths(rows.flatMap(row => row.entry ? [row.entry.path] : []));
  const focusKey = ctx.creating ? `create:${ctx.creating.id}` : ctx.renaming ?? ctx.selectedPath;
  const active = rows.findIndex(row => row.key === focusKey);
  return <CollapsingVirtualRows items={rows} getKey={row => row.key} estimateSize={28} activeIndex={active}>{row =>
    row.entry ? <TreeNode entry={row.entry} depth={row.depth} loading={row.loading} /> : row.creating ?
      <NameRow depth={row.depth} isDir={row.creating.isDir} siblings={row.siblings ?? []}
        onCommit={raw => ctx.onCreateCommit(row.creating!.id, raw)} onCancel={() => ctx.onCreateCancel(row.creating!.id)} /> :
      <p className="truncate pr-2 text-[12px] text-content/50" style={{ paddingLeft: 28 + row.depth * 12 }}>{row.error}</p>
  }</CollapsingVirtualRows>;
}

function TreeNode({ entry, depth, loading }: { entry: FsEntry; depth: number; loading?: boolean }) {
  const {
    expanded,
    selectedPath,
    renaming,
    cutPath,
    dragOverPath,
    gitStatuses,
    onToggle,
    onSelect,
    navigationOnly,
    onOpenFile,
    onRenameCommit,
    onRenameCancel,
    onItemContextMenu,
  } = useTree();
  const open = expanded.has(entry.path);
  const selected = selectedPath === entry.path;
  const editing = renaming === entry.path;
  const gitStatus = entry.isDir
    ? gitStatuses?.dirs.get(entry.path)
    : gitStatuses?.files.get(entry.path);
  const gitColor = gitStatus ? GIT_STATUS_COLOR[gitStatus] : undefined;

  const drag = useDraggableItem({
    payload: { type: "explorer-file", path: entry.path },
    disabled: navigationOnly || entry.isDir || editing || entry.path.startsWith(REMOTE_PATH_PREFIX),
    renderOverlay: () => <span className="flex items-center gap-1.5"><FileTypeIcon name={entry.name} isDir={false} />{entry.name}</span>,
    onActiveChange: active => { if (active) onSelect(entry.path); },
  });
  const onClick = () => {
    if (drag.consumeClick()) return;
    onSelect(entry.path);
    if (entry.isDir) onToggle(entry.path);
    else onOpenFile(entry.path, undefined, { exact: true });
  };

  const siblings = (peekDir(parentPath(entry.path)) ?? [])
    .map((child) => child.name)
    .filter((name) => name !== entry.name);

  return (
    <div>
      {editing ? (
        <NameRow
          depth={depth}
          isDir={entry.isDir}
          initial={entry.name}
          selectStem={!entry.isDir}
          siblings={siblings}
          onCommit={(raw) => onRenameCommit(entry.path, raw)}
          onCancel={onRenameCancel}
        />
      ) : (
        <Button variant="ghost" size="content"
          type="button"
          {...(!navigationOnly && !entry.isDir && !entry.path.startsWith(REMOTE_PATH_PREFIX) ? drag.handleProps : undefined)}
          ref={(node) => { drag.ref(node); drag.handleProps.ref(node); }}
          data-explorer-dragging={drag.dragging || undefined}
          role="treeitem"
          data-active={selected || dragOverPath === entry.path || undefined}
          title={entry.path}
          aria-selected={selected}
          aria-level={depth + 1}
          aria-expanded={entry.isDir ? open : undefined}
          aria-busy={loading || undefined}
          onClick={onClick}
          onDoubleClick={() => {
            if (!entry.isDir && !drag.consumeClick()) {
              onOpenFile(entry.path, undefined, { exact: true, pin: true });
            }
          }}
          onContextMenu={(e) => onItemContextMenu(entry, e)}
          style={{ paddingLeft: 8 + depth * 12 }}
          className={cn("flex h-7 w-full cursor-default items-center justify-start gap-1 rounded-lg pr-2 text-left text-ui-base outline-none  leading-none touch-none data-[explorer-dragging]:opacity-50", selected
              ? "bg-selection text-content"
              : "text-content hover:bg-surface-hover", cutPath === entry.path ? "opacity-50" : "", dragOverPath === entry.path ? "bg-selection" : "")}
        >
          <span className="grid size-4 shrink-0 place-items-center text-content/50">
            {loading ? (
              <Spinner className="size-3.5" aria-hidden="true" />
            ) : entry.isDir ? (
              <DisclosureChevron expanded={open}
                className="size-3.5"
              />
            ) : null}
          </span>
          {!entry.isDir ? (
            <span className="shrink-0">
              <FileTypeIcon name={entry.name} isDir={false} />
            </span>
          ) : null}
          <span
            data-file-label
            className={cn("min-w-0 truncate leading-label", entry.ignored ? "italic text-content/50" : (gitColor ?? ""))}
          >
            {entry.name}
          </span>
        </Button>
      )}
    </div>
  );
}

export function NameRow({
  depth,
  isDir,
  initial = "",
  selectStem = false,
  siblings,
  onCommit,
  onCancel,
}: {
  depth: number;
  isDir: boolean;
  initial?: string;
  selectStem?: boolean;
  siblings: string[];
  onCommit: (raw: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { t: uiT } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const [value, setValue] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const commit = useMutation({ mutationFn: (value: string) => onCommit(value) }, queryClient);
  const busy = commit.isPending;
  const [submitError, setSubmitError] = useState<string | null>(null);
  const issue = validateFileName(value, siblings);
  const leaf = leafName(value);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.scrollIntoView({ block: "nearest" });
    if (!selectStem) return;
    const dot = initial.lastIndexOf(".");
    if (dot > 0) input.setSelectionRange(0, dot);
    else input.select();
  }, [initial, selectStem]);

  const finish = (success: boolean) => {
    if (finished.current) return;
    if (success) {
      const current = validateFileName(value, siblings);
      if (current && current.severity === "error") {
        setAttempted(true);
        return;
      }
      finished.current = true;
      setSubmitError(null);
      void commit.mutateAsync(value).catch((err: unknown) => {
        finished.current = false;
        setSubmitError(err instanceof Error ? err.message : String(err));
      });
      return;
    }
    finished.current = true;
    onCancel();
  };

  const showIssue =
    submitError ||
    (issue &&
      (issue.severity === "warning" ||
        (issue.kind !== "empty" && value.length > 0) ||
        (issue.kind === "empty" && attempted)));

  return (
    <div>
      <div
        style={{ paddingLeft: 8 + depth * 12 }}
        className="flex h-7 w-full items-center gap-1 rounded-lg bg-surface-hover pr-2"
      >
        <span className="grid size-4 shrink-0 place-items-center text-content/50">
          {isDir ? (
            <ChevronRight className="size-3.5" />
          ) : null}
        </span>
        {!isDir ? (
          <span className="shrink-0">
            <FileTypeIcon name={leaf} isDir={false} />
          </span>
        ) : null}
        <Input variant="inline"
          ref={inputRef}
          value={value}
          data-file-label
          disabled={busy}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          aria-label={uiT(
            "Type file name. Press Enter to confirm or Escape to cancel.",
          )}
          onChange={(e) => {
            setValue(e.target.value);
          setSubmitError(null);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              finish(true);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              finish(false);
            }
          }}
          onBlur={() => finish(issue === null || issue.severity !== "error")}
          className="h-5 min-w-0 flex-1 rounded-sm bg-content/10 px-1 text-[14px] leading-none text-content outline-none ring-1 ring-accent"
        />
      </div>
      {showIssue ? (
        <NameIssueView depth={depth} issue={issue} fallback={submitError} />
      ) : null}
    </div>
  );
}

function NameIssueView({
  depth,
  issue,
  fallback,
}: {
  depth: number;
  issue: NameIssue | null;
  fallback: string | null;
}) {
  const { t: uiT } = useTranslation();
  let body: ReactNode = null;
  if (fallback) {
    body = fallback;
  } else if (issue) {
    switch (issue.kind) {
      case "empty":
        body = "A file or folder name must be provided.";
        break;
      case "slash":
        body = "A file or folder name cannot start with a slash.";
        break;
      case "exists":
        body = (
          <>
            {uiT("A file or folder ")}
            <span className="font-semibold">{issue.name}</span>{" "}
            {uiT(
              "already exists at this location. Please choose a different name.",
            )}
          </>
        );
        break;
      case "invalid":
        body = (
          <>
            {uiT("The name ")}
            <span className="font-semibold">{issue.name}</span>{" "}
            {uiT(
              "is not valid as a file or folder name. Please choose a different name.",
            )}
          </>
        );
        break;
      case "whitespace":
        body =
          "Leading or trailing whitespace detected in file or folder name.";
        break;
    }
  }
  if (!body) return null;
  const error = Boolean(fallback) || !issue || issue.severity === "error";
  return (
    <p
      className={cn("pr-2 pb-1 text-[12px] leading-4", error ? "text-danger" : "text-warning")}
      style={{ paddingLeft: 28 + depth * 12 }}
    >
      {body}
    </p>
  );
}
