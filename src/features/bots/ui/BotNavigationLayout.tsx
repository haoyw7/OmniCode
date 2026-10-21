import { createContext, useContext, useState, type ReactNode, type TransitionEvent } from "react";
import { useCollapseMotion } from "../../../shared/ui/AnimatedCollapse";
import { IconButton } from "../../../shared/ui/forms/IconButton";
import { PanelLeft } from "../../../shared/ui/icons";
import { useTranslation } from "../../../shared/i18n/useTranslation";

const preferenceKey = "omnicode.bots-sidebar-open";
const NavigationContext = createContext<{
  expanded: boolean;
  toggle: () => void;
  foldState: "open" | "opening" | "closing" | "closed";
  finish: () => void;
} | undefined>(undefined);

export function BotNavigationProvider({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem(preferenceKey) !== "false"; } catch { return true; }
  });
  const { foldState, finish } = useCollapseMotion(expanded, 240);
  const toggle = () => setExpanded(current => {
    try { localStorage.setItem(preferenceKey, String(!current)); } catch { /* Optional preference. */ }
    return !current;
  });
  return <NavigationContext.Provider value={{ expanded, toggle, foldState, finish }}>{children}</NavigationContext.Provider>;
}

export function useBotNavigationExpanded() {
  return useContext(NavigationContext)?.expanded ?? true;
}

export function useBotNavigationLayout() {
  const navigation = useContext(NavigationContext);
  return navigation ? {
    "data-bots-navigation-open": navigation.expanded,
    "data-bots-navigation-fold": navigation.foldState,
    onTransitionEnd: (event: TransitionEvent<HTMLElement>) => {
      if (event.target === event.currentTarget && event.propertyName === "grid-template-columns") navigation.finish();
    },
  } : {};
}

export function BotNavigationToggle({ className }: { className?: string }) {
  const navigation = useContext(NavigationContext);
  const { t } = useTranslation();
  if (!navigation) return null;
  return <IconButton data-bots-navigation-toggle className={className} size="sm" label={t(navigation.expanded ? "Collapse bots list" : "Expand bots list")}
    aria-expanded={navigation.expanded} onClick={navigation.toggle}><PanelLeft /></IconButton>;
}
