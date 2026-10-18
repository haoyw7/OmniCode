import { MobileListPreview } from "./MobileListPreview";
import { MobileSpinner } from "./MobileSpinner";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Bot,
  ChevronDown,
  Computer,
  File,
  Folder,
  Home,
  MessageSquarePlus,
  MoreHorizontal,
  Pin,
  Settings,
  TriangleAlert,
} from "../shared/ui/icons";
import type {
  HostProject,
  HostSessionSummary,
} from "../features/connections/model/protocol";
import { sessionDisplayTitle } from "../features/sessions/model/session";
import { HarnessIcon } from "../features/sessions/ui/HarnessIcon";
import { AnimatedCollapse, useCollapseMotion } from "../shared/ui/AnimatedCollapse";
import { SurfaceVisibilityContext, useSurfaceVisibility } from "../shared/ui/SurfaceVisibility";
import { useTranslation } from "../shared/i18n/useTranslation";
import type { HostConnectionStatus } from "./client";
import { MobileHostStatus } from "./MobileHostStatus";
import { lightImpact } from "./haptics";
import { formatMobileRelativeTime } from "./relativeTime";
import { useMobileSessionLists, type MobileProjectHistory } from "./sessionListStore";
import { sortMobileProjects, sortMobileSessions } from "./sessionList";
import { useListReorderMotion } from "../shared/hooks/useListReorderMotion";
import type { MobileSheetPoint } from "./MobileSheet";
import { animate, motion, useDragControls, useMotionValue, useTransform, type AnimationPlaybackControls } from "motion/react";
import { useMotionPreference } from "../shared/motion/useMotionPreference";
import { motionGeometry, immediateTransition, springs, panelTransition } from "../shared/motion/tokens";
import {
  canPullDrawerFrom,
  canPushDrawerFrom,
  clampDrawer,
  drawerIntent,
  settleDrawerOpen,
} from "./drawerGesture";

const MotionChevronDown = motion.create(ChevronDown);

type ProjectHistory = MobileProjectHistory;

interface Swipe {
  id: number;
  startEvent: PointerEvent;
  x: number;
  y: number;
  width: number;
  /** Translate when the touch began: -width when closed, 0 when open. */
  origin: number;
  opening: boolean;
  dragging: boolean;
  last: { x: number; t: number };
  velocity: number;
  release: () => void;
}

