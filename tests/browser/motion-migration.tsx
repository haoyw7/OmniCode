// Real components driven by deterministic local data; no provider or host calls.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, MotionConfig } from "motion/react";
import { defaultTransition } from "../../src/shared/motion/tokens";
import { SidebarTransition, SidebarRail } from "../../src/app/shell/SidebarTransition";
import { SurfaceTabs } from "../../src/features/workspace/ui/SurfaceTabs";
import { newFileTab } from "../../src/features/workspace/model/layout";
import { AgentTranscript } from "../../src/features/sessions/ui/AgentTranscript";
import { Composer } from "../../src/features/sessions/ui/Composer";
import { AnimatedCollapse } from "../../src/shared/ui/AnimatedCollapse";
import { Modal } from "../../src/shared/ui/Modal";
import type { Block } from "../../src/features/sessions/model/session";
import { applyDesktopSkin } from "../../src/shared/theme/desktopSkin";
import { setUiLanguage } from "../../src/shared/i18n/language";
import "../../src/styles/index.css";
setUiLanguage("en");
localStorage.setItem("monocode.desktopColorScheme", "light");
applyDesktopSkin();
Object.assign(window, { __TAURI_INTERNALS__: {
 metadata: { currentWindow: { label: "fixture" }, currentWebview: { label: "fixture" } },
 invoke: async (command: string) => /list|recents|models|skills|sessions|accounts/.test(command) ? [] : {},
 transformCallback: () => 0, unregisterCallback: () => {}, convertFileSrc: (path: string) => path,
} });
const noop = () => {};
function Fixture() {
 const [sidebar, setSidebar] = useState(true);
 const [files, setFiles] = useState(() => [newFileTab("/fixture/Conversation.md", "/fixture"),newFileTab("/fixture/tokens.ts", "/fixture")]);
 const [activeFile, setActiveFile] = useState(files[0].id);
 const [fold, setFold] = useState(true);
 const [transcriptVisible, setTranscriptVisible] = useState(true);
 const [modal, setModal] = useState(false);
 const [blocks, setBlocks] = useState<Block[]>([{id:"user",role:"user",text:"Inspect the animation migration and preserve business logic."},{id:"tool",role:"tool",text:"Run npm run dev",tool:{kind:"shell",status:"failed",detail:"Error: local fixture diagnostic\n    at MotionMigration.fixture"}},{id:"reply",role:"assistant",text:"Ready to inspect."}]);
 useEffect(() => { Object.assign(window, { motionBlocks: setBlocks, motionTranscriptVisible: setTranscriptVisible, motionStream: (text: string, streaming: boolean) => setBlocks(previous => [...previous.filter(block=>block.id!=="reply"),{id:"reply",role:"assistant",text,streaming}]) }); }, []);
 return <MotionConfig reducedMotion="user" transition={defaultTransition}><div style={{height:"100vh",display:"flex",fontSize:14}}>
  <SidebarRail open={!sidebar}><button onClick={()=>setSidebar(true)}>Open sidebar</button></SidebarRail>
  <SidebarTransition open={sidebar} width={280} dragging={false} setPaneRef={noop} finishDrag={noop}><aside style={{width:280,padding:20,height:"100%",background:"var(--color-card)"}}><h2>MonoCode</h2><p>Motion migration</p><button onClick={()=>setSidebar(false)}>Close sidebar</button><p>Project / monocode</p><p>Animation migration</p></aside></SidebarTransition>
  <main style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",padding:24,gap:16}}>
   <div style={{display:"flex",gap:16,alignItems:"center"}}><button onClick={()=>setFold(v=>!v)}>Toggle tool card</button><button onClick={()=>setModal(true)}>Open modal</button></div>
   <SurfaceTabs files={files} activeFileId={activeFile} dirtyFileIds={new Set()} fileErrorCounts={new Map()} onSelectFile={setActiveFile} onCloseFile={id=>setFiles(current=>current.filter(file=>file.id!==id))} onCloseOtherFiles={id=>setFiles(current=>current.filter(file=>file.id===id))} onReorder={ids=>setFiles(current=>ids.map(id=>current.find(file=>file.id===id)!))}/>
   <div style={{display:"flex",flexDirection:"column",flex:1,minHeight:0,border:"1px solid var(--color-stroke)",borderRadius:12,padding:16}}>
    <AgentTranscript blocks={blocks} busy={blocks.at(-1)?.streaming} visible={transcriptVisible} />
    <AnimatedCollapse expanded={fold} keepMounted><section style={{padding:16,background:"var(--color-surface)",borderRadius:8}}><strong>Tool result · src/shared/motion/tokens.ts</strong><pre>Motion token fixture. Retained input state.</pre><input aria-label="Tool retained state" defaultValue="Retained tool state"/></section></AnimatedCollapse>
   </div>
   <Composer focused={false} harness="codex" model="gpt-6" runtimeMode="supervised" executionCwd="/fixture" remoteSession remoteFeatures={{attachments:false,plan:false,draft:false}} hideTopBar hideProjectPicker hideBranchPicker onFocus={noop} onCwdChange={noop} onModelChange={noop} onRuntimeModeChange={noop} onSubmit={noop}/>
  </main>
  <AnimatePresence>{modal&&<Modal onClose={()=>setModal(false)} title="Motion dialog"><p>Closing keeps the panel until its exit completes.</p></Modal>}</AnimatePresence>
 </div></MotionConfig>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
