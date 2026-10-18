import { motion } from "motion/react";
import {
  immediateTransition,
  motionDistance,
  motionGeometry,
  panelTransition,
} from "../../../shared/motion/tokens";
import { useMotionPreference } from "../../../shared/motion/useMotionPreference";
import { useCollapseMotion } from "../../../shared/ui/AnimatedCollapse";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CircleX, ExternalLink, LoaderCircle, PanelLeft } from "../../../shared/ui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "../../../shared/ui/forms/IconButton";
import { useDragResize } from "../../../shared/hooks/useDragResize";
import { ResizeHandle } from "../../../shared/ui/ResizeHandle";
import { useTabGroupLogos } from "../../projects/hooks/useTabGroupLogos";
import {
  githubWorkItem,
  inboxItemKey,
  inboxProjectsForRail,
  peekGithubWorkItem,
  type InboxItem,
} from "../model/githubTasks";
import { type RecentProject } from "../../projects/model/recents";
import { type LinkedWorkItem } from "../../sessions/model/session";
import { type CiRepairProps, InboxDetail } from "./InboxDetail";
import { inboxProjectOptions } from "./InboxProjectPicker";
import { ACTION_OUTLINE } from "./inboxActions";


const LINKED_PANEL_MIN_WIDTH = 360;
const LINKED_PANEL_DEFAULT_WIDTH = 520;
let rememberedLinkedPanelWidth = LINKED_PANEL_DEFAULT_WIDTH;

export function LinkedWorkItemPanel({
  repairSessions,
  onRepairChecks,
  onOpenSession,
  target,
  cwd,
  recents,
  visible = true,
  onClose,
}: {
  repairSessions?: CiRepairProps["repairSessions"];
  onRepairChecks?: CiRepairProps["onRepairChecks"];
  onOpenSession?: (sessionId: string) => void | Promise<void>;
  target: LinkedWorkItem;
  cwd: string;
  recents: RecentProject[];
  visible?: boolean;
  onClose: () => void;
}) {
  const { t: uiT } = useTranslation();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const logos = useTabGroupLogos();
  const projects = useMemo(
    () => inboxProjectsForRail(recents, cwd),
    [cwd, recents],
  );
  const projectOptions = useMemo(
    () => inboxProjectOptions(projects, logos),
    [logos, projects],
  );
  const cachedItem = peekGithubWorkItem(
    target.repo,
    target.kind,
    target.number,
  );
  const [item, setItem] = useState<InboxItem | null>(() =>
    cachedItem ? { ...cachedItem, projectPath: cwd, provider: "github" } : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(cachedItem == null);
  const resize = useDragResize({
    min: LINKED_PANEL_MIN_WIDTH,
    max: () =>
      Math.max(
        LINKED_PANEL_MIN_WIDTH,
        Math.round(
          (typeof window === "undefined"
            ? LINKED_PANEL_DEFAULT_WIDTH / 0.65
            : window.innerWidth) * 0.65,
        ),
      ),
    defaultWidth: LINKED_PANEL_DEFAULT_WIDTH,
    initial: rememberedLinkedPanelWidth,
    direction: "left",
    onCommit: (width) => {
      rememberedLinkedPanelWidth = width;
    },
  });

  useEffect(() => {
    let cancelled = false;
    const cached = peekGithubWorkItem(target.repo, target.kind, target.number);
    setItem(
      cached ? { ...cached, projectPath: cwd, provider: "github" } : null,
    );
    setError(null);
    setLoading(cached == null);
    void githubWorkItem(cwd, target.repo, target.kind, target.number)
      .then((next) => {
        if (cancelled) return;
        setItem({ ...next, projectPath: cwd, provider: "github" });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, target.kind, target.number, target.repo]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible]);

  // The pane takes its full width up front so the sessions reflow once, then
  // the sheet slides in on a transform. Animating the width instead would
  // rewrap the transcript and resize terminals on every frame.
  const reduced = useMotionPreference();
  const lifetime = useCollapseMotion(visible);
  const [opening, setOpening] = useState(() => visible && !reduced);
  useEffect(() => {
    if (!visible) setOpening(false);
  }, [visible]);
  const contentKey = item ? inboxItemKey(item) : error ? "error" : "loading";
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const kindLabel = target.kind === "pr" ? "Pull request" : "Issue";
  return (
    <motion.aside
      {...lifetime.motionProps}
      animate={{ x: visible ? 0 : `${motionGeometry.linkedPanelPercent}%` }}
      transition={reduced || resize.dragging ? immediateTransition : panelTransition}
      ref={resize.setPaneRef}
      aria-label={uiT("Linked {value0} #{value1}", {
        value0: String(kindLabel.toLowerCase()),
        value1: String(target.number),
      })}
      aria-busy={loading}
      aria-hidden={!visible}
      inert={!visible || undefined}
      data-linked-work-item-panel
      className={`relative min-h-0 max-w-full shrink-0 flex-col text-content max-[950px]:absolute max-[950px]:inset-y-0 max-[950px]:right-0 max-[950px]:z-30 max-[950px]:shadow-2xl ${
        lifetime.foldState === "closed" ? "hidden" : "flex"
      }`}
    >
      <ResizeHandle
        edge="left"
        dragging={resize.dragging}
        aria-label={uiT("Resize linked {value0} panel", {
          value0: String(kindLabel.toLowerCase()),
        })}
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.onDoubleClick}
      />
      <div
        className={`flex min-h-0 min-w-0 flex-1 flex-col ${
          opening ? "overflow-hidden" : ""
        }`}
      >
        <motion.div
          initial={opening && !reduced ? { x: `${motionGeometry.linkedPanelPercent}%` } : false}
          animate={{ x: 0 }}
          transition={reduced ? immediateTransition : panelTransition}
          onAnimationComplete={() => setOpening(false)}
          className="relative flex min-h-0 flex-1 flex-col border-l border-stroke pl-4"
        >
          <div className="absolute top-[5px] right-2 z-30">
            <IconButton size="sm"
              label={uiT("Close {value0} panel", {
                value0: String(kindLabel.toLowerCase()),
              })}
              onClick={onClose}
            >
              <PanelLeft className="size-3.5" />
            </IconButton>
          </div>
          <motion.div
            key={contentKey}
            initial={reduced || revealedKey === contentKey ? false : { opacity: 0, x: motionDistance.pop }}
            animate={{ opacity: 1, x: 0 }}
            transition={reduced ? immediateTransition : panelTransition}
            onAnimationComplete={() => setRevealedKey(contentKey)}
            className="@container/linked min-h-0 min-w-0 flex-1"
          >
            {item ? (
              <InboxDetail
                key={inboxItemKey(item)}
                item={item}
                cwd={cwd}
                projects={projectOptions}
                revision={0}
                relatedSessions={[]}
                mode="panel"
                visible={visible}
                repairSessions={repairSessions}
                onRepairChecks={onRepairChecks}
                onOpenSession={onOpenSession}
                onItemChange={setItem}
              />
            ) : error ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
                <CircleX className="size-5 text-rose-400/90" />
                <p role="alert" className="max-w-sm text-[12px] text-content/55">
                  {error}
                </p>
                <button
                  type="button"
                  onClick={() => void openUrl(target.url)}
                  className={ACTION_OUTLINE}
                >
                  <ExternalLink className="size-3.5" />
                  {uiT("Open on GitHub")}
                </button>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-content/40">
                <LoaderCircle
                  className="size-4 animate-spin"
                />
              </div>
            )}
          </motion.div>
        </motion.div>
      </div>
    </motion.aside>
  );
}
