import { motion as motionElement } from "motion/react";
import { panelTransition, immediateTransition, duration } from "../../../shared/motion/tokens";
import { reducedMotionQuery as motionPreferenceQuery } from "../../../shared/lib/reducedMotion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useCollapseMotion } from "../../../shared/ui/AnimatedCollapse";
import {
  SurfaceVisibilityContext,
  useSurfaceVisibility,
} from "../../../shared/ui/SurfaceVisibility";
import { Maximize2, Minus, PanelRight, X } from "../../../shared/ui/icons";
import { FilePane } from "../../connections/files/ui/FilePane";
import {
  newEditorPane,
  newFileTab,
  type EditorPane,
} from "../../workspace/model/layout";

const NO_SESSIONS: never[] = [];
const noop = () => {};

function parentDir(path: string) {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index > 0 ? path.slice(0, index) : path;
}

/** Tab state for the assistant's floating file card. */
export function useBotFilePanel() {
  const [pane, setPane] = useState<EditorPane | null>(null);
  const [expanded, setExpanded] = useState(false);
  const open = useCallback((path: string) => {
    setPane((current) => {
      const existing = current?.files.find((file) => file.path === path);
      if (current && existing)
        return { ...current, activeFileId: existing.id };
      const file = newFileTab(path, parentDir(path));
      return current
        ? { ...current, files: [...current.files, file], activeFileId: file.id }
        : newEditorPane(file);
    });
    setExpanded(true);
  }, []);
  return { pane, setPane, expanded, setExpanded, open };
}

/**
 * A whole tab card floating over the assistant chat, so opened attachments
 * never take the conversation's width. It can be maximized over the chat,
 * collapsed to an edge handle, or closed with all of its tabs.
 */
