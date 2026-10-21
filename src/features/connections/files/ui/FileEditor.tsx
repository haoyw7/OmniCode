import { IconButton } from "../../../../shared/ui/forms/IconButton";
import { Button } from "../../../../shared/ui/forms/Button";
import { Skeleton } from "../../../../shared/ui/primitives/Skeleton";
import { withToast } from "../../../../shared/ui/primitives/Sonner";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  invalidateAfterChange,
  queryClient,
} from "../../../../shared/lib/queryClient";
import {
  gitKeys,
  installGitQueryInvalidation,
} from "../../../source-control/model/gitQueries";
import { editorPreferenceExtensions } from "../editor/editorPreferences";
import { subscribeEditorPreferences } from "../model/editorPreferences";
import { PresenceBoundary } from "../../../../shared/ui/PresenceBoundary";
import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { acceptCompletion, completionStatus } from "@codemirror/autocomplete";
import { indentLess, indentMore } from "@codemirror/commands";
import {
  foldGutter,
  foldKeymap,
  getIndentUnit,
  indentUnit,
} from "@codemirror/language";
import {
  Annotation,
  Compartment,
  countColumn,
  EditorSelection,
  Prec,
  StateField,
  Transaction,
  type EditorState,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { AlertCircle, Code, Eye, RotateCcw } from "../../../../shared/ui/icons";
import { minimalSetup } from "codemirror";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  MarkdownViewShell,
  useMarkdownMode,
} from "../../../sessions/ui/MarkdownModeToggle";
import { useColorScheme } from "../../../../shared/hooks/useColorScheme";
import {
  useCodeThemePalette,
  useCodeThemes,
} from "../../../settings/model/codeAppearance";
import { useLockOverscroll } from "../../../../shared/hooks/useLockOverscroll";
import { isLightScheme } from "../../../settings/model/appearance";
import {
  loadAutosave,
  loadFormatOnSave,
} from "../../../settings/model/settings";
import { formatText } from "../../../../shared/lib/format";
import {
  basename,
  gitDiffFiles,
  gitFileDiff,
  gitStageContents,
  notifyGitChanged,
  readTextFile,
  writeTextFile,
} from "../../../../platform/tauri/fs";
import { syncWatchedMtime, watchFile } from "../model/fileWatch";
import { displayPath } from "../../../../shared/lib/paths";
import type { EditorNavigation } from "../../../search/model/search";
import { MarkdownDocumentPreview } from "../../../sessions/ui/MarkdownDocumentPreview";
import {
  DiffCommentComposer,
  type DiffCommentComposerTarget,
} from "../../../source-control/ui/DiffCommentComposer";
import { editorAutocomplete } from "../editor/editorAutocomplete";
import { languageForPath, schemeExtensions } from "../editor/editorChrome";
import {
  detectLineEnding,
  type LineEnding,
  normalizeLineBreaks,
  preserveEditorViewport,
  replaceEditorDoc,
  restoreLineEnding,
} from "../editor/editorDoc";
import {
  editorMatching,
  editorTyping,
  tryExpandEmmet,
} from "../editor/editorEditing";
import {
  EditorSelectionMenu,
  type EditorSelectionTarget,
} from "./EditorSelectionMenu";
import { editorGit, setGitOriginal } from "../editor/editorGit";
import { editorLint } from "../editor/editorLint";
import { editorSearch } from "../editor/editorSearch";
import { editorScrollbar } from "../editor/editorScrollbar";
import { FilePreviewSearch } from "./FilePreviewSearch";
import { FileBreadcrumb } from "./FileBreadcrumb";
import {
  claimEditorResource,
  type EditorResource,
} from "../model/editorResource";

type EditorNavigationRequest = EditorNavigation & { token: number };

export const FILE_EDITOR_AUTOSAVE_DELAY_MS = 1_000;

const editorScheme = new Compartment();
const editorGitConfig = new Compartment();
const editorPreferences = new Compartment();

