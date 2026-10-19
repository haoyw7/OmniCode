import type { Dispatch, SetStateAction } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { loadEditorPreferences } from "../../features/connections/files/model/editorPreferences";
import {
  invalidateProjectFiles,
  rememberOpenedFile,
  resolveFileOpenRequest,
  resolveOpenablePath,
} from "../../features/connections/files/model/fileIndex";
import { sameProjectPath } from "../../features/projects/model/recents";
import {
  type EditorNavigationTarget,
  type OpenFileFn,
} from "../../features/search/model/search";
import { planTitle } from "../../features/sessions/model/plan";
import {
  sessionExecutionCwd,
  type Session,
} from "../../features/sessions/model/session";
import { loadFileTabMode } from "../../features/settings/model/settings";
import {
  findSurfacePane,
  isFilesystemTab,
  leafIds,
  newFileTab,
  newPlanTab,
  openChangesTab,
  openEditorTab,
  openFileExplorer,
  openSessionChangesTab,
  pinEditorFile,
  surfacePanes,
  withSurfacePanes,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";
import { type GitFileDiffKind } from "../../platform/tauri/fs";
import { isEqualOrInside, rebasePath } from "../../shared/lib/paths";
import { orderByIds } from "../../shared/lib/reorder";
import { dropOpenFiles } from "../model/workspaceSelectors";

type Options = {
  tabs: WorkspaceTab[];
  initialDirtyFileIds?: readonly string[];
  context: () => {
    tabs: WorkspaceTab[];
    sessions: Session[];
    activeTabId: string;
    projectCwd: string;
    sidebarCwd: string;
    gitCwd: string;
  };
  ensureContentTab: (cwd: string) => WorkspaceTab;
  activateTab: (id: string, paneId?: string) => void;
  showWorkspace: () => void;
  setTabs: Dispatch<SetStateAction<WorkspaceTab[]>>;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  setProjectTerminalFocused: Dispatch<SetStateAction<boolean>>;
};

/** Owns editor/review resources, unsaved state and asynchronous file ownership. */
export function useWorkspaceFiles(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const context = useCallback(() => latest.current.context(), []);
  const ensureContentTab = useCallback(
    (cwd: string) => latest.current.ensureContentTab(cwd),
    [],
  );
  const { setTabs, setComposerFocused, setProjectTerminalFocused } = options;
  const [editorNavigations, setEditorNavigations] = useState<
    Record<
      string,
      {
        ownerSessionId?: string;
        target: EditorNavigationTarget;
      }
    >
  >({});
  const editorNavigationToken = useRef(0);
  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(
    () => new Set(options.initialDirtyFileIds ?? []),
  );
  // Not carried across a window transfer the way dirty state is: the editor
  // re-lints whatever it mounts, so the counts rebuild themselves.
  const [fileErrorCounts, setFileErrorCounts] = useState<Map<string, number>>(
    () => new Map(),
  );
  const dirtyFilesRef = useRef(dirtyFiles);
  dirtyFilesRef.current = dirtyFiles;
  const isDirty = useCallback(
    (id: string) => dirtyFilesRef.current.has(id),
    [],
  );
  const hasDirtyFiles = useCallback(() => dirtyFilesRef.current.size > 0, []);
  const readDirtyFiles = useCallback(
    (): ReadonlySet<string> => new Set(dirtyFilesRef.current),
    [],
  );
  const forgetDirtyFiles = useCallback((ids: Iterable<string>) => {
    const removed = new Set(ids);
    setDirtyFiles((previous) => {
      if (![...removed].some((id) => previous.has(id))) return previous;
      const next = new Set(previous);
      for (const id of removed) next.delete(id);
      return next;
    });
  }, []);
  const pendingTabResources = useRef(new Map<string, number>());
  const resolveTabResource = useCallback(
    <T,>(tabId: string, work: Promise<T>) => {
      pendingTabResources.current.set(
        tabId,
        (pendingTabResources.current.get(tabId) ?? 0) + 1,
      );
      return work.finally(() => {
        const remaining = (pendingTabResources.current.get(tabId) ?? 1) - 1;
        if (remaining) pendingTabResources.current.set(tabId, remaining);
        else pendingTabResources.current.delete(tabId);
      });
    },
    [],
  );
  const hasPendingResources = useCallback(
    (tabId: string) => pendingTabResources.current.has(tabId),
    [],
  );
  /**
   * A file an agent touched opens in the review: a session's own checkpoint
   * review when one is named, otherwise every working-tree change with source
   * control beside it.
   */
  const onOpenDiff = useCallback(
    (path?: string, session?: { sessionId: string; cwd: string; turnId?: string }) => {
      void (async () => {
        const diffCwd = session?.cwd ?? context().gitCwd;
        const diffProjectCwd = session
          ? context().sessions.find((entry) => entry.id === session.sessionId)
              ?.cwd
          : context().sidebarCwd;
        const target = session
          ? context().tabs.find((tab) =>
              leafIds(tab.layout).includes(session.sessionId),
            )
          : ensureContentTab(diffProjectCwd ?? context().projectCwd);
        if (!target) return;
        const ownerSessionId =
          session?.sessionId ??
          leafIds(target.layout).find((id) =>
            context().sessions.some((entry) => entry.id === id),
          );
        const initialMode =
          target.surfaceMode ??
          (loadFileTabMode() === "workspace" ? "unified" : "split");
        const resolved = path
          ? ((await resolveTabResource(
              target.id,
              resolveOpenablePath(diffCwd, path),
            )) ?? path)
          : undefined;
        if (
          !context().tabs.some(
            (tab) =>
              tab.id === target.id &&
              (!ownerSessionId || leafIds(tab.layout).includes(ownerSessionId)),
          )
        )
          return;
        if (resolved) rememberOpenedFile(diffCwd, resolved);
        setTabs((prev) =>
          prev.map((tab) => {
            if (
              tab.id !== target.id ||
              (ownerSessionId && !leafIds(tab.layout).includes(ownerSessionId))
            )
              return tab;
            tab = { ...tab, surfaceMode: tab.surfaceMode ?? initialMode };
            return session
              ? openSessionChangesTab(
                  tab,
                  session.cwd,
                  session.sessionId,
                  resolved,
                  diffProjectCwd,
                  false,
                  session.turnId,
                )
              : openChangesTab(tab, diffCwd, resolved, undefined, diffProjectCwd);
          }),
        );
        if (context().activeTabId !== target.id) return;
        setComposerFocused(false);
      })();
    },
    [ensureContentTab],
  );

  /** Stack one section's working-tree changes in one review beside source control. */
  const onOpenAllChanges = useCallback(
    (kind: GitFileDiffKind, project = context().sidebarCwd) => {
      if (!project || project === "~") return;
      const target = ensureContentTab(project);
      const workingCwd = sameProjectPath(project, context().sidebarCwd)
        ? context().gitCwd
        : project;
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === target.id
            ? openChangesTab(
                {
                  ...tab,
                  surfaceMode:
                    tab.surfaceMode ??
                    (loadFileTabMode() === "workspace" ? "unified" : "split"),
                },
                workingCwd,
                undefined,
                kind,
                project,
              )
            : tab,
        ),
      );
      setComposerFocused(false);
    },
    [ensureContentTab],
  );

  const onReorderFiles = useCallback((paneId: string, ids: string[]) => {
    setTabs((prev) =>
      prev.map((tab) => {
        const found = findSurfacePane(tab, paneId);
        if (!found) return tab;
        return withSurfacePanes(
          tab,
          found.kind,
          surfacePanes(tab, found.kind).map((pane) =>
            pane.id === paneId
              ? { ...pane, files: orderByIds(pane.files, ids) }
              : pane,
          ),
        );
      }),
    );
  }, []);

  const onFileMoved = useCallback((from: string, to: string) => {
    invalidateProjectFiles();
    setTabs((prev) =>
      prev.map((tab) => {
        return {
          ...tab,
          editorPanes: tab.editorPanes.map((pane) => ({
            ...pane,
            files: pane.files.map((file) =>
              isFilesystemTab(file)
                ? { ...file, path: rebasePath(file.path, from, to) }
                : file,
            ),
          })),
        };
      }),
    );
  }, []);

  const onFileDeleted = useCallback((path: string) => {
    invalidateProjectFiles();
    const dropped = new Set<string>();
    for (const tab of context().tabs) {
      for (const pane of tab.editorPanes) {
        for (const file of pane.files) {
          if (isFilesystemTab(file) && isEqualOrInside(file.path, path)) {
            dropped.add(file.id);
          }
        }
      }
    }
    setTabs((prev) =>
      prev.map((tab) =>
        dropOpenFiles(tab, (filePath) => isEqualOrInside(filePath, path)),
      ),
    );
    if (dropped.size === 0) return;
    setDirtyFiles((prev) => {
      const next = new Set(prev);
      for (const id of dropped) next.delete(id);
      return next;
    });
  }, []);

  const openOwnedFile = useCallback(
    (
      path: string,
      navigation?: Parameters<OpenFileFn>[1],
      options?: Parameters<OpenFileFn>[2],
      sessionId?: string,
    ) => {
      const source = sessionId
        ? context().sessions.find((session) => session.id === sessionId)
        : undefined;
      if (sessionId && !source) return;
      const fileCwd = source ? sessionExecutionCwd(source) : context().gitCwd;
      const fileProjectCwd = source?.cwd ?? context().sidebarCwd;
      // Capture the owner before resolving the path. A later session switch
      // must not redirect an in-flight link or bring the old session forward.
      const owner = source
        ? context().tabs.find((tab) => leafIds(tab.layout).includes(source.id))
        : ensureContentTab(fileProjectCwd);
      if (!owner) return;
      const ownerSessionId =
        source?.id ??
        leafIds(owner.layout).find((id) =>
          context().sessions.some((session) => session.id === id),
        );
      const initialMode =
        owner.surfaceMode ??
        (loadFileTabMode() === "workspace" ? "unified" : "split");
      void (async () => {
        const resolved = await resolveTabResource(
          owner.id,
          resolveFileOpenRequest(fileCwd, path, options),
        );
        if (
          !context().tabs.some(
            (tab) =>
              tab.id === owner.id &&
              (!ownerSessionId || leafIds(tab.layout).includes(ownerSessionId)),
          )
        )
          return;
        rememberOpenedFile(fileCwd, resolved);
        const file = newFileTab(
          resolved,
          fileCwd,
          false,
          undefined,
          fileProjectCwd,
        );
        setTabs((prev) =>
          prev.map((entry) =>
            entry.id === owner.id &&
            (!ownerSessionId || leafIds(entry.layout).includes(ownerSessionId))
              ? openEditorTab(
                  openFileExplorer(
                    { ...entry, surfaceMode: entry.surfaceMode ?? initialMode },
                    fileCwd,
                    fileProjectCwd,
                  ),
                  file,
                  {
                    split: "right",
                    pin: !!options?.pin || !loadEditorPreferences().previewTabs,
                  },
                )
              : entry,
          ),
        );
        if (navigation) {
          editorNavigationToken.current += 1;
          const target = {
            path: resolved,
            ...navigation,
            token: editorNavigationToken.current,
          };
          setEditorNavigations((current) => ({
            ...current,
            [owner.id]: { ownerSessionId, target },
          }));
        }
        if (context().activeTabId !== owner.id) return;
        setProjectTerminalFocused(false);
        setComposerFocused(false);
      })();
    },
    [ensureContentTab],
  );

  const onShowFileExplorer = useCallback(
    (cwd: string, executionCwd?: string, sessionId?: string) => {
      if (!cwd || cwd === "~") return;
      const owner = sessionId
        ? context().tabs.find((tab) => leafIds(tab.layout).includes(sessionId))
        : ensureContentTab(cwd);
      if (!owner) return;
      if (sessionId) latest.current.activateTab(owner.id, sessionId);
      const workingCwd =
        executionCwd ??
        (sameProjectPath(cwd, context().sidebarCwd) ? context().gitCwd : cwd);
      setTabs((current) =>
        current.map((tab) =>
          tab.id === owner.id
            ? openFileExplorer(
                { ...tab, surfaceMode: "split" },
                workingCwd,
                cwd,
                sessionId,
              )
            : tab,
        ),
      );
      setComposerFocused(false);
    },
    [ensureContentTab],
  );

  const onOpenFile = useCallback<OpenFileFn>(
    (path, navigation, options) => {
      latest.current.showWorkspace();
      openOwnedFile(path, navigation, options);
    },
    [openOwnedFile],
  );
  const onOpenSessionFile = useCallback(
    (path: string, sessionId: string) =>
      openOwnedFile(path, undefined, undefined, sessionId),
    [openOwnedFile],
  );

  const onOpenPlan = useCallback((sessionId: string, blockId: string) => {
    const session = context().sessions.find((entry) => entry.id === sessionId);
    const block = session?.blocks.find((entry) => entry.id === blockId);
    if (!session || !block) return;
    const tab = context().tabs.find((entry) =>
      leafIds(entry.layout).includes(session.id),
    );
    if (!tab) return;
    const file = {
      ...newPlanTab(
        session.id,
        block.id,
        planTitle(block.text),
        sessionExecutionCwd(session),
      ),
      ...(session.executionCwd ? { projectCwd: session.cwd } : {}),
    };
    setTabs((prev) =>
      prev.map((entry) =>
        entry.id === tab.id
          ? openEditorTab(
              {
                ...entry,
                surfaceMode:
                  entry.surfaceMode ??
                  (loadFileTabMode() === "workspace" ? "unified" : "split"),
              },
              file,
            )
          : entry,
      ),
    );
    setComposerFocused(false);
  }, []);

  const onPinFile = useCallback((fileId: string) => {
    setTabs((prev) => {
      const next = prev.map((tab) => pinEditorFile(tab, fileId));
      return next.some((tab, index) => tab !== prev[index]) ? next : prev;
    });
  }, []);

  const onFileDirtyChange = useCallback(
    (fileId: string, dirty: boolean) => {
      // An edited preview must not be replaced by the next click.
      if (dirty) onPinFile(fileId);
      setDirtyFiles((prev) => {
        if (prev.has(fileId) === dirty) return prev;
        const next = new Set(prev);
        if (dirty) next.add(fileId);
        else next.delete(fileId);
        return next;
      });
    },
    [onPinFile],
  );

  /** The editor reports 0 as it unmounts, so closed tabs drop out on their own. */
  const onFileErrorCountChange = useCallback(
    (fileId: string, count: number) => {
      setFileErrorCounts((prev) => {
        if ((prev.get(fileId) ?? 0) === count) return prev;
        const next = new Map(prev);
        if (count > 0) next.set(fileId, count);
        else next.delete(fileId);
        return next;
      });
    },
    [],
  );

  const onSelectFileSurface = useCallback((paneId: string, fileId: string) => {
    setTabs((prev) =>
      prev.map((tab) => {
        const found = findSurfacePane(tab, paneId);
        if (!found) return tab;
        return withSurfacePanes(
          { ...tab, focusedId: paneId },
          found.kind,
          surfacePanes(tab, found.kind).map((pane) =>
            pane.id === paneId ? { ...pane, activeFileId: fileId } : pane,
          ),
        );
      }),
    );
    setComposerFocused(false);
  }, []);

  const openFilePaths = useMemo(() => {
    const paths: string[] = [];
    const seen = new Set<string>();
    for (const tab of options.tabs) {
      for (const pane of tab.editorPanes) {
        for (const file of pane.files) {
          if (!isFilesystemTab(file) || seen.has(file.path)) continue;
          seen.add(file.path);
          paths.push(file.path);
        }
      }
    }
    return paths;
  }, [options.tabs]);

  return {
    dirtyFiles,
    fileErrorCounts,
    editorNavigations,
    openFilePaths,
    isDirty,
    hasDirtyFiles,
    readDirtyFiles,
    forgetDirtyFiles,
    hasPendingResources,
    onOpenDiff,
    onOpenAllChanges,
    onReorderFiles,
    onFileMoved,
    onFileDeleted,
    onShowFileExplorer,
    onOpenFile,
    onOpenSessionFile,
    onOpenPlan,
    onPinFile,
    onFileDirtyChange,
    onFileErrorCountChange,
    onSelectFileSurface,
  };
}
export type WorkspaceFiles = ReturnType<typeof useWorkspaceFiles>;
