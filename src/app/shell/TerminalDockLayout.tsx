import { motion, useAnimationControls } from "motion/react";
import { panelTransition, immediateTransition, duration } from "../../shared/motion/tokens";
import { useMotionPreference } from "../../shared/motion/useMotionPreference";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  applyDockGridStyle,
  dockGridStyle,
  type DockSide,
  type ProjectTerminalDock as ProjectTerminal,
} from "../../features/projects/model/projectTerminal";
import { sameProjectPath } from "../../features/projects/model/recents";
import { beginPaneResize } from "../../shared/lib/paneResize";
import { ProjectTerminalDock } from "../../features/terminal/ui/ProjectTerminalDock";
import { useCollapseMotion } from "../../shared/ui/AnimatedCollapse";
import { SurfaceVisibilityContext } from "../../shared/ui/SurfaceVisibility";

const RetainedTerminalDock = memo(ProjectTerminalDock);

// Short enough to read as a panel move, not a slide-in to wait through.
const DOCK_FOLD_MS = duration.panel * 1000;
const DOCK_FOLD_STYLE = {
  "--collapse-duration": `${DOCK_FOLD_MS}ms`,
} as CSSProperties;

type Props = Omit<
  ComponentProps<typeof ProjectTerminalDock>,
  "dock" | "onSizePaint"
> & {
  projectTerminals: ProjectTerminal[];
  currentDock?: ProjectTerminal;
  projectCwd: string;
  workspaceVisible: boolean;
  lastDockSide: DockSide | null;
  children: ReactNode;
};

/** Own animation phases here so settling a dock never rerenders the workspace. */
export function TerminalDockLayout({
  projectTerminals,
  currentDock,
  projectCwd,
  workspaceVisible,
  lastDockSide,
  focused,
  onSizeCommit,
  children,
  ...terminalProps
}: Props) {
  const grid = useRef<HTMLDivElement>(null);
  const controls = useAnimationControls();
  const reduced = useMotionPreference();
  const dragSize = useRef<number | null>(null);
  const currentDockRef = useRef(currentDock);
  currentDockRef.current = currentDock;
  const open = !!currentDock?.open;
  const { foldState, finish } = useCollapseMotion(open, DOCK_FOLD_MS);
  const folding = foldState === "opening" || foldState === "closing";
  useEffect(() => (folding ? beginPaneResize() : undefined), [folding]);
  const paintSize = useCallback((size: number) => {
    const dock = currentDockRef.current;
    const element = grid.current;
    if (!dock || !element) return;
    if (dragSize.current == null) controls.stop();
    dragSize.current = size;
    element.style.transitionProperty = "none";
    applyDockGridStyle(element, dock.side, size);
  }, [controls]);
  const syncDragSize = useCallback((size: number) => {
    const dock = currentDockRef.current;
    if (!dock) return;
    const painted = dockGridStyle(dock.side, size);
    controls.set({ gridTemplateRows: String(painted.gridTemplateRows), gridTemplateColumns: String(painted.gridTemplateColumns) });
  }, [controls]);
  const commitSize = useCallback(
    (size: number) => {
      // Synchronize Motion once, before React commits the final layout.
      syncDragSize(size);
      dragSize.current = null;
      grid.current?.style.removeProperty("transition-property");
      onSizeCommit(size);
    },
    [onSizeCommit, syncDragSize],
  );
  useLayoutEffect(() => {
    if (!open) dragSize.current = null;
    if (dragSize.current != null) return;
    const element = grid.current;
    if (!element) return;
    element.style.removeProperty("transition-property");
    const target = dockGridStyle(currentDock?.side ?? lastDockSide ?? "bottom", open ? (currentDock?.size ?? 0) : 0);
    element.style.gridTemplateAreas = String(target.gridTemplateAreas ?? "");
    void controls.start({ gridTemplateRows: String(target.gridTemplateRows), gridTemplateColumns: String(target.gridTemplateColumns), transition: reduced ? immediateTransition : panelTransition });
  }, [currentDock, open, lastDockSide, controls, reduced]);
  // Unrelated React updates must not restore Motion's pre-drag dimensions.
  // Keep this off the pointer-move path, which only writes DOM styles.
  useLayoutEffect(() => {
    if (dragSize.current != null) syncDragSize(dragSize.current);
  });

  return (
    <motion.div
      initial={false}
      animate={controls}
      onAnimationComplete={finish}
      ref={grid}
      data-terminal-dock-layout
      data-fold-state={foldState}
      className="animated-collapse-size pane-card-gutter grid h-full min-h-0 min-w-0 flex-1"
      style={DOCK_FOLD_STYLE}

    >
      {projectTerminals.map((dock) => {
        const current =
          workspaceVisible && sameProjectPath(dock.projectPath, projectCwd);
        const show = current && dock.open;
        const present = current && (show || foldState === "closing");
        return (
          <div
            key={dock.projectPath}
            className={
              present
                ? `h-full min-h-0 min-w-0 w-full ${show ? "" : "overflow-hidden"}`
                : "hidden"
            }
            style={present ? { gridArea: "dock" } : undefined}
            aria-hidden={!show}
            inert={!show || undefined}
          >
            <SurfaceVisibilityContext.Provider value={show}>
              <RetainedTerminalDock
                {...terminalProps}
                dock={dock}
                focused={show && focused}
                onSizePaint={paintSize}
                onSizeCommit={commitSize}
              />
            </SurfaceVisibilityContext.Provider>
          </div>
        );
      })}
      {children}
    </motion.div>
  );
}