type Props = {
  path: string;
  cwd: string;
  active: boolean;
  showDiff?: boolean;
  showPathHeader?: boolean;
  navigation?: EditorNavigationRequest | null;
  onDirtyChange: (path: string, dirty: boolean) => void;
  onErrorCountChange?: (path: string, count: number) => void;
  onOpenFile?: (path: string) => void;
};

export function FileEditor({
  path,
  cwd,
  active,
  showDiff = false,
  showPathHeader = false,
  navigation,
  onDirtyChange,
  onErrorCountChange,
  onOpenFile,
}: Props) {
  const { t: uiT } = useTranslation();
  const instanceId = useId();
  // This is the accepted editor baseline, not a second remote-data cache.
  // A dirty buffer must keep its baseline when a disk query finishes.
  const [baseline, setBaseline] = useState<{ path: string; content: string }>();
  const [draft, setDraft] = useState("");
  const resource = useRef<EditorResource | undefined>(undefined);
  const [lease, setLease] = useState<{
    path: string;
    resource: EditorResource;
  }>();
  useEffect(() => {
    const lease = claimEditorResource(path);
    resource.current = lease;
    setLease({ path, resource: lease });
    dirtyRef.current = false;
    pendingDiskRef.current = false;
    return () => {
      // React destroys the mounted editor in the same cleanup pass before this
      // release. Queued writes still own the file until their queue settles.
      void saveQueue.current.then(() => lease.release()).catch(() => {});
    };
  }, [path]);
  const markdown = isMarkdownPath(path);
  const svg = isSvgPath(path);
  // Diff tabs open as source: the git gutter only renders in the editor.
  const [mode, setMode] = useMarkdownMode(
    showDiff ? `review:${path}` : path,
    showDiff ? "source" : "preview",
  );
  const sourceNavigationToken = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (
      !navigation ||
      (!markdown && !svg) ||
      sourceNavigationToken.current === navigation.token
    )
      return;
    sourceNavigationToken.current = navigation.token;
    setMode("source");
  }, [markdown, svg, navigation, setMode]);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const dirtyRef = useRef(false);
  const pendingDiskRef = useRef(false);
  const eolRef = useRef<LineEnding>("\n");
  const diskQuery = useQuery(
    {
      queryKey: ["file-editor", instanceId, path],
      enabled: lease?.path === path,
      queryFn: async ({ signal }) => {
        await lease!.resource.reclaim();
        signal.throwIfAborted();
        const content = await readTextFile(path);
        signal.throwIfAborted();
        return content;
      },
      gcTime: 0,
      refetchOnWindowFocus: false,
    },
    queryClient,
  );
  const { refetch: refetchDisk } = diskQuery;
  const reloadFromDisk = useCallback(() => refetchDisk(), [refetchDisk]);
  useEffect(() => {
    if (diskQuery.data === undefined) return;
    if (dirtyRef.current) {
      pendingDiskRef.current = true;
      return;
    }
    pendingDiskRef.current = false;
    // CodeMirror documents are LF-only; keep the editor in that convention
    // and restore the file's own line endings on save. Feeding CRLF text
    // into the LF document doubles every line (see editorDoc.ts).
    eolRef.current = detectLineEnding(diskQuery.data);
    const content = normalizeLineBreaks(diskQuery.data);
    setBaseline((current) =>
      current?.path === path && current.content === content
        ? current
        : { path, content },
    );
    setDraft(content);
  }, [diskQuery.data, diskQuery.dataUpdatedAt, path]);
  useEffect(() => {
    if (diskQuery.error && dirtyRef.current) pendingDiskRef.current = true;
  }, [diskQuery.error, diskQuery.errorUpdatedAt]);

  useEffect(installGitQueryInvalidation, []);
  const relative = displayPath(path, cwd);
  const gitQuery = useQuery(
    {
      queryKey: gitKeys.editorBase(cwd, path),
      enabled:
        showDiff && !!cwd && cwd !== "~" && !!relative && relative !== path,
      queryFn: async () => {
        const { files } = await gitDiffFiles(cwd);
        const file = files.find((entry) => entry.relative === relative);
        // Normalized equality alone cannot distinguish autocrlf from a real change.
        const kind = file?.staged && !file.unstaged ? "staged" : "unstaged";
        const diff = await gitFileDiff(cwd, relative, kind);
        if (diff.binary || diff.tooLarge) return null;
        const original = normalizeLineBreaks(diff.original);
        return {
          path,
          original,
          kind,
          lineEnding: detectLineEnding(diff.original || diff.current),
          eolOnly:
            !!(file?.staged || file?.unstaged) &&
            diff.original !== diff.current &&
            original === normalizeLineBreaks(diff.current),
        };
      },
    },
    queryClient,
  );

  const gitDiff = showDiff && !gitQuery.isError ? gitQuery.data : null;
  const gitOriginal = gitDiff?.original ?? null;

  useEffect(() => {
    if (baseline?.path !== path) return;
    let timer = 0;
    const stop = watchFile(path, () => {
      if (showDiff) void invalidateAfterChange(gitKeys.editorBase(cwd, path));
      if (dirtyRef.current) {
        pendingDiskRef.current = true;
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void reloadFromDisk();
      }, 50);
    });
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [baseline?.path, cwd, path, reloadFromDisk, showDiff]);

  const saveMutation = useMutation(
    {
      mutationFn: ({
        operation,
        path: savedPath,
      }: {
        operation: Promise<unknown>;
        path: string;
      }) =>
        withToast(
          async () => {
            await operation;
            await syncWatchedMtime(savedPath);
            notifyGitChanged();
          },
          { loading: uiT("Saving…"), success: false },
        ),
    },
    queryClient,
  );
  const { mutateAsync: saveAsync, reset: resetSave } = saveMutation;
  const save = useCallback(
    async (content: string) => {
      const serializedContent = restoreLineEnding(content, eolRef.current);
      const lease = resource.current;
      const operation = saveQueue.current.then(async () => {
        await lease?.reclaim();
        return writeTextFile(path, serializedContent);
      });
      saveQueue.current = operation.catch(() => {});
      await saveAsync({ operation, path });
    },
    [path, saveAsync],
  );

  const stageMutation = useMutation(
    {
      mutationFn: async ({
        cwd: stageCwd,
        relative,
        contents,
      }: {
        cwd: string;
        relative: string;
        contents: string;
      }) => {
        await withToast(
          async () => {
            // Keep the index convention outside the selected text hunk.
            await gitStageContents(stageCwd, relative, contents);
            notifyGitChanged();
          },
          { loading: uiT("Staging…"), success: false },
        );
      },
    },
    queryClient,
  );
  const { mutateAsync: stageAsync, reset: resetStage } = stageMutation;
  const stageGit = useCallback(
    async (contents: string) => {
      const relative = displayPath(path, cwd);
      if (!cwd || cwd === "~" || !relative || relative === path) {
        throw new Error("Can't stage this file");
      }
      if (!gitDiff || gitDiff.kind !== "unstaged") {
        throw new Error("Only unstaged changes can be staged");
      }
      // Capture the file and index EOL before the mutation can yield to navigation.
      await stageAsync({
        cwd,
        relative,
        contents: restoreLineEnding(contents, gitDiff.lineEnding),
      });
    },
    [cwd, path, gitDiff, stageAsync],
  );
  const saving = saveMutation.isPending;
  const saveError = saveMutation.error ?? stageMutation.error;
  useEffect(() => {
    resetSave();
    resetStage();
  }, [path, resetSave, resetStage]);

  const dirtyChange = useCallback(
    (dirty: boolean) => {
      dirtyRef.current = dirty;
      onDirtyChange(path, dirty);
      if (dirty) {
        if (!saving) resetSave();
        resetStage();
        return;
      }
      if (pendingDiskRef.current) {
        pendingDiskRef.current = false;
        void reloadFromDisk();
      }
    },
    [onDirtyChange, path, reloadFromDisk, resetSave, resetStage, saving],
  );

  const errorCountChange = useCallback(
    (count: number) => onErrorCountChange?.(path, count),
    [onErrorCountChange, path],
  );

  const relativePath = path.startsWith(`${cwd}/`)
    ? path.slice(cwd.length + 1)
    : path;

  const loadError = !dirtyRef.current ? diskQuery.error : null;
  if (!loadError && (diskQuery.isPending || baseline?.path !== path)) {
    return (
      <div
        role="status"
        aria-label={`${uiT("Opening ")}${basename(path)}…`}
        className="space-y-3 p-4"
      >
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md text-center">
          <AlertCircle className="mx-auto mb-3 size-5 text-destructive" />
          <p className="text-[13px] text-content">
            {uiT("Couldn’t open ")}
            {basename(path)}
          </p>
          <p className="mt-1 text-[12px] leading-5 text-content/50">
            {loadError instanceof Error ? loadError.message : String(loadError)}
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void reloadFromDisk()}
            className="mx-auto mt-4"
          >
            <RotateCcw className="size-3" />
            {uiT("Retry")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {showPathHeader ? (
        <FileBreadcrumb path={path} cwd={cwd} onOpenFile={onOpenFile}>
          {markdown || svg ? (
            <IconButton
              size="sm"
              label={uiT(mode === "preview" ? "Source" : "Preview")}
              onClick={() => setMode(mode === "preview" ? "source" : "preview")}
            >
              {mode === "preview" ? <Code /> : <Eye />}
            </IconButton>
          ) : null}
        </FileBreadcrumb>
      ) : null}
      {showDiff && gitDiff?.eolOnly && (
        <p
          role="status"
          className="shrink-0 border-b border-stroke px-3 py-1 text-[12px] text-content/60"
        >
          {gitDiff.kind === "staged" ? uiT("Staged") : uiT("Unstaged")}{" "}
          {uiT("line-ending changes. Line breaks are normalized in this view.")}
        </p>
      )}
      {markdown || svg ? (
        <MarkdownViewShell
          showToggle={!showPathHeader}
          mode={mode}
          onModeChange={setMode}
          preview={
            markdown ? (
              <FilePreviewSearch
                active={active && mode === "preview"}
                contentVersion={draft}
              >
                <MarkdownDocumentPreview
                  text={draft}
                  metadataLabel="Properties"
                  cwd={cwd}
                  onOpenFile={onOpenFile}
                />
              </FilePreviewSearch>
            ) : (
              <SvgPreview source={draft} />
            )
          }
          source={
            <div className="flex h-full min-h-0 min-w-0 flex-col">
              <CodeMirrorEditor
                key={path}
                path={path}
                commentPath={relativePath}
                value={baseline!.content}
                showDiff={showDiff}
                gitOriginal={gitOriginal}
                active={active && mode === "source"}
                navigation={navigation}
                onDirtyChange={dirtyChange}
                onErrorCountChange={errorCountChange}
                onSave={save}
                canAutosave={() => !pendingDiskRef.current}
                onStageGit={
                  showDiff && gitDiff?.kind === "unstaged"
                    ? stageGit
                    : undefined
                }
                onDocChange={setDraft}
              />
            </div>
          }
        />
      ) : (
        <CodeMirrorEditor
          key={path}
          path={path}
          commentPath={relativePath}
          value={baseline!.content}
          showDiff={showDiff}
          gitOriginal={gitOriginal}
          active={active}
          navigation={navigation}
          onDirtyChange={dirtyChange}
          onErrorCountChange={errorCountChange}
          onSave={save}
          canAutosave={() => !pendingDiskRef.current}
          onStageGit={
            showDiff && gitDiff?.kind === "unstaged" ? stageGit : undefined
          }
        />
      )}
      {!saveMutation.isIdle || saveError ? (
        <footer className="flex h-6 shrink-0 items-center justify-end border-t border-stroke px-2.5 font-mono text-[10.5px] text-content/40">
          {saving ? (
            <span>{uiT("Saving…")}</span>
          ) : saveError ? (
            <span
              className="max-w-64 truncate text-destructive"
              title={
                saveError instanceof Error
                  ? saveError.message
                  : String(saveError)
              }
            >
              {uiT("Save failed: ")}
              {saveError instanceof Error
                ? saveError.message
                : String(saveError)}
            </span>
          ) : saveMutation.isSuccess ? (
            <span>{uiT("Saved")}</span>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}

export function CodeMirrorEditor({
  path,
  commentPath,
  value,
  showDiff,
  gitOriginal,
  active,
  navigation,
  onDirtyChange,
  onErrorCountChange,
  onSave,
  canAutosave,
  onStageGit,
  onDocChange,
  formatOnSave = true,
}: {
  path: string;
  commentPath: string;
  value: string;
  showDiff: boolean;
  gitOriginal: string | null;
  active: boolean;
  navigation?: EditorNavigationRequest | null;
  onDirtyChange: (dirty: boolean) => void;
  onErrorCountChange: (count: number) => void;
  onSave: (content: string) => Promise<void>;
  canAutosave: () => boolean;
  onStageGit?: (contents: string) => Promise<void>;
  onDocChange?: (content: string) => void;
  formatOnSave?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const savedDocumentRef = useRef<Text | null>(null);
  const dirtyRef = useRef(false);
  const activeRef = useRef(active);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const onErrorCountChangeRef = useRef(onErrorCountChange);
  const onSaveRef = useRef(onSave);
  const canAutosaveRef = useRef(canAutosave);
  const onStageGitRef = useRef(onStageGit);
  const canStage = onStageGit !== undefined;
  const onDocChangeRef = useRef(onDocChange);
  const valueRef = useRef(value);
  const navigationTokenRef = useRef<number | undefined>(undefined);
  const pendingNavigationRef = useRef<EditorNavigationRequest | null>(null);
  const gitOriginalRef = useRef(gitOriginal);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const colorScheme = useColorScheme();
  const codeThemes = useCodeThemes();
  const codePalette = useCodeThemePalette(codeThemes[colorScheme]);
  const [commentTarget, setCommentTarget] =
    useState<DiffCommentComposerTarget | null>(null);
  const [selectionTarget, setSelectionTarget] =
    useState<EditorSelectionTarget | null>(null);
  const gitOptions = {
    onStage: canStage
      ? (contents: string) => onStageGitRef.current?.(contents)
      : undefined,
    onComment: setCommentTarget,
  };
  activeRef.current = active;
  onDirtyChangeRef.current = onDirtyChange;
  onErrorCountChangeRef.current = onErrorCountChange;
  onSaveRef.current = onSave;
  canAutosaveRef.current = canAutosave;
  onStageGitRef.current = onStageGit;
  onDocChangeRef.current = onDocChange;
  valueRef.current = value;
  gitOriginalRef.current = gitOriginal;

  const setDirty = (nextDirty: boolean) => {
    if (dirtyRef.current === nextDirty) return;
    dirtyRef.current = nextDirty;
    onDirtyChangeRef.current(nextDirty);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const language = new Compartment();
    let disposed = false;
    let saveGeneration = 0;
    let autosaveTimer = 0;
    let view: EditorView;

    const markDirty = () => {
      const saved = savedDocumentRef.current;
      setDirty(saved ? !view.state.doc.eq(saved) : false);
    };

    const save = (automatic = false) => {
      const retryPendingAutosave = autosaveTimer !== 0 && loadAutosave();
      window.clearTimeout(autosaveTimer);
      const generation = ++saveGeneration;
      void (async () => {
        const before = view.state.doc.toString();
        if (formatOnSave && loadFormatOnSave()) {
          const result = await formatText(
            path,
            before,
            view.state.selection.main.head,
          );
          if (disposed || generation !== saveGeneration) return;

          if (
            result &&
            result.formatted !== before &&
            view.state.doc.toString() === before
          ) {
            replaceEditorDoc(view, result.formatted, {
              selection: {
                anchor: Math.min(
                  Math.max(0, result.cursorOffset),
                  result.formatted.length,
                ),
              },
            });
          }
        }

        const document = view.state.doc;
        if (automatic && !canAutosaveRef.current()) return;
        try {
          await onSaveRef.current(document.toString());
        } catch {
          if (
            retryPendingAutosave &&
            !disposed &&
            generation === saveGeneration &&
            dirtyRef.current
          ) {
            scheduleAutosave();
          }
          return;
        }
        if (disposed || generation !== saveGeneration) return;
        savedDocumentRef.current = document;
        markDirty();
      })();
      return true;
    };

    function scheduleAutosave() {
      window.clearTimeout(autosaveTimer);
      if (!loadAutosave()) return;
      autosaveTimer = window.setTimeout(() => {
        autosaveTimer = 0;
        if (dirtyRef.current && loadAutosave() && canAutosaveRef.current()) {
          save(true);
        }
      }, FILE_EDITOR_AUTOSAVE_DELAY_MS);
    }

    view = new EditorView({
      doc: valueRef.current,
      parent: host,
      extensions: [
        minimalSetup,
        showDiff ? editorGitConfig.of(editorGit(gitOptions)) : [],
        lineNumbers(),
        foldGutter(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        editorPreferences.of(editorPreferenceExtensions()),
        wrappedLineIndent,
        language.of([]),
        editorScheme.of(schemeExtensions(isLightScheme() ? "light" : "dark")),
        editorMatching,
        editorTyping(path),
        editorAutocomplete,
        editorLint(path, (count) => onErrorCountChangeRef.current(count)),
        editorScrollbar,
        editorSearch,
        Prec.high(
          keymap.of([
            ...foldKeymap,
            { key: "Mod-s", run: () => save(), preventDefault: true },
            {
              key: "Tab",
              run: (view) => {
                if (
                  completionStatus(view.state) === "active" &&
                  acceptCompletion(view)
                ) {
                  return true;
                }
                return tryExpandEmmet(view) || indentOrInsertTab(view);
              },
              shift: indentLess,
              preventDefault: true,
            },
          ]),
        ),
        EditorView.updateListener.of((update) => {
          if (
            update.transactions.some(
              (tr) =>
                (tr.selection || tr.docChanged) &&
                !tr.annotation(diskReload) &&
                !tr.annotation(sourceNavigation),
            )
          ) {
            pendingNavigationRef.current = null;
          }
          if (update.selectionSet) {
            setSelectionTarget(editorSelectionTarget(update.view, commentPath));
          } else if (update.docChanged) {
            setSelectionTarget(null);
          }
          if (!update.docChanged) return;
          onDocChangeRef.current?.(update.state.doc.toString());
          if (update.transactions.some((tr) => tr.annotation(diskReload))) {
            return;
          }
          markDirty();
          scheduleAutosave();
        }),
        EditorView.domEventHandlers({
          blur: () => {
            pendingNavigationRef.current = null;
          },
        }),
      ],
    });
    const unsubscribePreferences = subscribeEditorPreferences(() => {
      view.dispatch({ effects: editorPreferences.reconfigure(editorPreferenceExtensions()) });
    });
    savedDocumentRef.current = view.state.doc;
    dirtyRef.current = false;
    viewRef.current = view;
    lockOverscroll(view.scrollDOM as HTMLDivElement);
    if (showDiff && gitOriginalRef.current != null) {
      setGitOriginal(view, gitOriginalRef.current);
    }
    if (activeRef.current) view.focus();

    void languageForPath(path).then((extension) => {
      if (!disposed && extension) {
        view.dispatch({ effects: language.reconfigure(extension) });
      }
    });

    return () => {
      disposed = true;
      unsubscribePreferences();
      window.clearTimeout(autosaveTimer);
      onErrorCountChangeRef.current(0);
      lockOverscroll(null);
      viewRef.current = null;
      savedDocumentRef.current = null;
      setSelectionTarget(null);
      view.destroy();
    };
  }, [formatOnSave, lockOverscroll, path, showDiff]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editorScheme.reconfigure(schemeExtensions(colorScheme)),
    });
  }, [colorScheme, codePalette]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !showDiff) return;
    view.dispatch({
      effects: editorGitConfig.reconfigure(editorGit(gitOptions)),
    });
  }, [canStage, showDiff]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !showDiff) return;
    preserveEditorViewport(view, () => {
      setGitOriginal(view, gitOriginal);
    });
  }, [gitOriginal, showDiff]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || dirtyRef.current) return;
    if (view.state.doc.toString() === value) return;
    replaceEditorDoc(view, value, {
      annotations: [Transaction.addToHistory.of(false), diskReload.of(true)],
    });
    savedDocumentRef.current = view.state.doc;
    setDirty(false);
  }, [value]);

  useEffect(() => {
    if (!navigation) {
      pendingNavigationRef.current = null;
      return;
    }
    if (navigationTokenRef.current !== navigation.token) {
      navigationTokenRef.current = navigation.token;
      pendingNavigationRef.current = navigation;
    }
    const pending = pendingNavigationRef.current;
    if (!pending) return;
    const view = viewRef.current;
    if (!view) return;

    let cancelled = false;
    const run = () => {
      if (cancelled || pendingNavigationRef.current !== pending) return;
      revealNavigation(view, pending);
      // Retry a clamped location only while its line has not arrived and
      // the user has not moved the caret, edited the file, or left the editor.
      if (pending.line <= view.state.doc.lines) {
        pendingNavigationRef.current = null;
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(run));

    return () => {
      cancelled = true;
    };
  }, [navigation, value]);

  useEffect(() => {
    if (!active) return;
    const view = viewRef.current;
    if (!view) return;
    view.requestMeasure();
    const activeEl = document.activeElement;
    if (
      activeEl &&
      view.dom.contains(activeEl) &&
      activeEl !== view.contentDOM
    ) {
      return;
    }
    view.focus();
  }, [active, path]);

  useEffect(() => {
    if (!active) setSelectionTarget(null);
  }, [active]);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div ref={hostRef} className="min-h-0 flex-1" />
      </div>
      <PresenceBoundary propagate>{commentTarget ? (
        <DiffCommentComposer
          path={commentPath}
          target={commentTarget}
          onDismiss={() => setCommentTarget(null)}
        />
      ) : null}</PresenceBoundary>
      <EditorSelectionMenu
        selection={selectionTarget}
        onDismiss={() => setSelectionTarget(null)}
      />
    </>
  );
}

