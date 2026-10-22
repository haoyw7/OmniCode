import { NavigationItem } from "../../shared/ui/messaging/NavigationItem";
import { useTranslation } from "../../shared/i18n/useTranslation";
import { AnimatedCollapse } from "../../shared/ui/AnimatedCollapse";
import { ActionMenu } from "../../shared/ui/primitives/ActionMenu";
import { PresenceBoundary } from "../../shared/ui/PresenceBoundary";
import {
  Bot,
  Chatting,
  CodeXml,
  Inbox,
  MoreHorizontal,
  Plus,
  StickyNote,
  Workflow,
  Zap,
} from "../../shared/ui/icons";
import { useEffect, useState, type ReactNode } from "react";
import { useSurfaceVisibility } from "../../shared/ui/SurfaceVisibility";
import { TabVisitNav } from "./WindowChrome";
import type { DesktopMode } from "../model/desktopMode";
import type { ActivityBarProps } from "./ActivityBar";
import { useInlineBreakpoints } from "../../shared/hooks/useInlineBreakpoints";

const TITLEBAR_NAVIGATION_BREAKPOINTS = [206];

/** Keep window navigation outside the animated sidebar and main surface. */
export function DesktopTitlebarNavigation({
  menu,
  modeToggle,
  ...navigation
}: Parameters<typeof TabVisitNav>[0] & {
  menu: ReactNode;
  modeToggle: ReactNode;
}) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const navigationRef = useInlineBreakpoints(TITLEBAR_NAVIGATION_BREAKPOINTS);
  return (
    <>
      <nav
        ref={navigationRef}
        className="desktop-titlebar-navigation"
        data-sidebar-open={navigation.panelActive || undefined}
        data-window-navigation={visible || undefined}
        aria-label={t("Window navigation")}
        data-tauri-drag-region="false"
      >
        {menu}
        <TabVisitNav {...navigation} showProductIcon={false} />
        <div className="desktop-titlebar-mode-slot">
          <AnimatedCollapse expanded={Boolean(navigation.panelActive)} keepMounted>
            {modeToggle}
          </AnimatedCollapse>
        </div>
      </nav>
    </>
  );
}

export function DesktopModeToggle({
  mode,
  onChange,
}: {
  mode: DesktopMode;
  onChange: (mode: DesktopMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="desktop-mode-toggle"
      role="group"
      aria-label={t("Workspace mode")}
      data-tauri-drag-region="false"
    >
      {(["chat", "code"] as const).map((value) => {
        const Icon = value === "chat" ? Chatting : CodeXml;
        return (
          <button
            key={value}
            type="button"
            aria-label={t(value === "chat" ? "Chat" : "Code")}
            title={t(value === "chat" ? "Chat" : "Code")}
            aria-pressed={mode === value}
            onClick={() => onChange(value)} className="hover:opacity-80 active:opacity-70"
          >
            <Icon strokeWidth={value === "chat" ? 1.5 : 2} />
          </button>
        );
      })}
    </div>
  );
}

export function DesktopNewSessionAction({
  mode,
  onNew,
}: {
  mode: DesktopMode;
  onNew: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="desktop-navigation" data-sidebar-primary-action>
        <NavigationItem icon={<Plus />} onClick={onNew}>
          {t(mode === "chat" ? "New chat" : "New task")}
        </NavigationItem>
      </div>
    </>
  );
}

export function DesktopNavigation({
  onBots,
  botsActive,
  activity,
}: {
  onBots: () => void;
  botsActive: boolean;
  activity: ActivityBarProps;
}) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const [moreMenu, setMoreMenu] = useState<{
    anchor: HTMLButtonElement;
    initialHighlight?: "first" | "last";
  } | null>(null);
  useEffect(() => {
    if (!visible || !activity.onOpenAutomations) setMoreMenu(null);
  }, [visible, activity.onOpenAutomations]);
  const moreOpen = visible && !!moreMenu && !!activity.onOpenAutomations;
  const entries = [
    {
      label: "Inbox",
      icon: Inbox,
      onClick: activity.onOpenInbox,
      active: activity.inboxActive,
      dot: activity.inboxUnseen,
    },
    {
      label: "Notes",
      icon: StickyNote,
      onClick: activity.notesEnabled ? activity.onOpenNotes : undefined,
      active: activity.notesActive,
    },
    {
      label: "Workflows",
      icon: Workflow,
      onClick: activity.onOpenWorkflows,
      active: activity.workflowsActive,
    },
  ];
  return (
    <>
      <nav className="desktop-navigation" aria-label={t("Main navigation")}>
        <NavigationItem icon={<Bot />} aria-current={botsActive ? "page" : undefined} onClick={onBots}>
          {t("Bots")}
        </NavigationItem>
        {entries
          .filter((entry) => entry.onClick)
          .map(({ label, icon: Icon, onClick, active, dot }) => (
            <NavigationItem key={label} icon={<Icon />} aria-current={active ? "page" : undefined} onClick={onClick}
              trailing={dot ? <span data-ui="navigation-dot" aria-hidden="true" /> : undefined}>
              {t(label)}
            </NavigationItem>
          ))}
        {activity.onOpenAutomations ? (
          <NavigationItem
            icon={<MoreHorizontal />}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-current={activity.automationsActive ? "page" : undefined}
            onClick={(event) => setMoreMenu(moreOpen ? null : { anchor: event.currentTarget })}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setMoreMenu({ anchor: event.currentTarget, initialHighlight: event.key === "ArrowDown" ? "first" : "last" });
              }
            }}
          >
            {t("More")}
          </NavigationItem>
        ) : null}
      </nav>
      <PresenceBoundary>
        {moreOpen ? (
          <ActionMenu
            anchor={moreMenu.anchor}
            initialHighlight={moreMenu.initialHighlight}
            side="right"
            align="start"
            ariaLabel={t("More")}
            items={[{ kind: "item", id: "automations", label: t("Automations"), icon: <Zap /> }]}
            onPick={() => {
              setMoreMenu(null);
              activity.onOpenAutomations?.();
            }}
            onClose={() => setMoreMenu(null)}
          />
        ) : null}
      </PresenceBoundary>
    </>
  );
}
