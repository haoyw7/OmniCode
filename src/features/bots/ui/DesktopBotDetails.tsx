import { Button } from "../../../shared/ui/forms/Button";
import { IconButton } from "../../../shared/ui/forms/IconButton";
import { motion as motionElement } from "motion/react";
import { panelTransition, immediateTransition } from "../../../shared/motion/tokens";
import { reducedMotionQuery as motionPreferenceQuery } from "../../../shared/lib/reducedMotion";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { SurfaceVisibilityContext, useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { useCollapseMotion } from "../../../shared/ui/AnimatedCollapse";
import { Tabs, TabsList, TabsTrigger } from "../../../shared/ui/primitives/Tabs";
import { ChevronLeft, ChevronRight } from "../../../shared/ui/icons";
import "./desktop-bot-details.css";

/** Keep each visited editor mounted, including during reverse slide transitions. */
function DetailPage({ active, root = false, id, labelledBy, children }: { active: boolean; root?: boolean; id: string; labelledBy: string; children: ReactNode }) {
  const visible = useSurfaceVisibility(), motion = useCollapseMotion(active);
  const opened = useRef(active);
  if (active) opened.current = true;
  return <motionElement.section
      initial={false} animate={{ x: active ? 0 : root ? "-100%" : "100%" }} transition={motionPreferenceQuery().matches ? immediateTransition : panelTransition} onAnimationComplete={motion.finish} className="desktop-bot-detail-page" data-root={root} data-active={active} data-fold-state={motion.foldState}
    aria-hidden={!active || undefined} inert={!active || !visible}
    id={id} role="tabpanel" aria-labelledby={labelledBy} tabIndex={active ? 0 : -1}
    >
    <SurfaceVisibilityContext.Provider value={visible && active}>{opened.current && children}</SurfaceVisibilityContext.Provider>
  </motionElement.section>;
}

export function DesktopBotDetails({ identity, memory, runtime, activity, automation, management, delegations, children }: {
  identity?: ReactNode; memory?: ReactNode; runtime?: ReactNode; activity?: ReactNode;
  automation?: ReactNode; management?: ReactNode; delegations?: ReactNode; children: ReactNode;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState("details");
  const scope = useId();
  const heading = useRef<HTMLHeadingElement>(null), previous = useRef(selected);
  const pages = [
    ...(activity ? [{ key: "activity", label: "Activity", content: activity }] : []),
    ...(automation ? [{ key: "automation", label: "Automation", content: automation }] : []),
    ...(delegations ? [{ key: "delegations", label: "Delegations", content: delegations }] : []),
    ...(management ? [{ key: "threads", label: "Thread settings", content: management }] : []),
  ];
  const subpage = pages.find(page => page.key === selected);
  const selectedTab = subpage ? "settings" : selected;
  const tabs = [
    { key: "details", label: "Details" },
    ...(memory ? [{ key: "memory", label: "Memory files" }] : []),
    ...(runtime ? [{ key: "runtime", label: "Runtime" }] : []),
    ...(pages.length ? [{ key: "settings", label: "Settings" }] : []),
  ];
  useEffect(() => {
    if (previous.current !== selected) heading.current?.focus({ preventScroll: true });
    previous.current = selected;
  }, [selected]);
  // Legacy Hosts and mobile retain their original form without desktop navigation.
  if (!identity) return <>{children}{runtime}{management}</>;
  return <div className="desktop-bot-details" onKeyDown={event => {
    if (event.key === "Escape" && selected !== "details" && !event.defaultPrevented) {
      event.preventDefault(); event.stopPropagation(); setSelected(subpage ? "settings" : "details");
    }
  }}>
    {identity}
    <Tabs value={selectedTab} onValueChange={setSelected} animated={false} className="desktop-bots-details-tabs">
      <TabsList aria-label={t("Bot details")}>
        {tabs.map(tab => <TabsTrigger key={tab.key} value={tab.key} id={`${scope}-${tab.key}-tab`} aria-controls={`${scope}-${tab.key === "settings" && subpage ? subpage.key : tab.key}`}>{t(tab.label)}</TabsTrigger>)}
      </TabsList>
    </Tabs>
    <div className="desktop-bot-detail-pages">
      <DetailPage active={selected === "details"} root id={`${scope}-details`} labelledBy={`${scope}-details-tab`}>
        {children}
      </DetailPage>
      {memory && <DetailPage active={selected === "memory"} id={`${scope}-memory`} labelledBy={`${scope}-memory-tab`}>{memory}</DetailPage>}
      {runtime && <DetailPage active={selected === "runtime"} id={`${scope}-runtime`} labelledBy={`${scope}-runtime-tab`}>{runtime}</DetailPage>}
      <DetailPage active={selected === "settings"} id={`${scope}-settings`} labelledBy={`${scope}-settings-tab`}>
        <nav aria-label={t("Bot details")} className="desktop-bot-settings-links">
          {pages.map(page => <Button variant="ghost" type="button" key={page.key} onClick={() => setSelected(page.key)}>{t(page.label)}<ChevronRight size={16} /></Button>)}
        </nav>
      </DetailPage>
      {pages.map(page => <DetailPage key={page.key} active={selected === page.key} id={`${scope}-${page.key}`} labelledBy={`${scope}-settings-tab`}>
        <header className="desktop-bot-details-heading">
          <IconButton type="button" className="assistant-icon-button" label={t("Back to settings")} onClick={() => setSelected("settings")}><ChevronLeft size={18} /></IconButton>
          <h3 ref={selected === page.key ? heading : undefined} tabIndex={-1}>{t(page.label)}</h3>
        </header>
        {page.content}
      </DetailPage>)}
    </div>
  </div>;
}