function editorSelectionTarget(
  view: EditorView,
  path: string,
): EditorSelectionTarget | null {
  if (view.state.selection.ranges.length !== 1) return null;
  const selection = view.state.selection.main;
  if (selection.empty) return null;

  const text = view.state.sliceDoc(selection.from, selection.to);
  if (!text.trim()) return null;
  const coordinates = view.coordsAtPos(
    selection.head,
    selection.head === selection.from ? 1 : -1,
  );
  if (!coordinates) return null;

  const viewport = view.scrollDOM.getBoundingClientRect();
  if (
    coordinates.bottom < viewport.top ||
    coordinates.top > viewport.bottom ||
    coordinates.right < viewport.left ||
    coordinates.left > viewport.right
  ) {
    return null;
  }

  const lastSelectedPosition = Math.max(selection.from, selection.to - 1);
  return {
    path,
    startLine: view.state.doc.lineAt(selection.from).number,
    endLine: view.state.doc.lineAt(lastSelectedPosition).number,
    anchor: new DOMRect(
      coordinates.left,
      coordinates.top,
      Math.max(1, coordinates.right - coordinates.left),
      Math.max(1, coordinates.bottom - coordinates.top),
    ),
  };
}

function revealNavigation(view: EditorView, target: EditorNavigation) {
  const lineNumber = Math.min(Math.max(1, target.line), view.state.doc.lines);
  const line = view.state.doc.line(lineNumber);
  const column = Math.max(1, target.column ?? 1);
  const anchor = Math.min(line.from + column - 1, line.to);
  view.dispatch({
    selection: { anchor },
    effects: EditorView.scrollIntoView(anchor, { y: "center" }),
    annotations: sourceNavigation.of(true),
  });
  view.focus();
}