export function BotFilePanel({
  pane,
  setPane,
  expanded,
  setExpanded,
  onOpenFile,
}: ReturnType<typeof useBotFilePanel> & {
  onOpenFile: (path: string) => void;
}) {
  const { t } = useTranslation();
  const parentVisible = useSurfaceVisibility();
  const [maximized, setMaximized] = useState(false);
  const [dirtyFileIds, setDirtyFileIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [fileErrorCounts, setFileErrorCounts] = useState<
    Map<string, number>
  >(() => new Map());
  const open = expanded && !!pane;
  const handleShown = !expanded && !!pane;
  const card = useCollapseMotion(open, duration.panel * 1000);
  const handle = useCollapseMotion(handleShown, duration.panel * 1000);
  // The last tabs stay rendered while the card animates closed.
  const [renderedPane, setRenderedPane] = useState(pane);
  useEffect(() => {
    if (pane) setRenderedPane(pane);
    else if (card.foldState === "closed") setRenderedPane(null);
  }, [pane, card.foldState]);
  useEffect(() => {
    if (!pane) setMaximized(false);
  }, [pane]);
  const shownPane = pane ?? renderedPane;
  // Contents stay live until the card finishes closing, and stay mounted
  // while collapsed, so folding never tears down or rebuilds the editor.
  const cardHidden = !open && card.foldState === "closed";
  const contentVisible = parentVisible && !cardHidden;

  const closeFile = useCallback(
    (_paneId: string, fileId: string) => {
      setPane((current) => {
        if (!current) return current;
        const index = current.files.findIndex((file) => file.id === fileId);
        const files = current.files.filter((file) => file.id !== fileId);
        if (!files.length) {
          setExpanded(false);
          return null;
        }
        const activeFileId =
          current.activeFileId === fileId
            ? files[Math.min(index, files.length - 1)].id
            : current.activeFileId;
        return { ...current, files, activeFileId };
      });
    },
    [setPane, setExpanded],
  );
  const closeAll = useCallback(() => {
    setExpanded(false);
    setPane(null);
  }, [setPane, setExpanded]);
  const selectFile = useCallback(
    (_paneId: string, fileId: string) =>
      setPane((current) => current && { ...current, activeFileId: fileId }),
    [setPane],
  );
  const closeOtherFiles = useCallback(
    (_paneId: string, fileId: string) =>
      setPane(
        (current) =>
          current && {
            ...current,
            files: current.files.filter((file) => file.id === fileId),
            activeFileId: fileId,
          },
      ),
    [setPane],
  );
  const reorderFiles = useCallback(
    (_paneId: string, ids: string[]) =>
      setPane(
        (current) =>
          current && {
            ...current,
            files: ids
              .map((id) => current.files.find((file) => file.id === id))
              .filter((file) => !!file),
          },
      ),
    [setPane],
  );
  const dirtyChange = useCallback((fileId: string, dirty: boolean) => {
    setDirtyFileIds((current) => {
      if (current.has(fileId) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(fileId);
      else next.delete(fileId);
      return next;
    });
  }, []);
  const errorCountChange = useCallback((fileId: string, count: number) => {
    setFileErrorCounts((current) => {
      if ((current.get(fileId) ?? 0) === count) return current;
      const next = new Map(current);
      next.set(fileId, count);
      return next;
    });
  }, []);

  const trailing = useMemo(() => {
    const maximizeLabel = maximized ? t("Restore") : t("Maximize");
    const button =
      "grid size-7 shrink-0 self-center place-items-center rounded-md text-content/55 hover:bg-content/3 hover:text-content";
    return (
      <div className="mr-1 flex items-center">
        <button
          type="button"
          className={button}
          aria-label={t("Collapse")}
          title={t("Collapse")}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setExpanded(false)}
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          className={`${button} ${maximized ? "bg-content/8 text-content" : ""}`}
          aria-label={maximizeLabel}
          aria-pressed={maximized}
          title={maximizeLabel}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setMaximized((value) => !value)}
        >
          <Maximize2 className="size-3.5" />
        </button>
        <button
          type="button"
          className={button}
          aria-label={t("Close All")}
          title={t("Close All")}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={closeAll}
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }, [maximized, t, setExpanded, closeAll]);

  return (
    <>
      {shownPane ? (
        <motionElement.section
      initial={false} animate={{ opacity: open ? 1 : 0, x: open ? 0 : "100%" }} transition={motionPreferenceQuery().matches ? immediateTransition : panelTransition} onAnimationComplete={card.finish}
          className="assistant-file-card"
          hidden={cardHidden}
          data-maximized={maximized || undefined}
          data-fold-state={card.foldState}
          aria-label={t("Attachments")}
          aria-hidden={!open || undefined}
          inert={!open}

          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            event.preventDefault();
            setExpanded(false);
          }}
        >
          <SurfaceVisibilityContext.Provider value={contentVisible}>
            <FilePane
              pane={shownPane}
              focused={contentVisible}
              visible={contentVisible}
              showTabs
              tabsTrailing={trailing}
              dirtyFileIds={dirtyFileIds}
              fileErrorCounts={fileErrorCounts}
              sessions={NO_SESSIONS}
              onFocus={noop}
              onSelectFile={selectFile}
              onCloseFile={closeFile}
              onCloseOtherFiles={closeOtherFiles}
              onDirtyChange={dirtyChange}
              onErrorCountChange={errorCountChange}
              onReorderFiles={reorderFiles}
              onOpenFile={onOpenFile}
              onUpdatePlan={noop}
              onBuildPlan={noop}
            />
          </SurfaceVisibilityContext.Provider>
        </motionElement.section>
      ) : null}
      {shownPane && (handleShown || handle.foldState !== "closed") ? (
        <motionElement.button
      initial={false} animate={{ opacity: handleShown ? 1 : 0, x: handleShown ? 0 : "100%" }} transition={motionPreferenceQuery().matches ? immediateTransition : panelTransition} onAnimationComplete={handle.finish}
          type="button"
          className="assistant-file-card-handle"
          data-fold-state={handle.foldState}
          aria-hidden={!handleShown || undefined}
          inert={!handleShown}
          aria-label={t("{value0} files", {
            value0: String(shownPane.files.length),
          })}
          title={t("{value0} files", {
            value0: String(shownPane.files.length),
          })}

          onClick={() => setExpanded(true)}
        >
          <PanelRight size={15} />
          <span>{shownPane.files.length}</span>
        </motionElement.button>
      ) : null}
    </>
  );
}
