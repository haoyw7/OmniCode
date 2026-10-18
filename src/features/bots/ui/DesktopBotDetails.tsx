import { motion as motionElement } from "motion/react";
import { panelTransition, immediateTransition } from "../../../shared/motion/tokens";
import { reducedMotionQuery as motionPreferenceQuery } from "../../../shared/lib/reducedMotion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { SurfaceVisibilityContext, useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { useCollapseMotion } from "../../../shared/ui/AnimatedCollapse";
import { ChevronLeft, ChevronRight } from "../../../shared/ui/icons";
import "./desktop-bot-details.css";

/** Keep each visited editor mounted, including during reverse slide transitions. */
function DetailPage({ active, root = false, children }: { active: boolean; root?: boolean; children: ReactNode }) {
  const visible = useSurfaceVisibility(), motion = useCollapseMotion(active);
  const opened = useRef(active);
  if (active) opened.current = true;
  return <motionElement.section
      initial={false} animate={{ x: active ? 0 : root ? "-100%" : "100%" }} transition={motionPreferenceQuery().matches ? immediateTransition : panelTransition} onAnimationComplete={motion.finish} className="desktop-bot-detail-page" data-root={root} data-active={active} data-fold-state={motion.foldState}
    aria-hidden={!active || undefined} inert={!active || !visible}
    >
    <SurfaceVisibilityContext.Provider value={visible && active}>{opened.current && children}</SurfaceVisibilityContext.Provider>
  </motionElement.section>;
}

export function DesktopBotDetails({ identity, memory, runtime, activity, automation, management, delegations, children }: {
  identity?: ReactNode; memory?: ReactNode; runtime?: ReactNode; activity?: ReactNode;
  automation?: ReactNode; management?: ReactNode; delegations?: ReactNode; children: ReactNode;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState("settings");
  const heading = useRef<HTMLHeadingElement>(null), previous = useRef(selected);
  const pages = [
    { key: "runtime", label: "Runtime", content: <>{children}{runtime}</> },
    ...(memory ? [{ key: "memory", label: "Memory files", content: memory }] : []),
    ...(activity ? [{ key: "activity", label: "Activity", content: activity }] : []),
    ...(automation ? [{ key: "automation", label: "Automation", content: automation }] : []),
    ...(delegations ? [{ key: "delegations", label: "Delegations", content: delegations }] : []),
    ...(management ? [{ key: "threads", label: "Thread settings", content: management }] : []),
  ];
  useEffect(() => {
    if (previous.current !== selected) heading.current?.focus({ preventScroll: true });
    previous.current = selected;
  }, [selected]);
  // Legacy Hosts and mobile retain their original form without desktop navigation.
  if (!identity) return <>{children}{runtime}{management}</>;
  const label = pages.find(page => page.key === selected)?.label ?? "Settings";
  return <div className="desktop-bot-details" onKeyDown={event => {
    if (event.key === "Escape" && selected !== "settings" && !event.defaultPrevented) {
      event.preventDefault(); event.stopPropagation(); setSelected("settings");
    }
  }}>
    <header className="desktop-bot-details-heading">
      <button data-ui="icon-button" type="button" className="assistant-icon-button" disabled={selected === "settings"} aria-label={t("Back to settings")} onClick={() => setSelected("settings")}><ChevronLeft size={18} /></button>
      <h3 ref={heading} tabIndex={-1}>{t(label)}</h3>
    </header>
    <div className="desktop-bot-detail-pages">
      <DetailPage active={selected === "settings"} root>
        {identity}
        <nav aria-label={t("Bot details")} className="desktop-bot-settings-links">
          {pages.map(page => <button type="button" key={page.key} onClick={() => setSelected(page.key)}>{t(page.label)}<ChevronRight size={16} /></button>)}
        </nav>
      </DetailPage>
      {pages.map(page => <DetailPage key={page.key} active={selected === page.key}>{page.content}</DetailPage>)}
    </div>
  </div>;
}