const diskReload = Annotation.define<boolean>();
const sourceNavigation = Annotation.define<boolean>();

function indentOrInsertTab(view: EditorView): boolean {
  const { state, dispatch } = view;
  if (state.readOnly) return false;
  if (state.selection.ranges.some((range) => !range.empty)) {
    return indentMore(view);
  }

  const unit = state.facet(indentUnit);
  if (unit === "\t") {
    dispatch(
      state.update(state.replaceSelection("\t"), {
        scrollIntoView: true,
        userEvent: "input",
      }),
    );
    return true;
  }

  const width = getIndentUnit(state);
  dispatch(
    state.update(
      state.changeByRange((range) => {
        const line = state.doc.lineAt(range.head);
        const column = countColumn(
          line.text.slice(0, range.head - line.from),
          state.tabSize,
        );
        const insert = " ".repeat(width - (column % width) || width);
        return {
          changes: { from: range.head, insert },
          range: EditorSelection.cursor(range.head + insert.length),
        };
      }),
      { scrollIntoView: true, userEvent: "input" },
    ),
  );
  return true;
}

type LineRange = { from: number; to: number };

const wrappedLineIndent = StateField.define<DecorationSet>({
  create(state) {
    return Decoration.set(
      indentDecorations(state, [{ from: 0, to: state.doc.length }]),
      true,
    );
  },
  update(decorations, transaction) {
    if (transaction.startState.tabSize !== transaction.state.tabSize) {
      return Decoration.set(indentDecorations(transaction.state, [{ from: 0, to: transaction.state.doc.length }]));
    }
    if (!transaction.docChanged) return decorations;
    const ranges: LineRange[] = [];
    transaction.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      const from = transaction.state.doc.lineAt(fromB).from;
      const to = transaction.state.doc.lineAt(toB).to;
      ranges.push({ from, to });
    });
    const changedLines = mergeLineRanges(ranges);
    return decorations.map(transaction.changes).update({
      filter: (from) =>
        !changedLines.some((range) => from >= range.from && from <= range.to),
      add: indentDecorations(transaction.state, changedLines),
      sort: true,
    });
  },
  provide: (field) => EditorView.decorations.from(field),
});

