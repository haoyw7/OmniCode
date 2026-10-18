import { isRemoteProjectPath } from "../../../projects/model/recents";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type CSSProperties,
} from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../../../../shared/ui/forms/InputGroup";
import { IconButton } from "../../../../shared/ui/forms/IconButton";
import {
  ListBullet,
  MoreHorizontal,
  Search,
  X,
} from "../../../../shared/ui/icons";
import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { useCollapseMotion } from "../../../../shared/ui/AnimatedCollapse";
import {
  SurfaceVisibilityContext,
  useSurfaceVisibility,
} from "../../../../shared/ui/SurfaceVisibility";
import { isPaneResizing, onPaneResizeSettled } from "../../../../shared/lib/paneResize";
import { useDragResize } from "../../../../shared/hooks/useDragResize";
import { ResizeHandle } from "../../../../shared/ui/ResizeHandle";
import { MOD } from "../../../../platform/tauri/platform";
import { useGitFileStatuses } from "../../../source-control/hooks/useGitFileStatuses";
import { ProjectSearch } from "../../../projects/ui/ProjectSearch";
import type { OpenFileFn } from "../../../search/model/search";
import {
  loadProjectFiles,
  peekProjectFiles,
  rankProjectFiles,
  subscribeProjectFiles,
} from "../model/fileIndex";
import {
  saveEditorPreferences,
  useEditorPreferences,
} from "../model/editorPreferences";
import { FileTree } from "./FileTree";
import { FileTypeIcon } from "./FileTypeIcon";
import { ExplorerMenu, type ExplorerMenuItem } from "./ExplorerMenu";

