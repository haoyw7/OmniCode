import { Omi } from "../../shared/ui/branding/Omi";
import { IconButton } from "../../shared/ui/forms/IconButton";
import type { ReactNode } from "react";
import { useTranslation } from "../../shared/i18n/useTranslation";
import { useShortcutLabel } from "../commands/useCommandShortcut";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, PanelLeft } from "../../shared/ui/icons";
import { IS_MAC } from "../../platform/tauri/platform";
import { windowDragRegion } from "./startWindowDrag";
import { WindowControls } from "./WindowControls";

/**
 * Window chrome shared by every shell layout now that the workspace tab strip
 * is gone: the drag bar, product icon, navigation controls and reserved space.
 */

export function TabVisitNav({
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  onTogglePanel,
  panelActive = false,
  onToggleNavigation,
  navigationExpanded = true,
  showProductIcon = true,
}: {
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  onTogglePanel?: () => void;
  panelActive?: boolean;
  onToggleNavigation?: () => void;
  navigationExpanded?: boolean;
  showProductIcon?: boolean;
}) {
  const { t } = useTranslation();
  const backLabel = useShortcutLabel("Back", "Tab: Back");
  const forwardLabel = useShortcutLabel("Forward", "Tab: Forward");
  const panelLabel = useShortcutLabel("Toggle Sidebar", "App: Toggle Sidebar");
  return (
    <div data-window-visit-nav className="flex shrink-0 items-center">
      {showProductIcon ? <div data-window-product-icon className="flex w-10 shrink-0 items-center pl-1">
        <Omi compact aria-label="OmniCode"

          className="size-6"
        />
      </div> : null}
      {onTogglePanel ? (
        <IconButton size="sm" data-tauri-drag-region="false"
          label={panelLabel}
          active={panelActive}
          aria-pressed={panelActive}
          onClick={onTogglePanel}
        >
          <PanelLeft className="size-4" />
        </IconButton>
      ) : null}
      <IconButton size="sm" data-window-history-action data-tauri-drag-region="false" label={backLabel} aria-disabled={!canGoBack} onClick={onGoBack}>
        <ArrowLeft className="size-4" />
      </IconButton>
      <IconButton size="sm" data-window-history-action data-tauri-drag-region="false"
        label={forwardLabel}
        aria-disabled={!canGoForward}
        onClick={onGoForward}
      >
        <ArrowRight className="size-4" />
      </IconButton>
      {onToggleNavigation ? (
        <IconButton size="sm" data-tauri-drag-region="false"
          label={t(
            navigationExpanded
              ? "Collapse navigation menu"
              : "Expand navigation menu",
          )}
          aria-expanded={navigationExpanded}
          aria-controls="sidebar-navigation-menu"
          onClick={onToggleNavigation}
        >
          {navigationExpanded ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </IconButton>
      ) : null}
    </div>
  );
}

const WINDOW_NAVIGATION_LEFT = IS_MAC ? 78 : 6;
const WINDOW_NAVIGATION_WIDTH = 40 + 112;
// The navigation cluster is taken out of flow. This clearance keeps the
// titlebar actions, including Search, off the disclosure button.
const WINDOW_NAVIGATION_GAP = 12;
export const WINDOW_NAVIGATION_END =
  WINDOW_NAVIGATION_LEFT + WINDOW_NAVIGATION_WIDTH + WINDOW_NAVIGATION_GAP;
export const WINDOW_DRAG_BAR_HEIGHT = 42;

/** Keep native window dragging independent of the active page or pane layout. */
export function WindowDragBar({
  navigationItems,
  windowLeading,
  windowActions,
  windowNavigation,
  ...props
}: Parameters<typeof TabVisitNav>[0] & {
  /** Collapsed sidebar destinations, displayed after the navigation toggle. */
  navigationItems?: ReactNode;
  /** Left-aligned window-wide destination and its notification preview. */
  windowLeading?: ReactNode;
  /** Window-wide actions shown just before the window controls. */
  windowActions?: ReactNode;
  /** A custom navigation cluster, or null when supplied by the parent shell. */
  windowNavigation?: ReactNode;
}) {
  return (
    <header
      data-window-drag-bar
      {...windowDragRegion()}
      className="shell-chrome relative grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] select-none items-center"
      style={{ height: WINDOW_DRAG_BAR_HEIGHT }}
    >
      {windowNavigation === undefined ? <WindowNavigation {...props} /> : null}
      <div className="flex items-center self-stretch">
        {windowNavigation === undefined ? <div
          className="shrink-0"
          style={{ width: WINDOW_NAVIGATION_END }}
        /> : windowNavigation}
        {navigationItems}
      </div>
      <div
        data-window-leading
        className="flex min-w-0 items-center"
      >
        {windowLeading}
      </div>
      <div className="flex min-w-0 items-center justify-end self-stretch">
        {windowActions ? (
          <div
            data-tauri-drag-region="false"
            className="flex shrink-0 items-center"
          >
            {windowActions}
          </div>
        ) : null}
        {!IS_MAC ? <WindowControls /> : null}
      </div>
    </header>
  );
}

export function WindowNavigation(props: Parameters<typeof TabVisitNav>[0]) {
  const { t: uiT } = useTranslation();
  return (
    <nav
      aria-label={uiT("Window navigation")}
      data-window-navigation
      data-tauri-drag-region="false"
      className="absolute z-20 flex h-full items-center"
      style={{
        left: WINDOW_NAVIGATION_LEFT,
        top: 0,
      }}
    >
      <TabVisitNav {...props} />
    </nav>
  );
}

/** Reserve the same window coordinates for navigation in every shell layout. */
export function WindowNavigationSpace({
  besideCompactRail = false,
}: {
  besideCompactRail?: boolean;
}) {
  return (
    <div
      aria-hidden
      data-window-navigation-space
      className="shrink-0"
      style={{
        width:
          WINDOW_NAVIGATION_LEFT +
          WINDOW_NAVIGATION_WIDTH -
          (besideCompactRail ? 48 : 0),
      }}
    />
  );
}
