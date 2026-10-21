import { cn } from "../../../shared/lib/cn";
import { toast } from "sonner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { invalidateAfterChange, queryClient } from "../../../shared/lib/queryClient";
import { gitHeadMessageQuery, gitRangeContextQuery, gitKeys, gitDiffIndexQuery, gitPrStatusQuery, installGitQueryInvalidation, isGitCwd } from "../model/gitQueries";
import { motion as motionElement } from "motion/react";
import { panelTransition, immediateTransition } from "../../../shared/motion/tokens";
import { reducedMotionQuery as motionPreferenceQuery } from "../../../shared/lib/reducedMotion";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { MenuHover } from "../../../shared/ui/MenuHover";
import { Button } from "../../../shared/ui/forms/Button";
import { IconButton } from "../../../shared/ui/forms/IconButton";
import { Textarea } from "../../../shared/ui/forms/Textarea";
import {
  AnimatedCollapse,
  useCollapseMotion,
} from "../../../shared/ui/AnimatedCollapse";
import {
  SurfaceVisibilityContext,
  useSurfaceVisibility,
} from "../../../shared/ui/SurfaceVisibility";
import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CloudUpload,
  ExternalLink,
  FileDiff,
  FolderTree,
  GitBranch,
  GitPullRequest,
  ListBullet,
  Minus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Undo2,
  WandSparkles,
  X,
} from "../../../shared/ui/icons";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import { FileTypeIcon } from "../../connections/files/ui/FileTypeIcon";
import {
  GitHistoryGraph,
  GraphResizeSash,
  GRAPH_PANEL_DEFAULT,
  GRAPH_PANEL_MIN,
  loadGraphPanelHeight,
  saveGraphPanelHeight,
} from "./GitHistoryGraph";
import {
  basename,
  gitCommit,
  gitDiscardAll,
  gitDiscardFile,
  gitPrCreate,
  gitPull,
  gitPush,
  gitStageAll,
  gitStageFile,
  gitSync,
  gitUnstageAll,
  gitUnstageFile,
  notifyGitChanged,
  setFsWatch,
  subscribeFsWatch,
  type GitChangedFile,
  type GitDiffIndex,
  type GitFileDiffKind,
  type GitHistoryCommit,
  type GitPr,
} from "../../../platform/tauri/fs";
import type { HarnessId } from "../../sessions/model/session";
import { recordInboxSelfActivity } from "../../inbox/model/inboxSelfActivity";
import {
  loadChangesView,
  saveChangesView,
  type ChangesView,
} from "../../settings/model/appearance";
import {
  generateCommitMessage,
  generatePrContent,
} from "../../../integrations/harness";
import { invalidateWatchedFiles } from "../../connections/files/model/fileWatch";
import { MOD } from "../../../platform/tauri/platform";
import { applyProjectDiffStats } from "../hooks/useProjectDiffStats";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { pathKey } from "../../../shared/lib/paths";
import { Spinner } from "../../../shared/ui/primitives/Spinner";

/** Fallback only: the OS watcher reports git metadata and listed folders, so
 * polling just catches edits in folders nobody has expanded. */
const GIT_POLL_MS = 5000;

function confirmNative(message: string, okLabel?: string): Promise<boolean> {
  return ask(message, {
    title: "OmniCode",
    kind: "warning",
    ...(okLabel ? { okLabel } : {}),
  });
}

let stagedOpen = true;
let changesOpen = true;
let graphOpen = true;
let changesView: ChangesView = loadChangesView();
/** Folders the user collapsed in tree view, keyed `<kind>:<dir>`. */
const collapsedDirs = new Set<string>();

type AmendTarget = { branch: string | null; head: string | null };

type Props = {
  branchControl?: ReactNode;
  cwd: string;
  enabled: boolean;
  textHarness?: HarnessId;
  selectedPath?: string;
  selectedKind?: GitFileDiffKind;
  selectedSha?: string;
  onOpenFile: (path: string, kind: GitFileDiffKind, pin?: boolean) => void;
  onOpenAllChanges: (kind: GitFileDiffKind) => void;
  onOpenCommit: (commit: GitHistoryCommit, pin?: boolean) => void;
};

