// Real mobile components with local data, used by Playwright in both motion modes.
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { defaultTransition } from "../../src/shared/motion/tokens";
import { MobileSheet } from "../../src/mobile/MobileSheet";
import { MobileSheetPresence } from "../../src/mobile/MobileSheetPresence";
import { MobileDrawer } from "../../src/mobile/MobileDrawer";
import { MobilePageTransition } from "../../src/mobile/MobilePageTransition";
import { installKeyboardMotion } from "../../src/mobile/keyboardMotion";
import { applyMobileSkin } from "../../src/mobile/theme/skin";
import "../../src/mobile/theme/index.css";
import "../../src/mobile/styles/index.css";
import "../../src/mobile/motion.css";
applyMobileSkin("daylight");
installKeyboardMotion();
const noop = () => {};
const project = { id: "project", name: "Monocode", cwd: "/fixture" };
function Fixture() {
  const [sheet, setSheet] = useState(false);
  const [popup, setPopup] = useState<"anchor" | "dialog" | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const [drawer, setDrawer] = useState(false);
  const [page, setPage] = useState(false);
  return <MotionConfig reducedMotion="user" transition={defaultTransition}>
    <div className="mobile-app" style={{height:"100dvh",background:"var(--color-m-bg)",color:"var(--color-m-ink)"}}>
      <MobilePageTransition route={{key:page?"chat":"home",section:page?"chat":"home",depth:page?1:0}}>
        <main className="mobile-home-scroll" style={{padding:24,height:"100%"}}>
          <h1>{page ? "Conversation" : "Monocode"}</h1>
          <p>Physical sheet and drawer springs. Route state is preserved during travel.</p>
          <div style={{display:"grid",gap:16}}>
            <button data-testid="sheet-open" onClick={()=>setSheet(true)}>Open sheet</button>
            <button ref={anchor} data-testid="anchor-open" onClick={()=>setPopup("anchor")}>Open menu</button>
            <button data-testid="dialog-open" onClick={()=>setPopup("dialog")}>Open dialog</button>
            <button data-testid="drawer-open" onClick={()=>setDrawer(true)}>Open drawer</button>
            <button data-testid="page-switch" onClick={()=>setPage(value=>!value)}>{page ? "Back" : "Forward"}</button>
          </div>
        </main>
      </MobilePageTransition>
      <MobileDrawer open={drawer} onOpenChange={setDrawer} projects={[project]} project={project}
        sessions={[{id:"one",projectId:project.id,title:"Animation migration",harness:"codex",status:"idle",revision:1,updatedAt:100}]}
        unreadIds={new Set()} now={100} loading={false} hostName="Local fixture" hostStatus={{state:"connected"}}
        loadSessions={async()=>[]} onHome={()=>setDrawer(false)} onAllProjects={noop} onSession={noop}
        onSessionActions={noop} onNewSession={noop} onSettings={noop}/>
      <MobileSheetPresence open={sheet}><MobileSheet key="sheet" title="Motion sheet" onClose={()=>setSheet(false)} detents
        header={{title:"Tool details",subtitle:"Drag down to dismiss or up to expand"}}>
        <div style={{padding:20}}><h2>Retained sheet content</h2><p>Pull a short distance to spring back, or pass the existing threshold to close.</p>
        <input data-ui="input" aria-label="Retained sheet input" defaultValue="Draft stays mounted"/><p style={{height:120}}>Native content scrolling stays available.</p></div>
      </MobileSheet></MobileSheetPresence>
      <MobileSheetPresence open={popup !== null}>
        {popup && <MobileSheet title="Popup" placement={popup} anchor={anchor} onClose={()=>setPopup(null)}>
          <button data-testid="popup-close" onClick={()=>setPopup(null)}>Close popup</button>
        </MobileSheet>}
      </MobileSheetPresence>
    </div>
  </MotionConfig>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