function indentDecorations(state: EditorState, ranges: LineRange[]) {
  const decorations = [];
  for (const range of ranges) {
    let line = state.doc.lineAt(range.from);
    while (line.from <= range.to) {
      const columns = leadingIndentColumns(line.text, state.tabSize);
      if (columns > 0) {
        const indent = Math.min(columns, 40);
        decorations.push(
          Decoration.line({
            attributes: {
              class: "cm-wrapped-indent",
              style: `padding-left: calc(${indent}ch + 6px); text-indent: -${indent}ch`,
            },
          }).range(line.from),
        );
      }
      if (line.number >= state.doc.lines) break;
      line = state.doc.line(line.number + 1);
    }
  }
  return decorations;
}

function leadingIndentColumns(text: string, tabSize: number): number {
  let columns = 0;
  for (const character of text) {
    if (character === " ") {
      columns += 1;
    } else if (character === "\t") {
      columns += tabSize - (columns % tabSize);
    } else {
      break;
    }
  }
  return columns;
}

function mergeLineRanges(ranges: LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const merged: LineRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to + 1) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * SVG is text, so it stays editable in CodeMirror and renders through an
 * `<img>` rather than inline. In that context the webview runs no script and
 * fetches no external reference the document asks for, which is what makes it
 * safe to preview a file the agent may have just written.
 */
function SvgPreview({ source }: { source: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const next = URL.createObjectURL(
      new Blob([source], { type: "image/svg+xml" }),
    );
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [source]);

  if (!url) return null;
  return (
    <div className="grid h-full place-items-center overflow-auto p-6">
      <img src={url} alt="" className="max-h-full max-w-full object-contain" />
    </div>
  );
}

function isSvgPath(path: string): boolean {
  return basename(path).toLowerCase().endsWith(".svg");
}

function isMarkdownPath(path: string): boolean {
  const name = basename(path).toLowerCase();
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  return [".md", ".mdx", ".markdown"].includes(extension);
}