export const GitChangesPanel = memo(function GitChangesPanel({
  branchControl,
  cwd,
  enabled,
  textHarness,
  selectedPath,
  selectedKind,
  selectedSha,
  onOpenFile,
  onOpenAllChanges,
  onOpenCommit,
}: Props) {
  const { t: uiT } = useTranslation();
  const { index, reload } = useDiffIndex(cwd, enabled);
  const mutation = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    scope: { id: `git:${cwd}` },
    onSuccess: () => { toast.success(uiT("Done")); return invalidateAfterChange(gitKeys.all); },
  }, queryClient);
  const execute = useCallback(<T,>(run: () => Promise<T>) => mutation.mutateAsync(run) as Promise<T>, [mutation.mutateAsync]);
  const files = index?.files ?? [];
  const paneRef = useRef<HTMLDivElement>(null);
  const graphPaneRef = useRef<HTMLDivElement>(null);
  const branchMenuRef = useRef<HTMLDivElement>(null);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(true);
  const composerId = useId();
  const composerToggleRef = useRef<HTMLButtonElement>(null);
  // Shared across the header and the changed-files list so no two Git
  // mutations ever run against the same checkout at once.
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [graphHeight, setGraphHeight] = useState(loadGraphPanelHeight);
  const [graphExpanded, setGraphExpanded] = useState(graphOpen);
  const graphMotion = useCollapseMotion(graphExpanded);
  const visible = useSurfaceVisibility();

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 4000);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (!branchMenuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!branchMenuRef.current?.contains(event.target as Node)) {
        setBranchMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [branchMenuOpen]);

  const canPull = Boolean(index?.remote) && Boolean(index?.upstream);

  const pull = async () => {
    if (!canPull) return;
    setStatus(null);
    setBusy("pull");
    try {
      await execute(() => gitPull(cwd));
      reload();
      notifyGitChanged();
      invalidateWatchedFiles();
      setStatus("Pull complete");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
      setBranchMenuOpen(false);
    }
  };

  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane || pane.clientHeight < GRAPH_PANEL_MIN + 160) return;
    const max = pane.clientHeight - 160;
    if (graphHeight > max) {
      setGraphHeight(max);
      saveGraphPanelHeight(max);
    }
  }, [graphHeight]);

  if (!cwd || cwd === "~") {
    return (
      <p className="px-3 py-2 text-[12px] text-content/50">
        {uiT("No project folder")}
      </p>
    );
  }

  return (
    <div
      ref={paneRef}
      data-git-changes-panel
      aria-label={uiT("Changes")}
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      <header className="git-panel-header git-changes-toolbar flex items-center border-b border-stroke">
        <IconButton
          ref={composerToggleRef}
          size="xs"
          label={uiT(composerExpanded ? "Collapse commit panel" : "Expand commit panel")}
          aria-expanded={composerExpanded}
          aria-controls={composerId}
          onClick={() => {
            if (composerExpanded && document.getElementById(composerId)?.contains(document.activeElement)) {
              composerToggleRef.current?.focus();
            }
            setComposerExpanded((expanded) => !expanded);
          }}
        >
          {composerExpanded ? <ChevronDown className="text-ink-secondary" /> : <ChevronRight className="text-ink-secondary" />}
        </IconButton>
        {branchControl ? <div className="flex min-w-0 flex-1 items-center gap-1">{branchControl}</div> : null}
        {status ? (
          <span role="status" className="text-[11px] text-content/50">
            {status}
          </span>
        ) : null}
        {index?.branch ? (
          <div
            ref={branchMenuRef}
            className={cn("relative flex min-w-0 items-center gap-1", branchControl ? "ml-auto shrink-0" : "flex-1")}
          >
            <span className="flex min-w-0 flex-1 items-center gap-1">
              {!branchControl ? <><GitBranch className="size-3 shrink-0" />
              <span data-code-label className="min-w-0 truncate">{index.branch}</span></> : null}
              {index.ahead > 0 ? (
                <span className="shrink-0 tabular-nums text-ink-tertiary">
                  ↑{index.ahead}
                </span>
              ) : null}
              {index.behind > 0 ? (
                <span className="shrink-0 tabular-nums text-ink-tertiary">
                  ↓{index.behind}
                </span>
              ) : null}
            </span>
            <IconButton
              size="xs"
              aria-haspopup="menu"
              label={uiT("Branch actions")}
              aria-expanded={branchMenuOpen}
              disabled={busy !== null}
              onClick={() => setBranchMenuOpen((open) => !open)}
            >
              {busy === "pull" ? (
                <Spinner />
              ) : (
                <MoreHorizontal strokeWidth={2} />
              )}
            </IconButton>
            {branchMenuOpen ? (
              <div
                role="menu"
                aria-label={uiT("Branch actions")}
                className="absolute top-full right-0 z-30 mt-1 min-w-36 rounded-md border border-content/10 panel-menu py-1 shadow-lg"
                data-menu-density="compact"
              >
                <div data-menu-gutter>
                  <Button data-menu-row="single" variant="ghost" size="content"
                    type="button"
                    role="menuitem"
                    disabled={busy !== null || !canPull}
                    title={
                      canPull
                        ? undefined
                        : uiT(
                            "This branch needs a remote and upstream before it can pull",
                          )
                    }
                    onClick={() => void pull()}
                    className="flex w-full items-center gap-2 text-left text-[12px] text-content hover:bg-content/6 disabled:opacity-40 justify-start"
                  >
                    <MenuHover />
                    {busy === "pull" ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    <span data-menu-title>{busy === "pull" ? uiT("Pulling…") : uiT("Pull")}</span>
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <span className="ml-auto" />
        )}
      </header>
      <ChangedFiles
        composerId={composerId}
        composerExpanded={composerExpanded}
        cwd={cwd}
        textHarness={textHarness}
        index={index}
        files={files}
        selected={selectedPath}
        selectedKind={selectedKind}
        fill
        busy={busy}
        setBusy={setBusy}
        execute={execute}
        onOpenFile={onOpenFile}
        onOpenAllChanges={onOpenAllChanges}
        onMutated={(paths) => {
          reload();
          notifyGitChanged();
          invalidateWatchedFiles(paths);
          window.setTimeout(() => invalidateWatchedFiles(paths), 150);
        }}
      />
      <motionElement.div
      initial={false} animate={{ gridTemplateRows: graphExpanded ? "minmax(0, 0px) minmax(0, var(--git-graph-height))" : "minmax(0, 0px) minmax(0, var(--desktop-control-md, 32px))" }} transition={motionPreferenceQuery().matches ? immediateTransition : panelTransition} onAnimationComplete={graphMotion.finish}
        ref={graphPaneRef}
        className="git-history-panel animated-collapse-size relative grid shrink-0 overflow-visible"
        style={
          {
            "--git-graph-height": `${graphHeight}px`,
          } as CSSProperties
        }
        data-fold-state={graphMotion.foldState}

      >
        <div
          className="min-h-0 overflow-visible"
          inert={!graphExpanded}
          aria-hidden={!graphExpanded || undefined}
        >
          <SurfaceVisibilityContext.Provider value={visible && graphExpanded}>
            {graphExpanded || graphMotion.foldState !== "closed" ? (
              <GraphResizeSash
                height={graphHeight}
                onHeightPaint={(next) => {
                  graphPaneRef.current?.style.setProperty(
                    "--git-graph-height",
                    `${next}px`,
                  );
                }}
                onHeightCommit={(next) => {
                  setGraphHeight(next);
                  saveGraphPanelHeight(next);
                }}
                maxHeight={() => {
                  const pane = paneRef.current;
                  if (!pane) return GRAPH_PANEL_DEFAULT * 2;
                  return Math.max(GRAPH_PANEL_MIN, pane.clientHeight - 160);
                }}
              />
            ) : null}
          </SurfaceVisibilityContext.Provider>
        </div>
        <div className="min-h-0 overflow-hidden">
          <GitHistoryGraph
            cwd={cwd}
            enabled={enabled}
            expanded={graphExpanded}
            selectedSha={selectedSha}
            onToggleExpanded={() => {
              graphOpen = !graphExpanded;
              setGraphExpanded(graphOpen);
            }}
            onOpenCommit={onOpenCommit}
          />
        </div>
      </motionElement.div>
    </div>
  );
});

function ChangedFiles({
  composerId,
  composerExpanded,
  cwd,
  textHarness,
  index,
  files,
  selected,
  selectedKind,
  fill,
  busy,
  setBusy,
  execute,
  onOpenFile,
  onOpenAllChanges,
  onMutated,
}: {
  composerId: string;
  composerExpanded: boolean;
  cwd: string;
  textHarness?: HarnessId;
  index: GitDiffIndex | null;
  files: GitChangedFile[];
  selected?: string;
  selectedKind?: GitFileDiffKind;
  fill: boolean;
  busy: string | null;
  setBusy: (value: string | null) => void;
  execute: <T>(run: () => Promise<T>) => Promise<T>;
  onOpenFile: (path: string, kind: GitFileDiffKind, pin?: boolean) => void;
  onOpenAllChanges: (kind: GitFileDiffKind) => void;
  onMutated: (paths?: string[]) => void;
}) {
  const { t: uiT } = useTranslation();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const menuRef = useRef<HTMLDivElement>(null);
  const generateAbortRef = useRef<AbortController | null>(null);
  const generation = useMutation({
    mutationFn: ({ harness, signal }: { harness?: HarnessId; signal: AbortSignal }) => generateCommitMessage(cwd, harness, signal),
  }, queryClient);
  const [message, setMessage] = useState("");
  const [amendTarget, setAmendTarget] = useState<AmendTarget | null>(null);
  const amend = amendTarget !== null;
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!composerExpanded) setMenuOpen(false);
  }, [composerExpanded]);
  const [stagedExpanded, setStagedExpanded] = useState(stagedOpen);
  const [changesExpanded, setChangesExpanded] = useState(changesOpen);
  const [view, setView] = useState<ChangesView>(changesView);
  const { pr, reload: reloadPr } = usePrStatus(cwd, index?.branch);
  const staged = useMemo(() => files.filter((file) => file.staged), [files]);
  const unstaged = useMemo(
    () => files.filter((file) => file.unstaged),
    [files],
  );
  const hasRemote = Boolean(index?.remote);
  const hasOpenPr = pr?.state === "open";
  const diverged = (index?.ahead ?? 0) > 0 && (index?.behind ?? 0) > 0;
  const onDefault =
    !!index?.branch &&
    !!index.defaultBranch &&
    index.branch === index.defaultBranch;
  const canGenerate = files.length > 0 && !busy && !isRemoteProjectPath(cwd);
  const canCommit =
    (staged.length > 0 || amend) && message.trim().length > 0 && !busy;
  const canCreatePr =
    hasRemote &&
    !!index?.branch &&
    !!index.defaultBranch &&
    !hasOpenPr &&
    !onDefault &&
    !diverged &&
    files.length === 0 &&
    (index?.aheadOfDefault ?? 0) > 0 &&
    (index?.behind ?? 0) === 0;
  const canViewPr = hasOpenPr && !!pr?.url;
  const canPublish = hasRemote && !index?.upstream;
  const canSync =
    hasRemote &&
    Boolean(index?.upstream) &&
    ((index?.ahead ?? 0) > 0 || (index?.behind ?? 0) > 0);
  const canCommitPush =
    canCommit && hasRemote && !diverged && (!amend || !index?.headPushed);
  const canCommitPushPr = canCommitPush && !hasOpenPr && !onDefault;
  const canEditMessage = !busy;

  useEffect(() => {
    if (!amendTarget) return;
    if (
      amendTarget.branch === index?.branch &&
      amendTarget.head === index?.head
    ) {
      return;
    }
    setAmendTarget(null);
    setMessage("");
  }, [amendTarget, index?.branch, index?.head]);
  const canOpenMenu = !!index?.branch && !busy;

  useEffect(
    () => () => {
      if (generateAbortRef.current) {
        generateAbortRef.current.abort();
        generateAbortRef.current = null;
        setBusy(null);
      }
    },
    [cwd, setBusy],
  );

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [menuOpen]);

  const toggleView = () => {
    changesView = view === "tree" ? "list" : "tree";
    saveChangesView(changesView);
    setView(changesView);
  };

  const fail = useCallback((error: unknown) => {
    window.alert(error instanceof Error ? error.message : String(error));
  }, []);

  const recordPrActivity = (number = pr?.number) => {
    if (!number) return;
    recordInboxSelfActivity({
      provider: "github",
      kind: "pr",
      number,
      projectPath: cwd,
    });
  };

  const confirmDefault = async (kind: "push" | "pr") => {
    if (!onDefault || !index?.branch) return true;
    const branch = index.branch;
    return confirmNative(
      kind === "pr"
        ? `Create a pull request from default branch "${branch}"?`
        : `Push to default branch "${branch}"?`,
    );
  };

  const run = useCallback(async (
    file: GitChangedFile,
    action: "stage" | "unstage" | "discard",
  ) => {
    if (busy) return;
    if (action === "discard") {
      const name = basename(file.relative);
      const untracked = file.status === "untracked";
      const ok = await confirmNative(
        untracked
          ? `Delete untracked file ${name}?`
          : `Discard changes in ${name}? This cannot be undone.`,
        untracked ? "Delete" : "Discard",
      );
      if (!ok) return;
    }
    setBusy(file.relative);
    try {
      if (action === "stage") await execute(() => gitStageFile(cwd, file.relative));
      else if (action === "unstage") await execute(() => gitUnstageFile(cwd, file.relative));
      else await execute(() => gitDiscardFile(cwd, file.relative));
      onMutated([file.path]);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  }, [busy, cwd, setBusy, onMutated, fail, execute]);

  const runAll = async (action: "stage" | "unstage" | "discard") => {
    if (busy) return;
    if (action === "discard") {
      const n = unstaged.length;
      if (n === 0) return;
      const only = unstaged[0];
      const untrackedOnly = n === 1 && only?.status === "untracked";
      const ok = await confirmNative(
        untrackedOnly
          ? `Delete untracked file ${basename(only.relative)}?`
          : n === 1 && only
            ? `Discard changes in ${basename(only.relative)}? This cannot be undone.`
            : `Discard all unstaged changes in ${n} files? This cannot be undone.`,
        untrackedOnly ? "Delete" : "Discard",
      );
      if (!ok) return;
    }
    setBusy(action);
    try {
      if (action === "stage") await execute(() => gitStageAll(cwd));
      else if (action === "unstage") await execute(() => gitUnstageAll(cwd));
      else await execute(() => gitDiscardAll(cwd));
      onMutated(
        action === "discard" ? unstaged.map((file) => file.path) : undefined,
      );
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const runFolder = useCallback(async (relative: string, action: "stage" | "unstage") => {
    if (busy) return;
    setBusy(`${action}:${relative}`);
    try {
      if (action === "stage") await execute(() => gitStageFile(cwd, relative));
      else await execute(() => gitUnstageFile(cwd, relative));
      onMutated(
        files
          .filter((file) => file.relative.startsWith(`${relative}/`))
          .map((file) => file.path),
      );
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  }, [busy, cwd, setBusy, files, onMutated, fail, execute]);

  const generate = async () => {
    if (!canGenerate || generateAbortRef.current) return;
    const controller = new AbortController();
    generateAbortRef.current = controller;
    setBusy("generate");
    try {
      const generated = await generation.mutateAsync({ harness: textHarness, signal: controller.signal });
      if (!controller.signal.aborted) setMessage(generated);
    } catch (error) {
      if (!controller.signal.aborted) fail(error);
    } finally {
      if (generateAbortRef.current === controller) {
        generateAbortRef.current = null;
        setBusy(null);
      }
    }
  };

  const cancelGenerate = () => {
    generateAbortRef.current?.abort();
    generateAbortRef.current = null;
    setBusy(null);
  };

  const toggleAmend = async () => {
    setMenuOpen(false);
    if (amend) {
      setAmendTarget(null);
      return;
    }
    try {
      const headMessage = await queryClient.fetchQuery(gitHeadMessageQuery(cwd));
      if (!message.trim()) setMessage(headMessage);
      setAmendTarget({
        branch: index?.branch ?? null,
        head: index?.head ?? null,
      });
    } catch (error) {
      fail(error);
    }
  };

  const confirmAmend = async () => {
    if (!amend || !index?.headPushed) return true;
    return confirmNative(
      "Amend a commit that is already pushed? OmniCode cannot push the result. You will need a force push from the terminal.",
      "Amend",
    );
  };

  const commit = async (push: boolean, createPr = false) => {
    if (!canCommit) return;
    if (
      (push || createPr) &&
      !(await confirmDefault(createPr ? "pr" : "push"))
    ) {
      return;
    }
    if (!(await confirmAmend())) return;
    setBusy(createPr ? "pr" : "commit");
    setMenuOpen(false);
    try {
      await execute(() => gitCommit(cwd, message, amend));
      if (push || createPr) {
        await execute(() => gitPush(cwd));
        recordPrActivity();
      }
      setMessage("");
      setAmendTarget(null);
      onMutated();
      if (createPr) {
        await openCreatedPr();
        reloadPr();
      }
    } catch (error) {
      fail(error);
      onMutated();
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    if (!index || !(canSync || canPublish)) return;
    const pushesCommits = index.ahead > 0;
    setBusy("sync");
    try {
      await execute(() => gitSync(cwd));
      if (pushesCommits) recordPrActivity();
      onMutated();
      reloadPr();
    } catch (error) {
      fail(error);
      onMutated();
    } finally {
      setBusy(null);
    }
  };

  const openCreatedPr = async () => {
    const content = isRemoteProjectPath(cwd)
      ? await remotePrContent(cwd)
      : await generatePrContent(cwd, textHarness);
    if (!content) throw new Error("Could not prepare pull request content");
    const url = await execute(() => gitPrCreate(
      cwd,
      content.title,
      content.body,
      content.base,
      content.head,
    ));
    const number = Number(/\/pull\/(\d+)(?:[/?#]|$)/.exec(url)?.[1]);
    if (Number.isInteger(number) && number > 0) recordPrActivity(number);
    await openUrl(url.trim());
  };

  const createPr = async () => {
    if (!canCreatePr) return;
    if (!(await confirmDefault("pr"))) return;
    setBusy("pr");
    try {
      if ((index?.ahead ?? 0) > 0) await execute(() => gitPush(cwd));
      await openCreatedPr();
      onMutated();
      reloadPr();
    } catch (error) {
      fail(error);
      onMutated();
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside
      className={cn("flex min-h-0 min-w-0 flex-col", fill ? "flex-1" : "shrink-0")}
    >
      <AnimatedCollapse expanded={composerExpanded} keepMounted className="shrink-0">
        <div id={composerId} className="git-commit-composer border-b border-stroke p-2">
          <div className="relative">
            <Textarea
              size="sm"
              aria-label={uiT("Commit message")}
              rows={2}
              value={message}
              placeholder={
                amend ? uiT("Amend Last Commit") : uiT("Commit message")
              }
              disabled={!canEditMessage}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (
                  (event.metaKey || event.ctrlKey) &&
                  event.key === "Enter" &&
                  canCommit
                ) {
                  event.preventDefault();
                  void commit(false);
                }
              }}
              className="git-commit-message max-h-40 w-full overflow-y-auto"
            />
            <IconButton
              size="xs"
              label={
                busy === "generate"
                  ? uiT("Cancel commit message generation")
                  : uiT("Generate commit message")
              }
              disabled={busy !== "generate" && !canGenerate}
              onClick={() =>
                busy === "generate" ? cancelGenerate() : void generate()
              }
              className="git-commit-generate group"
            >
              {busy === "generate" ? (
                <>
                  <Spinner className="size-3.5 group-hover:hidden group-focus-visible:hidden" />
                  <X
                    className="hidden size-3.5 group-hover:block group-focus-visible:block"
                  />
                </>
              ) : (
                <WandSparkles className="size-3" strokeWidth={1} />
              )}
            </IconButton>
          </div>
          <div className="git-commit-hint flex items-center justify-between gap-2 text-ui-xs text-foreground-subtle">
            <span>{!staged.length && !amend && files.length ? uiT("Stage changes to commit") : uiT("Staged") + ` · ${staged.length}`}</span>
            <kbd className="shrink-0" title={uiT("Commit")}>{MOD}↵</kbd>
          </div>
          <div ref={menuRef} className="git-commit-actions relative mt-2 flex flex-wrap items-center gap-1">
            <GitSyncActions
              index={index}
              pr={pr}
              busy={busy}
              hasRemote={hasRemote}
              hasOpenPr={hasOpenPr}
              onDefault={onDefault}
              canSync={canSync}
              canPublish={canPublish}
              canCreatePr={canCreatePr}
              canViewPr={canViewPr}
              onSync={() => void sync()}
              onCreatePr={() => void createPr()}
              onViewPr={() => {
                if (pr?.url) void openUrl(pr.url);
              }}
            >
              <div className="flex min-w-0 flex-1 items-center gap-1">
                <Button
                  size="sm"
                  disabled={!canCommit}
                  onClick={() => void commit(false)}
                  className="min-w-0 flex-1"
                >
                  <Check className="size-3.5" strokeWidth={2} />
                  <span className="min-w-0 truncate">
                    {amend ? uiT("Amend Commit") : uiT("Commit")}
                  </span>
                </Button>

                <Button
                  variant="secondary"
                  size="icon-md"
                  title={uiT("Commit options")}
                  aria-label={uiT("Commit options")}
                  aria-expanded={menuOpen}
                  disabled={!canOpenMenu}
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  <ChevronDown className="size-3.5" strokeWidth={2} />
                </Button>
                {composerExpanded && menuOpen ? (
                  <div
                    role="menu"
                    aria-label={uiT("Commit options")}
                    className="absolute top-full right-0 z-30 mt-1 min-w-48 rounded-md border border-content/10 panel-menu py-1 shadow-lg"
                    data-menu-density="compact"
                  >
                    <div data-menu-gutter>
                      <Button data-menu-row="single" variant="ghost" size="content"
                        type="button"
                        role="menuitem"
                        disabled={!canCommitPush}
                        onClick={() => void commit(true)}
                        className="flex w-full items-center text-left text-[12px] text-content hover:bg-content/6 disabled:opacity-40 justify-start"
                      >
                        <MenuHover />
                        <span data-menu-title>{uiT("Commit & Push")}</span>
                      </Button>
                      <Button data-menu-row="single" variant="ghost" size="content"
                        type="button"
                        role="menuitem"
                        disabled={!canCommitPushPr}
                        onClick={() => void commit(true, true)}
                        className="flex w-full items-center text-left text-[12px] text-content hover:bg-content/6 disabled:opacity-40 justify-start"
                      >
                        <MenuHover />
                        <span data-menu-title>{uiT("Commit, Push & Create PR")}</span>
                      </Button>
                      <div role="separator" className="my-1 border-t border-content/10" />
                      <Button data-menu-row="single" variant="ghost" size="content"
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={amend}
                        onClick={() => void toggleAmend()}
                        className="flex w-full items-center justify-between gap-2 text-left text-[12px] text-content hover:bg-content/6"
                      >
                        <MenuHover />
                        <span data-menu-title>{uiT("Amend Last Commit")}</span>
                        <span className="grid size-3.5 shrink-0 place-items-center">
                          {amend ? (
                            <Check className="size-3.5" strokeWidth={2} />
                          ) : null}
                        </span>
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </GitSyncActions>
          </div>
        </div>
      </AnimatedCollapse>
      <div
        ref={lockOverscroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-none pb-1"
      >
        {files.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-content/45">
            {index
              ? index.ahead > 0 || index.behind > 0
                ? syncStatusLabel(index)
                : uiT("No uncommitted changes")
              : uiT("Loading changes…")}
          </p>
        ) : (
          <>
            {staged.length > 0 ? (
              <FileSection
                title={uiT("Staged Changes")}
                count={staged.length}
                open={stagedExpanded}
                onToggle={() => {
                  stagedOpen = !stagedExpanded;
                  setStagedExpanded(stagedOpen);
                }}
                view={view}
                onToggleView={toggleView}
                headerActions={[
                  {
                    title: "Open All Changes",
                    icon: <FileDiff className="size-3.5" />,
                    onClick: () => onOpenAllChanges("staged"),
                  },
                  {
                    title: "Unstage All Changes",
                    icon: <Minus className="size-3.5" />,
                    onClick: () => void runAll("unstage"),
                  },
                ]}
              >
                <ChangeList
                  files={staged}
                  view={view}
                  kind="staged"
                  selected={selected}
                  selectedKind={selectedKind}
                  busy={busy}
                  onOpenFile={onOpenFile}
                  onAction={run}
                  onFolderAction={runFolder}
                />
              </FileSection>
            ) : null}
            {unstaged.length > 0 ? (
              <FileSection
                title={uiT("Changes")}
                count={unstaged.length}
                open={changesExpanded}
                onToggle={() => {
                  changesOpen = !changesExpanded;
                  setChangesExpanded(changesOpen);
                }}
                view={view}
                onToggleView={toggleView}
                headerActions={[
                  {
                    title: "Open All Changes",
                    icon: <FileDiff className="size-3.5" />,
                    onClick: () => onOpenAllChanges("unstaged"),
                  },
                  {
                    title: "Discard All Changes",
                    icon: <Undo2 className="size-3.5" />,
                    onClick: () => void runAll("discard"),
                  },
                  {
                    title: "Stage All Changes",
                    icon: <Plus className="size-3.5" />,
                    onClick: () => void runAll("stage"),
                  },
                ]}
              >
                <ChangeList
                  files={unstaged}
                  view={view}
                  kind="unstaged"
                  selected={selected}
                  selectedKind={selectedKind}
                  busy={busy}
                  onOpenFile={onOpenFile}
                  onAction={run}
                  onFolderAction={runFolder}
                />
              </FileSection>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}

function usePrStatus(
  cwd: string,
  branch: string | null | undefined,
): { pr: GitPr | null; reload: () => void } {
  installGitQueryInvalidation();
  const active = isGitCwd(cwd) && !!branch;
  const { data: pr = null } = useQuery({ ...gitPrStatusQuery(cwd, branch), enabled: active }, queryClient);
  return { pr: active ? pr : null, reload: () => { void invalidateAfterChange(gitKeys.prStatus(cwd, branch)); } };
}

function syncStatusLabel(index: GitDiffIndex): string {
  if (index.ahead > 0 && index.behind > 0) {
    return `Diverged from ${index.upstream ?? "upstream"}`;
  }
  if (index.ahead > 0) {
    const n = index.ahead;
    return `${n} unpushed commit${n === 1 ? "" : "s"}`;
  }
  if (index.behind > 0) {
    const n = index.behind;
    return `${n} incoming commit${n === 1 ? "" : "s"}`;
  }
  return "No files";
}

function GitSyncActions({
  children,
  index,
  pr,
  busy,
  hasRemote,
  hasOpenPr,
  onDefault,
  canSync,
  canPublish,
  canCreatePr,
  canViewPr,
  onSync,
  onCreatePr,
  onViewPr,
}: {
  children: ReactNode;
  index: GitDiffIndex | null;
  pr: GitPr | null;
  busy: string | null;
  hasRemote: boolean;
  hasOpenPr: boolean;
  onDefault: boolean;
  canSync: boolean;
  canPublish: boolean;
  canCreatePr: boolean;
  canViewPr: boolean;
  onSync: () => void;
  onCreatePr: () => void;
  onViewPr: () => void;
}) {
  const { t: uiT } = useTranslation();
  if (!index || !hasRemote) return children;
  const ahead = index.ahead;
  const behind = index.behind;
  const dest =
    index.upstream ?? `${index.remote ?? "origin"}/${index.branch ?? "HEAD"}`;
  const syncing = busy === "sync";
  const syncTitle = syncing
    ? "Synchronizing Changes..."
    : canPublish
      ? index.branch
        ? `Publish Branch "${index.branch}"`
        : "Publish Branch"
      : behind > 0 && ahead > 0
        ? `Pull ${behind} and push ${ahead} commits between ${dest}`
        : behind > 0
          ? `Pull ${behind} commit${behind === 1 ? "" : "s"} from ${dest}`
          : `Push ${ahead} commit${ahead === 1 ? "" : "s"} to ${dest}`;
  const createTitle = index.defaultBranch
    ? `Create a pull request into ${index.defaultBranch}`
    : "Create pull request";
  const viewTitle = pr?.title
    ? `View PR #${pr.number}: ${pr.title}`
    : "View pull request";
  const showCreatePr = !hasOpenPr && !onDefault;
  const showViewPr = hasOpenPr;
  if (!canPublish && !canSync && !showCreatePr && !showViewPr) return children;

  return (
    <>
      {canPublish ? (
        <Button variant="secondary" size="sm"
          title={syncTitle}
          disabled={!!busy}
          onClick={onSync}
          className="min-w-0 flex-1"
        >
          {syncing ? (
            <Spinner className="size-3.5 shrink-0" />
          ) : (
            <CloudUpload className="size-3.5 shrink-0" />
          )}
          <span className="min-w-0 truncate">{uiT("Publish Branch")}</span>
        </Button>
      ) : canSync ? (
        <Button variant="secondary" size="sm"
          title={syncTitle}
          disabled={!!busy}
          onClick={onSync}
          className="min-w-0 flex-1"
        >
          <RefreshCw
            className={cn("size-3.5 shrink-0", syncing ? "animate-spin" : "")}
          />
          <span className="min-w-0 truncate">{uiT("Sync Changes")}</span>
          {behind > 0 ? (
            <span className="shrink-0 tabular-nums text-content/55">
              ↓{behind}
            </span>
          ) : null}
          {ahead > 0 ? (
            <span className="shrink-0 tabular-nums text-content/55">
              ↑{ahead}
            </span>
          ) : null}
        </Button>
      ) : null}
      {children}
      {showCreatePr ? (
        <Button variant="secondary" size="sm"
          title={createTitle}
          disabled={!canCreatePr || !!busy}
          onClick={onCreatePr}
          className="w-full min-w-0"
        >
          {busy === "pr" ? (
            <Spinner className="size-3.5 shrink-0" />
          ) : (
            <GitPullRequest className="size-3.5 shrink-0" />
          )}
          {uiT("Create PR")}
        </Button>
      ) : null}
      {showViewPr ? (
        <Button variant="secondary" size="sm"
          title={viewTitle}
          disabled={!canViewPr || !!busy}
          onClick={onViewPr}
          className="w-full min-w-0"
        >
          <ExternalLink className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">
            {pr?.number
              ? uiT("View PR #{value0}", { value0: String(pr.number) })
              : uiT("View PR")}
          </span>
        </Button>
      ) : null}
    </>
  );
}

export function FileSection({
  title,
  count,
  open,
  onToggle,
  view,
  onToggleView,
  headerActions,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  view: ChangesView;
  onToggleView: () => void;
  headerActions: { title: string; icon: ReactNode; onClick: () => void }[];
  children: ReactNode;
}) {
  const { t: uiT } = useTranslation();
  const visible = useSurfaceVisibility();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const childrenRef = useRef<HTMLUListElement>(null);
  const contentId = useId();
  return (
    <div className="git-file-section">
      <div className="git-panel-header git-file-section-header flex items-center">
        <Button variant="ghost" size="content"
          ref={toggleRef}
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          disabled={!visible}
          onClick={() => {
            if (open && childrenRef.current?.contains(document.activeElement)) toggleRef.current?.focus();
            onToggle();
          }}
          className="flex min-w-0 flex-1 items-center gap-1 text-left justify-start"
        >
          <span className="grid size-5 shrink-0 place-items-center">
            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </span>
          <span className="min-w-0 truncate">
            {title}
          </span>
          <span className="git-file-count ml-1 grid h-4 min-w-4 shrink-0 place-items-center rounded px-1 text-ui-xs tabular-nums">
            {count}
          </span>
        </Button>
        <IconButton size="xs" disabled={!visible}
          label={view === "tree" ? uiT("View as List") : uiT("View as Tree")}
          onClick={onToggleView}
        >
          {view === "tree" ? (
            <ListBullet className="size-3.5" />
          ) : (
            <FolderTree className="size-3.5" />
          )}
        </IconButton>
        {headerActions.map((action) => (
          <IconButton size="xs" disabled={!visible}
            key={action.title}
            label={uiT(action.title)}
            onClick={action.onClick}
          >
            {action.icon}
          </IconButton>
        ))}
      </div>
      <AnimatedCollapse expanded={open} keepMounted>
        <fieldset disabled={!open || !visible} className="m-0 min-w-0 border-0 p-0">
          <ul ref={childrenRef} id={contentId}>{children}</ul>
        </fieldset>
      </AnimatedCollapse>
    </div>
  );
}

type ChangeDir = {
  name: string;
  /** Path relative to the repo root; "" for the implicit root. */
  path: string;
  dirs: ChangeDir[];
  files: GitChangedFile[];
  /** Status shared by every descendant, or null when they differ. */
  status: string | null;
};

async function remotePrContent(cwd: string) {
  const range = await queryClient.fetchQuery(gitRangeContextQuery(cwd));
  const commits = range.commitSummary.trim();
  const firstCommit = commits
    .split(/\r?\n/, 1)[0]
    ?.replace(/^[0-9a-f]+\s+/i, "")
    .trim();
  const title = firstCommit || `Changes on ${range.head}`;
  const body = [
    commits && `## Commits\n\n${commits}`,
    range.diffSummary.trim() && `## Changes\n\n${range.diffSummary.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { title, body: body || title, base: range.base, head: range.head };
}

type ChangeRowProps = {
  files: GitChangedFile[];
  view: ChangesView;
  kind: GitFileDiffKind;
  selected?: string;
  selectedKind?: GitFileDiffKind;
  busy: string | null;
  onOpenFile: (path: string, kind: GitFileDiffKind, pin?: boolean) => void;
  onAction: (
    file: GitChangedFile,
    action: "stage" | "unstage" | "discard",
  ) => void;
  onFolderAction: (relative: string, action: "stage" | "unstage") => void;
};

export const ChangeList = memo(function ChangeList({ files, view, ...rest }: ChangeRowProps) {
  const tree = useMemo(() => buildChangeTree(files), [files]);
  if (view === "tree") {
    return <ChangeDirChildren dir={tree} depth={0} {...rest} />;
  }
  return (
    <>
      {files.map((file) => (
        <ChangeRow
          key={`${rest.kind}:${file.relative}`}
          file={file}
          active={isActive(file, rest.selected, rest.selectedKind, rest.kind)}
          busy={rest.busy !== null}
          kind={rest.kind}
          onOpenFile={rest.onOpenFile}
          onAction={rest.onAction}
        />
      ))}
    </>
  );
});

const ChangeDirChildren = memo(function ChangeDirChildren({
  dir,
  depth,
  kind,
  selected,
  selectedKind,
  busy,
  onOpenFile,
  onAction,
  onFolderAction,
}: Omit<ChangeRowProps, "files" | "view"> & {
  dir: ChangeDir;
  depth: number;
}) {
  return (
    <>
      {dir.dirs.map((child) => (
        <ChangeDirRow
          key={child.path}
          dir={child}
          depth={depth}
          kind={kind}
          selected={selected}
          selectedKind={selectedKind}
          busy={busy}
          onOpenFile={onOpenFile}
          onAction={onAction}
          onFolderAction={onFolderAction}
        />
      ))}
      {dir.files.map((file) => (
        <ChangeRow
          key={`${kind}:${file.relative}`}
          file={file}
          active={isActive(file, selected, selectedKind, kind)}
          busy={busy !== null}
          kind={kind}
          depth={depth}
          onOpenFile={onOpenFile}
          onAction={onAction}
        />
      ))}
    </>
  );
});

function ChangeDirRow({
  dir,
  depth,
  kind,
  ...rest
}: Omit<ChangeRowProps, "files" | "view"> & {
  dir: ChangeDir;
  depth: number;
}) {
  const { t: uiT } = useTranslation();
  const visible = useSurfaceVisibility();
  const key = `${kind}:${dir.path}`;
  const [open, setOpen] = useState(() => !collapsedDirs.has(key));
  const toggleRef = useRef<HTMLButtonElement>(null);
  const childrenRef = useRef<HTMLUListElement>(null);
  const toggle = () => {
    if (open && childrenRef.current?.contains(document.activeElement))
      toggleRef.current?.focus();
    if (open) collapsedDirs.add(key);
    else collapsedDirs.delete(key);
    setOpen(!open);
  };
  return (
    <li>
      <div
        style={{ paddingLeft: 8 + depth * 12 }}
        className="group flex h-7 w-full items-center gap-1 pr-2 leading-none text-content hover:bg-content/3"
      >
        <Button variant="ghost" size="content"
          ref={toggleRef}
          type="button"
          title={dir.path}
          aria-expanded={open}
          disabled={!visible}
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left justify-start"
        >
          <span className="grid size-4 shrink-0 place-items-center text-content/50">
            {open ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </span>
          <span data-file-label className="min-w-0 flex-1 truncate text-[13px] leading-label font-medium">
            {dir.name}
          </span>
        </Button>
        <div className="hidden shrink-0 items-center group-focus-within:flex group-hover:flex">
          <IconButton size="xs"
            label={uiT(
              kind === "staged"
                ? "Unstage Changes in {path}"
                : "Stage Changes in {path}",
              { path: dir.path },
            )}
            disabled={!visible || rest.busy !== null}
            onClick={() =>
              rest.onFolderAction(
                dir.path,
                kind === "staged" ? "unstage" : "stage",
              )
            }
          >
            {kind === "staged" ? (
              <Minus className="size-3.5" />
            ) : (
              <Plus className="size-3.5" />
            )}
          </IconButton>
        </div>
        <span
          className={cn("grid w-3.5 shrink-0 place-items-center", dir.status ? statusColor(dir.status) : "text-content/40")}
          aria-hidden
        >
          <span className="size-1.5 rounded-full bg-current" />
        </span>
      </div>
      <AnimatedCollapse expanded={open} keepMounted>
        <fieldset disabled={!open || !visible} className="m-0 min-w-0 border-0 p-0">
          <ul ref={childrenRef}>
            <ChangeDirChildren
              dir={dir}
              depth={depth + 1}
              kind={kind}
              {...rest}
            />
          </ul>
        </fieldset>
      </AnimatedCollapse>
    </li>
  );
}

function isActive(
  file: GitChangedFile,
  selected: string | undefined,
  selectedKind: GitFileDiffKind | undefined,
  kind: GitFileDiffKind,
): boolean {
  return selected === file.relative && (!selectedKind || selectedKind === kind);
}

/** Nests changed files under their directories, VS Code's tree view. */
function buildChangeTree(files: GitChangedFile[]): ChangeDir {
  const root: ChangeDir = {
    name: "",
    path: "",
    dirs: [],
    files: [],
    status: null,
  };
  for (const file of files) {
    const segments = file.relative.split("/");
    let node = root;
    for (const segment of segments.slice(0, -1)) {
      const path = node.path ? `${node.path}/${segment}` : segment;
      let next = node.dirs.find((dir) => dir.path === path);
      if (!next) {
        next = { name: segment, path, dirs: [], files: [], status: null };
        node.dirs.push(next);
      }
      node = next;
    }
    node.files.push(file);
  }
  sortChangeDir(root);
  return root;
}

/** Sorts each level (folders first) and rolls descendant status upward. */
function sortChangeDir(dir: ChangeDir): string | null {
  dir.dirs.sort((a, b) => a.name.localeCompare(b.name));
  dir.files.sort((a, b) =>
    basename(a.relative).localeCompare(basename(b.relative)),
  );
  let status: string | null = null;
  let mixed = false;
  const merge = (next: string | null) => {
    if (next === null) mixed = true;
    else if (status === null) status = next;
    else if (status !== next) mixed = true;
  };
  for (const child of dir.dirs) merge(sortChangeDir(child));
  for (const file of dir.files) merge(file.status);
  dir.status = mixed ? null : status;
  return dir.status;
}

// FileSection and ChangeDirRow disable their native fieldsets while hidden.
// Leaf rows need not subscribe to visibility and rerender on every disclosure.
function ChangeRow({
  file,
  active,
  busy,
  kind,
  depth,
  onOpenFile,
  onAction,
}: {
  file: GitChangedFile;
  active: boolean;
  busy: boolean;
  kind: GitFileDiffKind;
  /** Set in tree view: nesting level. */
  depth?: number;
  onOpenFile: (path: string, kind: GitFileDiffKind, pin?: boolean) => void;
  onAction: (
    file: GitChangedFile,
    action: "stage" | "unstage" | "discard",
  ) => void;
}) {
  const { t: uiT } = useTranslation();
  const name = basename(file.relative);
  const tree = depth !== undefined;
  const canOpen = file.status !== "deleted";
  return (
    <li>
      <div
        data-git-change-row={tree ? "tree" : "list"}
        style={tree ? { paddingLeft: 8 + depth * 12 } : undefined}
        className={cn("group flex h-7 w-full items-center gap-1 pr-2 leading-none", tree ? "" : "pl-2", active
            ? "bg-selection text-content"
            : "text-content hover:bg-content/3")}
      >
        <Button variant="ghost" size="content"
          type="button"
          title={file.relative}
          onClick={() => {
            if (canOpen) onOpenFile(file.path, kind);
          }}
          onDoubleClick={() => {
            if (canOpen) onOpenFile(file.path, kind, true);
          }}
          className="flex h-full min-w-0 flex-1 items-center gap-0.75 text-left justify-start"
        >
          {tree ? <span className="size-4 shrink-0" /> : null}
          <FileTypeIcon name={name} isDir={false} size={12} />
          <span data-file-label className="git-change-label min-w-0 flex-1 leading-label">
            <span className="git-change-name block truncate text-[13px] font-medium">{name}</span>
          </span>
        </Button>
        <div
          className={cn("shrink-0 items-center", active ? "flex" : "hidden group-focus-within:flex group-hover:flex")}
        >
          {kind === "unstaged" ? (
            <IconButton size="xs"
              label={uiT("Discard Changes")}
              disabled={busy}
              onClick={() => onAction(file, "discard")}
            >
              <Undo2 className="size-3.5" />
            </IconButton>
          ) : null}
          {kind === "staged" ? (
            <IconButton size="xs"
              label={uiT("Unstage Changes")}
              disabled={busy}
              onClick={() => onAction(file, "unstage")}
            >
              <Minus className="size-3.5" />
            </IconButton>
          ) : (
            <IconButton size="xs"
              label={uiT("Stage Changes")}
              disabled={busy}
              onClick={() => onAction(file, "stage")}
            >
              <Plus className="size-3.5" />
            </IconButton>
          )}
        </div>
        {file.additions || file.deletions ? (
          <span data-git-change-stats className="flex shrink-0 gap-1 font-mono text-[11px] tabular-nums">
            {file.additions ? <span className="text-emerald-400">+{file.additions}</span> : null}
            {file.deletions ? <span className="text-red-400">-{file.deletions}</span> : null}
          </span>
        ) : null}
        <span
          className={cn("w-3.5 shrink-0 text-right font-mono text-[11px] font-semibold", statusColor(file.status))}
        >
          {statusLetter(file.status)}
        </span>
      </div>
    </li>
  );
}

function statusLetter(status: string): string {
  if (status === "untracked") return "U";
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  return "M";
}

function statusColor(status: string): string {
  if (status === "untracked") return "text-sky-400";
  if (status === "added") return "text-emerald-400";
  if (status === "deleted") return "text-red-400";
  return "text-amber-400";
}

function useDiffIndex(
  cwd: string,
  enabled: boolean,
): {
  index: GitDiffIndex | null;
  reload: () => void;
} {
  installGitQueryInvalidation();
  const { data: index = null } = useQuery({
    ...gitDiffIndexQuery(cwd),
    enabled: enabled && isGitCwd(cwd),
    refetchInterval: enabled ? GIT_POLL_MS : false,
    structuralSharing: (previous, next) => next && sameIndex(previous as GitDiffIndex | null, next as GitDiffIndex) ? previous : next,
  }, queryClient);
  const reload = useCallback(() => { void invalidateAfterChange(gitKeys.diffIndex(cwd)); }, [cwd]);
  const watchKey = `git-index:${useId()}`;
  const previous = useRef<{ cwd: string; index: GitDiffIndex | null }>({ cwd, index: null });
  useEffect(() => {
    const prev = previous.current.cwd === cwd ? previous.current.index : null;
    previous.current = { cwd, index };
    if (!index) return;
    applyProjectDiffStats(cwd, { files: index.files.length, additions: index.additions, deletions: index.deletions });
    if (prev && !sameIndex(prev, index)) {
      invalidateWatchedFiles(changedFilePaths(prev, index));
      notifyGitChanged();
    }
  }, [cwd, index]);
  useEffect(() => {
    if (!enabled || !isGitCwd(cwd)) return;
    void setFsWatch(watchKey, [], [cwd]);
    const root = pathKey(cwd);
    const stop = subscribeFsWatch(({ entries, contents }) => {
      if ([...entries, ...contents].some((path) => {
        const key = pathKey(path);
        return key === root || key.startsWith(`${root}/`);
      })) reload();
    });
    return () => { stop(); void setFsWatch(watchKey, []); };
  }, [cwd, enabled, watchKey, reload]);
  return { index: isGitCwd(cwd) ? index : null, reload };
}

function changedFilePaths(prev: GitDiffIndex, next: GitDiffIndex): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const previous = new Map(prev.files.map((file) => [file.relative, file]));
  const current = new Set(next.files.map((file) => file.relative));
  for (const file of next.files) {
    const before = previous.get(file.relative);
    if (
      !before ||
      before.status !== file.status ||
      before.additions !== file.additions ||
      before.deletions !== file.deletions ||
      before.staged !== file.staged ||
      before.unstaged !== file.unstaged
    ) {
      paths.push(file.path);
      seen.add(file.path);
    }
  }
  for (const file of prev.files) {
    if (!current.has(file.relative) && !seen.has(file.path)) {
      paths.push(file.path);
    }
  }
  return paths;
}

function sameIndex(prev: GitDiffIndex | null, next: GitDiffIndex): boolean {
  if (!prev) return false;
  if (
    prev.branch !== next.branch ||
    prev.head !== next.head ||
    prev.additions !== next.additions ||
    prev.deletions !== next.deletions ||
    prev.files.length !== next.files.length ||
    prev.remote !== next.remote ||
    prev.upstream !== next.upstream ||
    prev.defaultBranch !== next.defaultBranch ||
    prev.ahead !== next.ahead ||
    prev.behind !== next.behind ||
    prev.aheadOfDefault !== next.aheadOfDefault ||
    prev.headPushed !== next.headPushed
  ) {
    return false;
  }
  return prev.files.every((file, i) => {
    const other = next.files[i];
    return (
      other &&
      file.relative === other.relative &&
      file.status === other.status &&
      file.additions === other.additions &&
      file.deletions === other.deletions &&
      file.staged === other.staged &&
      file.unstaged === other.unstaged
    );
  });
}