// Memoized: the drawer stays mounted under the conversation, and typing in
// the composer must not re-render every session row.
function useMobileDrawerController({
  open: requestedOpen,
  active = true,
  covered = false,
  foreground = true,
  onOpenChange,
  projects,
  project,
  sessions,
  sessionId,
  loading,
  unreadIds,
  now,
  hostName,
  hostStatus,
  hostTrigger,
  onHost,
  projectsPending = false,
  projectsUnavailable = false,
  onHome,
  onAllProjects,
  loadSessions,
  cachedSessions,
  refreshKey = 0,
  onSession,
  onSessionActions,
  sessionActionsId,
  onNewSession,
  onSettings,
  onAssistant,
  onNotes,
  assistantName,
  assistantUnreadCount = 0,
}: {
  open: boolean;
  /** Keep the closing drawer mounted without accepting edge gestures on another page. */
  active?: boolean;
  /** A device dropdown covers the drawer without closing it. */
  covered?: boolean;
  foreground?: boolean;
  onOpenChange: (open: boolean) => void;
  projects: HostProject[];
  project?: HostProject;
  sessions: HostSessionSummary[];
  sessionId?: string;
  loading: boolean;
  unreadIds: ReadonlySet<string>;
  now: number;
  hostName: string;
  hostStatus: HostConnectionStatus;
  hostTrigger?: RefObject<HTMLButtonElement | null>;
  onHost?: () => void;
  projectsPending?: boolean;
  projectsUnavailable?: boolean;
  onHome: () => void;
  onAllProjects: () => void;
  /** Reads another project's conversations; the current one arrives as `sessions`. */
  loadSessions: (projectId: string) => Promise<HostSessionSummary[]>;
  cachedSessions?: (projectId: string) => HostSessionSummary[] | undefined;
  /** Changes after a metadata edit so other projects' rows re-read the cache. */
  refreshKey?: number;
  onSession: (id: string, project: HostProject) => void;
  onSessionActions: (
    summary: HostSessionSummary,
    trigger: HTMLButtonElement,
    point?: MobileSheetPoint,
  ) => void;
  sessionActionsId?: string;
  onNewSession: (project: HostProject) => void;
  onSettings: () => void;
  onAssistant?: () => void;
  onNotes?: () => void;
  assistantName?: string;
  assistantUnreadCount?: number;
}) {
  const { language, t } = useTranslation();
  const surfaceVisible = useSurfaceVisibility();
  const open = requestedOpen && active;
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = useId();
  // A just-opened project can precede the next project list refresh.
  const treeProjects = useMemo(() =>
    project && !projects.some((item) => item.id === project.id)
      ? [project, ...projects]
      : projects, [project, projects]);
  // The current project has a faster subscription owned by the app.
  const historyIds = useMemo(() => JSON.stringify(treeProjects.filter((item) => item.id !== project?.id)
    .map((item) => item.id)), [treeProjects, project?.id]);
  const { histories, refresh: readHistories } = useMobileSessionLists({
    idsKey: historyIds, enabled: open && foreground, visible: open, loadSessions, cachedSessions, refreshKey,
  });
  const panel = useRef<HTMLElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const sessionsList = useRef<HTMLDivElement>(null);
  const swipe = useRef<Swipe>(undefined);
  const clearSwipe = () => {
    const current = swipe.current;
    swipe.current = undefined;
    current?.release();
  };
  const dragClickUntil = useRef(0);
  const hold = useRef<{
    pointerId: number;
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout>;
    moved: boolean;
    opened: boolean;
  }>(undefined);
  const suppressClick = useRef({ id: "", until: 0 });
  const cancelHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = undefined;
  };
  const showSessionActions = (
    summary: HostSessionSummary,
    trigger: HTMLButtonElement,
    point?: MobileSheetPoint,
  ) => {
    if (hold.current) {
      clearTimeout(hold.current.timer);
      hold.current.opened = true;
    }
    clearSwipe();
    setDragging(false);
    onSessionActions(summary, trigger, point);
  };
  useEffect(() => {
    cancelHold();
    return cancelHold;
  }, [open, covered, project?.id]);
  const startHold = (
    summary: HostSessionSummary,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    cancelHold();
    suppressClick.current.until = 0;
    if (event.pointerType === "mouse" || event.button !== 0) return;
    const trigger = event.currentTarget;
    const press = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      opened: false,
      timer: setTimeout(() => {
        press.opened = true;
        suppressClick.current = { id: summary.id, until: Infinity };
        void lightImpact();
        showSessionActions(summary, trigger, { x: press.x, y: press.y });
      }, 450),
    };
    hold.current = press;
  };
  const [dragging, setDragging] = useState(false);
  const reduced = useMotionPreference();
  const controls = useDragControls();
  const x = useMotionValue(0);
  const drawerWidth = useMotionValue(1);
  const progress = useTransform(() => Math.max(0, Math.min(1, 1 + x.get() / drawerWidth.get())));
  const release = useRef<AnimationPlaybackControls | undefined>(undefined);
  const releaseVelocity = useRef<number | undefined>(undefined);
  const { foldState, finish } = useCollapseMotion(open || dragging);
  const settledClosed = !open && !dragging && foldState === "closed";
  useLayoutEffect(() => {
    if (active && !covered) return;
    clearSwipe();
    controls.cancel();
    cancelHold();
    setDragging(false);
  }, [active, covered, controls]);
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element || dragging) return;
    const width = element.offsetWidth;
    drawerWidth.set(Math.max(1, width));
    release.current?.stop();
    const target = open ? 0 : -width;
    if (reduced) { x.jump(target); finish(); return; }
    if (open && x.get() === target) { finish(); return; }
    release.current = animate(x, target, {
      ...(reduced ? immediateTransition : springs.drawer), velocity: releaseVelocity.current, onComplete: finish,
    });
    releaseVelocity.current = undefined;
    return () => release.current?.stop();
  }, [open, dragging, reduced, x, drawerWidth, finish]);
  const latest = useRef({ open, onOpenChange });
  latest.current = { open, onOpenChange };
  const close = () => onOpenChange(false);

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
    return () => {
      if (
        trigger?.isConnected &&
        panel.current?.contains(document.activeElement)
      )
        trigger.focus({ preventScroll: true });
    };
  }, [open]);
  // One gesture pipeline: a pull on the conversation opens the drawer, a push
  // anywhere on screen closes it. The drawer follows the finger
  // and settles by distance or flick speed.
  useEffect(() => {
    if (!active || covered) return;
    // Touch Events stay on their original target even if a list refresh removes
    // it. Keep preventing native scrolling there after the drawer owns the drag;
    // the document listener alone stops receiving those detached-target events.
    const holdTouch = (event: Event) => {
      if (swipe.current?.dragging && event.cancelable) event.preventDefault();
    };
    const begin = (event: PointerEvent) => {
      // A new touch means the previous drag produced no click to swallow.
      dragClickUntil.current = 0;
      if (event.pointerType === "mouse" || swipe.current) return;
      const element = panel.current;
      if (!element) return;
      const { open } = latest.current;
      if (!(open ? canPushDrawerFrom : canPullDrawerFrom)(event.target)) return;
      const width = element.offsetWidth;
      release.current?.stop();
      drawerWidth.set(Math.max(1, width));
      const target = event.target instanceof Element ? event.target : undefined;
      target?.addEventListener("touchmove", holdTouch, { capture: true, passive: false });
      swipe.current = {
        id: event.pointerId,
        startEvent: event,
        x: event.clientX,
        y: event.clientY,
        width,
        origin: clampDrawer(x.get(), width),
        opening: !open,
        dragging: false,
        last: { x: event.clientX, t: event.timeStamp },
        velocity: 0,
        release: () => {
          target?.removeEventListener("touchmove", holdTouch, true);
          if (element.hasPointerCapture?.(event.pointerId))
            element.releasePointerCapture(event.pointerId);
        },
      };
    };
    const move = (event: PointerEvent) => {
      const current = swipe.current;
      if (!current || current.id !== event.pointerId) return;
      const dx = event.clientX - current.x;
      if (!current.dragging) {
        const intent = drawerIntent(
          dx,
          event.clientY - current.y,
          current.opening,
        );
        if (intent === "undecided") return;
        if (intent === "scroll") {
          clearSwipe();
          return;
        }
        current.dragging = true;
        // Session rows (including their status label) can be replaced mid-drag.
        // Route the pointer stream through the stable drawer panel instead.
        panel.current?.setPointerCapture?.(event.pointerId);
        // The gesture now belongs to the drawer, not to text selection or a
        // pending long press on a session row.
        window.getSelection()?.removeAllRanges();
        cancelHold();
        // Drop the settle transition before the first inline position lands,
        // rather than when React next commits.
        if (backdrop.current) backdrop.current.dataset.dragging = "true";
        setDragging(true);
        controls.start(current.startEvent, { distanceThreshold: 0 });
      }
      const elapsed = event.timeStamp - current.last.t;
      if (elapsed > 0)
        current.velocity = (event.clientX - current.last.x) / elapsed;
      current.last = { x: event.clientX, t: event.timeStamp };
    };
    const end = (event: PointerEvent) => {
      const current = swipe.current;
      if (!current || current.id !== event.pointerId) return;
      if (!current.dragging) {
        clearSwipe();
        return;
      }
      // A cancelled pointer may carry no coordinates. Keep the last actual
      // touch, and flush pending input before the spring takes over.
      if (event.type !== "pointercancel") current.last.x = event.clientX;
      controls.cancel();
      clearSwipe();
      // A drag may start on a button; the click that follows must not land.
      dragClickUntil.current = Date.now() + 400;
      const translate = clampDrawer(
        current.origin + current.last.x - current.x,
        current.width,
      );
      const open =
        event.type === "pointercancel"
          ? latest.current.open
          : settleDrawerOpen(translate, current.width, current.velocity);
      x.set(translate);
      releaseVelocity.current = event.type === "pointercancel" ? 0 : current.velocity * 1000;
      release.current?.stop();
      release.current = animate(x, open ? 0 : -current.width, {
        ...(reduced ? immediateTransition : springs.drawer),
        velocity: event.type === "pointercancel" ? 0 : current.velocity * 1000,
        onComplete: finish,
      });
      setDragging(false);
      if (open !== latest.current.open) {
        void lightImpact();
        latest.current.onOpenChange(open);
      }
    };
    const swallowClick = (event: MouseEvent) => {
      if (Date.now() >= dragClickUntil.current) return;
      dragClickUntil.current = 0;
      event.preventDefault();
      event.stopPropagation();
    };
    // Once the drawer owns a drag, keep the browser from turning the same
    // touch into a scroll or navigation, which would cancel the pointer and
    // snap the drawer back mid-gesture.
    document.addEventListener("pointerdown", begin, true);
    document.addEventListener("touchmove", holdTouch, {
      capture: true,
      passive: false,
    });
    document.addEventListener("click", swallowClick, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", end, true);
    document.addEventListener("pointercancel", end, true);
    return () => {
      document.removeEventListener("pointerdown", begin, true);
      document.removeEventListener("touchmove", holdTouch, true);
      document.removeEventListener("click", swallowClick, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", end, true);
      document.removeEventListener("pointercancel", end, true);
      clearSwipe();
    };
  }, [active, covered, controls, x, drawerWidth, reduced, finish]);

  const tree = useMemo(() => sortMobileProjects(treeProjects, (id) =>
    id === project?.id ? sessions : (histories[id]?.sessions ?? []),
  ), [treeProjects, project?.id, sessions, histories]);
  const projectHistory = useCallback((item: HostProject): ProjectHistory =>
    item.id === project?.id
      ? { sessions, loading: loading && !sessions.length, failed: false }
      : (histories[item.id] ?? { loading: true, failed: false }), [project?.id, sessions, loading, histories]);
  const treeLoading = !tree.some((item) => item.id === project?.id
    ? sessions.length > 0 || cachedSessions?.(item.id) !== undefined
    : histories[item.id]?.sessions !== undefined) &&
    tree.some((item) => projectHistory(item).loading);
  const ownerById = useMemo(() => new Map(tree.map((item) => [item.id, item])), [tree]);
  const allSessions = useMemo(() => sortMobileSessions(
    tree.flatMap((item) => projectHistory(item).sessions ?? []),
  ).filter((item) => ownerById.has(item.projectId)), [tree, projectHistory, ownerById]);
  const pinnedOrder = useRef(new Map<string, number>());
  const pins = useMemo(() => allSessions.filter((item) => item.pinned).sort((a, b) =>
    (pinnedOrder.current.get(a.id) ?? -1) - (pinnedOrder.current.get(b.id) ?? -1),
  ), [allSessions]);
  useLayoutEffect(() => {
    pinnedOrder.current = new Map(pins.map((item, index) => [item.id, index]));
  }, [pins]);
  const recents = useMemo(() => allSessions.filter((item) => !item.pinned), [allSessions]);
  const sessionOrder = useMemo(() => [...pins, ...recents].map((item) => item.id), [pins, recents]);
  useListReorderMotion(sessionsList, sessionOrder, "data-session-id");
  const failedProjects = useMemo(() => tree.filter((item) => {
    const history = projectHistory(item);
    return history.failed && !history.sessions;
  }), [tree, projectHistory]);
  const row = (item: HostSessionSummary) => {
    const owner = ownerById.get(item.projectId)!;
    return (
      <button
        type="button"
        className="mobile-list-row mobile-session-row"
        key={item.id}
        data-session-id={item.id}
        data-needs-input={item.needsInput || undefined}
        aria-current={item.id === sessionId ? "page" : undefined}
        aria-haspopup="dialog"
        aria-expanded={sessionActionsId === item.id}
        onPointerDown={(event) => startHold(item, event)}
        onPointerMove={(event) => {
          const press = hold.current;
          if (!press || press.pointerId !== event.pointerId) return;
          if (
            Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10
          ) {
            press.moved = true;
            clearTimeout(press.timer);
          }
        }}
        onPointerUp={(event) => {
          const press = hold.current;
          if (!press || press.pointerId !== event.pointerId) return;
          if (press.moved || press.opened)
            suppressClick.current = { id: item.id, until: Date.now() + 500 };
          cancelHold();
        }}
        onPointerCancel={() => {
          suppressClick.current = { id: item.id, until: Date.now() + 500 };
          cancelHold();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          suppressClick.current = { id: item.id, until: Date.now() + 500 };
          const press = hold.current;
          const point = press
            ? { x: press.x, y: press.y }
            : event.clientX || event.clientY
              ? { x: event.clientX, y: event.clientY }
              : undefined;
          showSessionActions(item, event.currentTarget, point);
        }}
        onClick={(event) => {
          if (
            suppressClick.current.id === item.id &&
            Date.now() < suppressClick.current.until
          ) {
            event.preventDefault();
            return;
          }
          onSession(item.id, owner);
        }}
      >
        <span className="mobile-row-text">
          <HarnessIcon
            harness={item.harness}
            className="mobile-drawer-session-icon"
          />
          <strong>
            {sessionDisplayTitle(item.title, item.harness) ||
              t("Untitled conversation")}
          </strong>
          <small>
            {item.needsInput ? (
              <span className="mobile-session-attention">
                <TriangleAlert size={14} aria-hidden="true" />
                {t("Needs input")}
              </span>
            ) : item.pinned && item.status !== "running" ? (
              <Pin size={12} aria-label={t("Pin")} />
            ) : null}
            {tree.length > 1 && (
              <span className="mobile-drawer-session-project">{owner.name}</span>
            )}
            {!item.needsInput && (item.status === "running" ? (
              <MobileSpinner size={16} className="mobile-spin" aria-label={t("Working")} />
            ) : (
              <span>{formatMobileRelativeTime(item.updatedAt, now, language)}</span>
            ))}
            {unreadIds.has(item.id) ? (
              <span
                className="mobile-unread-dot"
                role="img"
                aria-label={t("Unread reply")}
              />
            ) : null}
          </small>
        </span>
      </button>
    );
  };
  return {
    assistantName,
    assistantUnreadCount,
    backdrop,
    close,
    covered,
    dragging,
    failedProjects,
    foreground,
    hostName,
    hostStatus,
    hostTrigger,
    moreId,
    moreOpen,
    onAllProjects,
    onAssistant,
    onHome,
    onHost,
    onNewSession,
    onNotes,
    onSettings,
    open,
    panel,
    pins,
    project,
    projectsPending,
    projectsUnavailable,
    readHistories,
    recents,
    row,
    sessionsList,
    setMoreOpen,
    settledClosed,
    controls, x, progress,
    surfaceVisible,
    t,
    tree,
    treeLoading,
  };
}

type MobileDrawerViewModel = ReturnType<typeof useMobileDrawerController>;

function MobileDrawerView({ vm }: { vm: MobileDrawerViewModel }) {
  const {
    assistantName,
    assistantUnreadCount,
    backdrop,
    close,
    covered,
    dragging,
    failedProjects,
    foreground,
    hostName,
    hostStatus,
    hostTrigger,
    moreId,
    moreOpen,
    onAllProjects,
    onAssistant,
    onHome,
    onHost,
    onNewSession,
    onNotes,
    onSettings,
    open,
    panel,
    pins,
    project,
    projectsPending,
    projectsUnavailable,
    readHistories,
    recents,
    row,
    sessionsList,
    setMoreOpen,
    settledClosed,
    controls, x, progress,
    surfaceVisible,
    t,
    tree,
    treeLoading,
  } = vm;
  return (
    <SurfaceVisibilityContext.Provider value={surfaceVisible && open && foreground && !covered}>
    <motion.div
      ref={backdrop}
      className="mobile-drawer-backdrop"
      style={{ "--mobile-drawer-progress": progress } as import("motion/react").MotionStyle}
      data-open={open}
      data-dragging={dragging || undefined}
      data-settled-closed={settledClosed || undefined}
      inert={!open && !dragging}
      aria-hidden={!open && !dragging}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <motion.nav
        drag="x"
        dragListener={false}
        dragControls={controls}
        dragMomentum={false}
        dragElastic={false}
        style={{ x }}
        ref={panel}
        className="mobile-drawer"
        aria-label={t("Menu")}
        inert={covered}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
      >
        <div className="mobile-drawer-top">
          <button
            ref={hostTrigger}
            type="button"
            className="mobile-drawer-item mobile-drawer-device"
            aria-label={t("Switch device")}
            aria-haspopup="dialog"
            aria-expanded={covered}
            onClick={onHost}
          >
            <Computer size={22} />
            <span>{hostName}</span>
            <MobileHostStatus status={hostStatus} dotOnly />
            <ChevronDown size={16} className="mobile-drawer-device-chevron" />
          </button>
          {onAssistant && (
            <button
              type="button"
              className="mobile-drawer-item mobile-drawer-assistant"
              aria-label={assistantUnreadCount > 0 ? t("{name}, {count} unread messages", {
                name: assistantName || t("Assistant"), count: assistantUnreadCount,
              }) : undefined}
              onClick={onAssistant}
            >
              <Bot size={22} />
              <span>{assistantName || t("Assistant")}</span>
              {assistantUnreadCount > 0 && (
                <span className="mobile-drawer-assistant-badge" aria-hidden="true">
                  {assistantUnreadCount > 99 ? "99+" : assistantUnreadCount}
                </span>
              )}
            </button>
          )}
          <button type="button" className="mobile-drawer-item" onClick={onHome}>
            <Home size={22} />
            <span>{t("Sessions")}</span>
          </button>
          <button
            type="button"
            className="mobile-drawer-item mobile-drawer-new"
            disabled={!project}
            onClick={() => project && onNewSession(project)}
          >
            <MessageSquarePlus size={22} />
            <span>{t("New conversation")}</span>
          </button>
          <div>
            <button
              type="button"
              className="mobile-drawer-item mobile-drawer-more-toggle"
              aria-expanded={moreOpen}
              aria-controls={moreId}
              onClick={() => setMoreOpen((value) => !value)}
            >
              <MoreHorizontal size={22} />
              <span>{t(moreOpen ? "Show less" : "More")}</span>
              <MotionChevronDown size={16} className="mobile-drawer-more-chevron" animate={{ rotate: moreOpen ? motionGeometry.flipAngle : 0 }} transition={panelTransition} />
            </button>
            <div id={moreId}>
              <AnimatedCollapse expanded={moreOpen}>
                <div className="mobile-drawer-secondary">
                  {onNotes && (
                    <button type="button" className="mobile-drawer-item" onClick={onNotes}>
                      <File size={22} />
                      <span>{t("Notes")}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="mobile-drawer-item mobile-drawer-all-projects"
                    onClick={onAllProjects}
                  >
                    <Folder size={22} />
                    <span>{t("Projects")}</span>
                  </button>
                </div>
              </AnimatedCollapse>
            </div>
          </div>
        </div>
        <div ref={sessionsList} className="mobile-drawer-sessions">
          {projectsUnavailable && !tree.length ? (
            <p className="mobile-drawer-empty">{t("Couldn’t load projects")}</p>
          ) : projectsPending || treeLoading ? (
            <div className="mobile-loading mobile-drawer-group-status" role="status">
              <MobileSpinner size={15} className="mobile-spin" />
              {t("Loading conversations…")}
            </div>
          ) : !tree.length ? (
            <p className="mobile-drawer-empty">{t("Choose a project")}</p>
          ) : (
            <>
              {!!pins.length && (
                <section className="mobile-drawer-group" aria-label={t("Pinned")}>
                  <h2 className="mobile-drawer-heading">{t("Pinned")}</h2>
                  <div className="mobile-list mobile-session-list">
                    {pins.map(row)}
                  </div>
                </section>
              )}
              <section className="mobile-drawer-group" aria-label={t("Recents")}>
                <h2 className="mobile-drawer-heading">{t("Recents")}</h2>
                {recents.length ? (
                  <div className="mobile-list mobile-session-list">
                    <MobileListPreview
                      buttonClassName="mobile-drawer-more"
                      initialLimit={20}
                      items={recents}
                      renderItem={row}
                    />
                  </div>
                ) : (
                  <p className="mobile-drawer-empty mobile-drawer-group-status">
                    {t("No conversations yet")}
                  </p>
                )}
              </section>
              {failedProjects.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="mobile-drawer-empty mobile-drawer-group-status"
                  onClick={() => readHistories([item.id])}
                >
                  {t("Couldn’t load sessions")} · {item.name} · {t("Retry")}
                </button>
              ))}
            </>
          )}
        </div>
        <button
          type="button"
          className="mobile-drawer-item mobile-drawer-settings"
          onClick={onSettings}
        >
          <Settings size={22} />
          <span>{t("Settings")}</span>
        </button>
      </motion.nav>
    </motion.div>
    </SurfaceVisibilityContext.Provider>
  );
}

export const MobileDrawer = memo(function MobileDrawer(props: {
  open: boolean;
  /** Keep the closing drawer mounted without accepting edge gestures on another page. */
  active?: boolean;
  /** A device dropdown covers the drawer without closing it. */
  covered?: boolean;
  foreground?: boolean;
  onOpenChange: (open: boolean) => void;
  projects: HostProject[];
  project?: HostProject;
  sessions: HostSessionSummary[];
  sessionId?: string;
  loading: boolean;
  unreadIds: ReadonlySet<string>;
  now: number;
  hostName: string;
  hostStatus: HostConnectionStatus;
  hostTrigger?: RefObject<HTMLButtonElement | null>;
  onHost?: () => void;
  projectsPending?: boolean;
  projectsUnavailable?: boolean;
  onHome: () => void;
  onAllProjects: () => void;
  /** Reads another project's conversations; the current one arrives as `sessions`. */
  loadSessions: (projectId: string) => Promise<HostSessionSummary[]>;
  cachedSessions?: (projectId: string) => HostSessionSummary[] | undefined;
  /** Changes after a metadata edit so other projects' rows re-read the cache. */
  refreshKey?: number;
  onSession: (id: string, project: HostProject) => void;
  onSessionActions: (
    summary: HostSessionSummary,
    trigger: HTMLButtonElement,
    point?: MobileSheetPoint,
  ) => void;
  sessionActionsId?: string;
  onNewSession: (project: HostProject) => void;
  onSettings: () => void;
  onAssistant?: () => void;
  onNotes?: () => void;
  assistantName?: string;
  assistantUnreadCount?: number;
}) {
  return <MobileDrawerView vm={useMobileDrawerController(props)} />;
}, (previous, next) => {
  // Closed drawers retain their last rendered preview while chat streams and
  // activity updates. Opening receives every latest prop before it is usable;
  // lifecycle/gesture changes must still reach the mounted surface immediately.
  if (!previous.open && !next.open)
    return previous.active === next.active && previous.foreground === next.foreground &&
      previous.covered === next.covered &&
      previous.onOpenChange === next.onOpenChange && previous.loadSessions === next.loadSessions &&
      previous.cachedSessions === next.cachedSessions;
  const keys = Object.keys(next) as (keyof typeof next)[];
  return keys.length === Object.keys(previous).length && keys.every((key) => Object.is(previous[key], next[key]));
});