export function FileExplorerFrame({
  cwd,
  focused,
  hasDocument,
  renderHeader,
  children,
  onOpenFile,
  onOpenTerminal,
  activePath,
  onFileMoved,
  onFileDeleted,
  searchOpen = false,
  onSearchOpenChange,
}: {
  cwd: string;
  focused: boolean;
  hasDocument: boolean;
  renderHeader: (
    leading: ReactNode,
    trailing: ReactNode,
    showDocument: () => void,
  ) => ReactNode;
  children: ReactNode;
  onOpenFile: OpenFileFn;
  onOpenTerminal?: (cwd: string) => void;
  activePath?: string;
  onFileMoved?: (from: string, to: string) => void;
  onFileDeleted?: (path: string) => void;
  searchOpen?: boolean;
  onSearchOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const prefs = useEditorPreferences();
  const panelRef = useRef<HTMLDivElement>(null);
  const [splitLayout, setSplitLayout] = useState(false);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    let measuredWidth = panel.clientWidth;
    const measure = (width: number) => {
      measuredWidth = width;
      // Cache live geometry, but defer responsive React layout changes until release.
      if (width > 0 && !isPaneResizing()) setSplitLayout(width >= 720);
    };
    measure(panel.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(panel);
    const unsubscribe = onPaneResizeSettled(() => measure(measuredWidth));
    return () => {
      observer.disconnect();
      unsubscribe();
    };
  }, []);
  const [treeOpen, setTreeOpen] = useState(true);
  const [browsing, setBrowsing] = useState(!hasDocument);
  useLayoutEffect(() => {
    if (activePath && hasDocument) setBrowsing(false);
  }, [activePath, hasDocument, splitLayout]);
  const toggleTree = () => {
    if (splitLayout) setTreeOpen((value) => !value);
    else setBrowsing((value) => !value);
  };
  const [localSearch, setLocalSearch] = useState(false);
  const searching = onSearchOpenChange ? searchOpen : localSearch;
  const setSearch = (open: boolean) => {
    setLocalSearch(open);
    onSearchOpenChange?.(open);
    if (open) {
      setTreeOpen(true);
      setBrowsing(true);
    }
  };
  useEffect(() => {
    if (searchOpen) {
      setTreeOpen(true);
      setBrowsing(true);
    }
  }, [searchOpen]);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [filter, setFilter] = useState("");
  const [filterError, setFilterError] = useState("");
  const files = useSyncExternalStore(subscribeProjectFiles, () =>
    peekProjectFiles(cwd),
  );
  const [width, setWidth] = useState(260);
  const expanded = !hasDocument || (splitLayout ? treeOpen : browsing);
  const previewVisible = hasDocument && (splitLayout || !browsing);
  const { foldState, finish } = useCollapseMotion(expanded, 240);
  const resize = useDragResize({
    direction: "right",
    cssProperty: "--explorer-tree-width",
    min: 160,
    max: () => 480,
    defaultWidth: 260,
    initial: width,
    value: width,
    onCommit: setWidth,
  });
  const statuses = useGitFileStatuses(cwd, visible && expanded);
  useEffect(() => {
    if (!visible || !expanded || !splitLayout) resize.finishDrag();
  }, [visible, expanded, splitLayout, resize.finishDrag]);
  useEffect(() => {
    if (!filter.trim()) return;
    let cancelled = false;
    setFilterError("");
    void loadProjectFiles(cwd).catch((error: unknown) => {
      if (!cancelled) setFilterError(String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [cwd, filter]);
  useEffect(() => {
    if (!visible || !focused || !hasDocument) return;
    const key = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "y"
      ) {
        event.preventDefault();
        toggleTree();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [focused, visible, hasDocument, splitLayout]);
  useEffect(() => {
    if (!visible) setMenu(null);
  }, [visible]);
  const openFile: OpenFileFn = (path, navigation, options) => {
    setBrowsing(false);
    onOpenFile(path, navigation, {
      ...options,
      pin: options?.pin || !prefs.previewTabs,
    });
  };
  const results =
    filter.trim() && files
      ? rankProjectFiles(files, filter.trim(), [], 500)
      : [];
  const items: ExplorerMenuItem[] = [
    {
      kind: "item",
      id: "tree",
      label: t("Show file tree"),
      checked: expanded,
      shortcut: `${MOD}Shift+Y`,
      disabled: !hasDocument,
    },
    { kind: "sep" },
    ...(
      [
        ["previewTabs", "Preview tabs"],
        ["wordWrap", "Word wrap"],
        ["indentGuides", "Indent guides"],
        ["showWhitespace", "Show whitespace"],
        ["scrollPastEnd", "Scroll past end"],
      ] as const
    ).map(([id, label]) => ({
      kind: "item" as const,
      id,
      label: t(label),
      checked: prefs[id],
    })),
    {
      kind: "item",
      id: "tabSize",
      label: t("Tab size"),
      shortcut: String(prefs.tabSize),
      submenu: [2, 4, 8].map((size) => ({
        kind: "item",
        id: `tabSize:${size}`,
        label: String(size),
        checked: prefs.tabSize === size,
      })),
    },
  ];
  return (
    <div
      ref={panelRef}
      className="desktop-file-explorer"
      data-file-explorer-cwd={cwd}
    >
      {renderHeader(
        <>
          <IconButton
            size="sm"
            data-file-toolbar-action
            label={t(splitLayout ? "Show file tree" : "Back to file tree")}
            active={expanded}
            aria-pressed={expanded}
            disabled={!hasDocument}
            onClick={() => (splitLayout ? toggleTree() : setBrowsing(true))}
          >
            <ListBullet />
          </IconButton>
          {!hasDocument ? (
            <span className="px-1 text-ui-base">{t("Files")}</span>
          ) : null}
        </>,
        <>
          <IconButton
            size="sm"
            data-file-toolbar-action
            label={t("Search in files")}
            active={searching}
            onClick={() => setSearch(!searching)}
          >
            <Search />
          </IconButton>
          <IconButton
            size="sm"
            data-file-toolbar-action
            label={t("Editor options")}
            aria-haspopup="menu"
            aria-expanded={!!menu}
            onClick={(event) => setMenu(menu ? null : event.currentTarget)}
          >
            <MoreHorizontal className="rotate-90" />
          </IconButton>
        </>,
        () => setBrowsing(false),
      )}
      <div
        ref={resize.setPaneRef}
        className="desktop-file-explorer-body animated-collapse-size"
        data-fold-state={foldState}
        data-resizing={resize.dragging || undefined}
        data-has-document={hasDocument}
        data-split-layout={splitLayout}
        style={
          {
            gridTemplateColumns:
              !hasDocument || !splitLayout
                ? `minmax(0, ${expanded ? 1 : 0}fr) 0px minmax(0, ${expanded ? 0 : 1}fr)`
                : `${expanded ? "min(var(--explorer-tree-width), 45%)" : "0px"} 0px minmax(0, 1fr)`,
            "--collapse-duration": "0.24s",
          } as CSSProperties
        }
        onTransitionEnd={(event) => {
          if (
            event.target === event.currentTarget &&
            event.propertyName === "grid-template-columns"
          )
            finish();
        }}
      >
        <div
          className="desktop-file-explorer-tree"
          inert={!expanded || !visible}
          aria-hidden={!expanded}
          style={{
            visibility:
              !expanded && foldState === "closed" ? "hidden" : undefined,
          }}
        >
          <SurfaceVisibilityContext.Provider value={visible && expanded}>
            {searching ? (
              <ProjectSearch
                cwd={cwd}
                onOpenFile={openFile}
                onClose={() => setSearch(false)}
              />
            ) : (
              <>
                <InputGroup className="desktop-file-filter">
                  <InputGroupAddon>
                    <Search className="size-3.5" />
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-label={t("Filter files...")}
                    placeholder={t("Filter files...")}
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                  />
                  {filter ? (
                    <InputGroupAddon align="inline-end">
                      <IconButton
                        size="xs"
                        label={t("Clear")}
                        onClick={() => setFilter("")}
                      >
                        <X />
                      </IconButton>
                    </InputGroupAddon>
                  ) : null}
                </InputGroup>
                <div className="min-h-0 flex-1" hidden={!!filter.trim()}>
                  <SurfaceVisibilityContext.Provider
                    value={visible && expanded && !filter.trim()}
                  >
                    <FileTree
                      key={cwd}
                      cwd={cwd}
                      compact
                      activePath={activePath}
                      onOpenTerminal={
                        isRemoteProjectPath(cwd) ? undefined : onOpenTerminal
                      }
                      onOpenFile={openFile}
                      onFileMoved={onFileMoved}
                      onFileDeleted={onFileDeleted}
                      gitStatuses={statuses}
                    />
                  </SurfaceVisibilityContext.Provider>
                </div>
                {filter.trim() ? (
                  <div className="desktop-file-filter-results">
                    {filterError ? (
                      <p role="alert">{filterError}</p>
                    ) : files === null ? (
                      <p>{t("Loading…")}</p>
                    ) : !results.length ? (
                      <p>{t("No files found")}</p>
                    ) : (
                      results.map((file) => (
                        <button
                          type="button"
                          key={file.path}
                          title={file.path}
                          onClick={() =>
                            openFile(file.path, undefined, { exact: true })
                          }
                          onDoubleClick={() =>
                            openFile(file.path, undefined, {
                              exact: true,
                              pin: true,
                            })
                          }
                        >
                          <FileTypeIcon name={file.name} isDir={false} />
                          <span>{file.relative}</span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </>
            )}
          </SurfaceVisibilityContext.Provider>
        </div>
        <div className="desktop-file-explorer-divider">
          <ResizeHandle
            edge="left"
            disabled={!splitLayout || !expanded || !hasDocument}
            tabIndex={splitLayout && expanded && hasDocument ? 0 : -1}
            aria-label={t("Resize file tree")}
            aria-valuenow={width}
            aria-valuemin={160}
            aria-valuemax={480}
            onPointerDown={resize.onPointerDown}
            onDoubleClick={resize.onDoubleClick}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                setWidth((value) =>
                  Math.max(
                    160,
                    Math.min(
                      480,
                      value + (event.key === "ArrowRight" ? 16 : -16),
                    ),
                  ),
                );
              }
            }}
          />
        </div>
        <div
          className="desktop-file-explorer-preview"
          hidden={!hasDocument}
          inert={!previewVisible || !visible}
          aria-hidden={!previewVisible}
          style={{
            visibility:
              !previewVisible && foldState === "open" ? "hidden" : undefined,
          }}
        >
          <SurfaceVisibilityContext.Provider value={visible && previewVisible}>
            {children}
          </SurfaceVisibilityContext.Provider>
        </div>
      </div>
      {menu && visible ? (
        <ExplorerMenu
          anchor={menu}
          side="bottom"
          align="end"
          width={270}
          open
          ariaLabel={t("Editor options")}
          items={items}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            if (id === "tree") toggleTree();
            else if (id.startsWith("tabSize:"))
              saveEditorPreferences({ tabSize: Number(id.split(":")[1]) });
            else {
              const key = id as keyof typeof prefs;
              if (key !== "tabSize" && typeof prefs[key] === "boolean")
                saveEditorPreferences({ [key]: !prefs[key] });
            }
          }}
        />
      ) : null}
    </div>
  );
}
