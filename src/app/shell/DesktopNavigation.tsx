import { NavigationItem } from "../../shared/ui/messaging/NavigationItem";
import { useTranslation } from "../../shared/i18n/useTranslation";
import { AnimatedCollapse } from "../../shared/ui/AnimatedCollapse";
import {
  Bot,
  ChevronRight,
  Chatting,
  CodeXml,
  Folder,
  Inbox,
  IconArtworkContext,
  Plus,
  StickyNote,
  Workflow,
  Zap,
} from "../../shared/ui/icons";
import { useState, type ReactNode } from "react";
import { useSurfaceVisibility } from "../../shared/ui/SurfaceVisibility";
import { TabVisitNav } from "./WindowChrome";
import type { DesktopMode } from "../model/desktopMode";
import type { ActivityBarProps } from "./ActivityBar";
import { desktopNavigationIconArtwork, desktopTitlebarIconArtwork } from "../desktopIconArtwork";

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
  return (
    <IconArtworkContext.Provider value={desktopTitlebarIconArtwork}>
      <nav
        className="desktop-titlebar-navigation"
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
    </IconArtworkContext.Provider>
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
            onClick={() => onChange(value)}
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
    <IconArtworkContext.Provider value={desktopNavigationIconArtwork}>
      <div className="desktop-navigation" data-sidebar-primary-action>
        <NavigationItem icon={<Plus />} onClick={onNew}>
          {t(mode === "chat" ? "New chat" : "New task")}
        </NavigationItem>
      </div>
    </IconArtworkContext.Provider>
  );
}

export function DesktopNavigation({
  onProjects,
  projectsActive,
  onBots,
  botsActive,
  activity,
}: {
  onProjects: () => void;
  projectsActive: boolean;
  onBots: () => void;
  botsActive: boolean;
  activity: ActivityBarProps;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
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
      label: "Automations",
      icon: Zap,
      onClick: activity.onOpenAutomations,
      active: activity.automationsActive,
    },
    {
      label: "Workflows",
      icon: Workflow,
      onClick: activity.onOpenWorkflows,
      active: activity.workflowsActive,
    },
  ];
  return (
    <IconArtworkContext.Provider value={desktopNavigationIconArtwork}>
      <nav className="desktop-navigation" aria-label={t("Main navigation")}>
        <NavigationItem icon={<Folder />} aria-current={projectsActive ? "page" : undefined} onClick={onProjects}>
          {t("Projects")}
        </NavigationItem>
        <NavigationItem icon={<Bot />} aria-current={botsActive ? "page" : undefined} onClick={onBots}>
          {t("Bots")}
        </NavigationItem>
        <NavigationItem icon={<ChevronRight style={{ rotate: expanded ? "90deg" : "0deg" }} />}
          aria-expanded={expanded} aria-controls="desktop-more-navigation" onClick={() => setExpanded(value => !value)}>
          {t("More")}
        </NavigationItem>
        <AnimatedCollapse expanded={expanded} keepMounted>
          <div id="desktop-more-navigation" className="desktop-more-navigation">
            {entries
              .filter((entry) => entry.onClick)
              .map(({ label, icon: Icon, onClick, active, dot }) => (
                <NavigationItem key={label} icon={<Icon />} aria-current={active ? "page" : undefined} onClick={onClick}
                  trailing={dot ? <span data-ui="navigation-dot" aria-hidden="true" /> : undefined}>
                  {t(label)}
                </NavigationItem>
              ))}
          </div>
        </AnimatedCollapse>
      </nav>
    </IconArtworkContext.Provider>
  );
}
