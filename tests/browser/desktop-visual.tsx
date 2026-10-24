import { TranscriptServices } from "../../src/app/ui/TranscriptServices";
import { Radio } from "../../src/shared/ui/forms/Radio";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../src/shared/ui/forms/Select";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../../src/shared/ui/primitives/DropdownMenu";
// Offline real-component fixture. No live account, Host, provider or native RPC.
import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { MotionConfig } from "motion/react";
import { DesktopModeToggle, DesktopNavigation, DesktopNewSessionAction, DesktopTitlebarNavigation } from "../../src/app/shell/DesktopNavigation";
import { Sidebar } from "../../src/app/shell/Sidebar";
import { PresenceBoundary } from "../../src/shared/ui/PresenceBoundary";
import { AppViewDialog } from "../../src/features/workspace/ui/AppViewDialog";
import { SidebarMain } from "../../src/app/shell/SidebarMain";
import { WindowDragBar } from "../../src/app/shell/WindowChrome";
import { WindowMenuButton } from "../../src/app/shell/WindowMenuButton";
import { ActivityBar } from "../../src/app/shell/ActivityBar";
import { ProjectsPage } from "../../src/features/projects/ui/ProjectsPage";
import { PaneTree } from "../../src/features/workspace/ui/PaneTree";
import { TranscriptPool, TranscriptPoolOutlet } from "../../src/features/sessions/ui/TranscriptPool";
import { stashComposerAttachments } from "../../src/features/sessions/model/draftCache";
import { newSession, type Attachment, type Block, type Session } from "../../src/contracts/session";
import type { DesktopMode } from "../../src/app/model/desktopMode";
import type { SessionSummary } from "../../src/features/sessions/data/sessionStore";
import { SurfaceVisibilityContext } from "../../src/shared/ui/SurfaceVisibility";
import { createRoot } from "react-dom/client";
import { SettingsView } from "../../src/features/settings/ui/SettingsView";
import { Button } from "../../src/shared/ui/forms/Button";
import { IconButton } from "../../src/shared/ui/forms/IconButton";
import { Switch } from "../../src/shared/ui/forms/Switch";
import { Checkbox } from "../../src/shared/ui/forms/Checkbox";
import { Input } from "../../src/shared/ui/forms/Input";
import { Textarea } from "../../src/shared/ui/forms/Textarea";
import { Popover } from "../../src/shared/ui/Popover";
import { Modal } from "../../src/shared/ui/Modal";
import { SearchableSelect } from "../../src/shared/ui/SearchableSelect";
import { SurfaceAppearance } from "../../src/shared/ui/SurfaceAppearance";
import { AnimatedCollapse } from "../../src/shared/ui/AnimatedCollapse";
import { SettingsNav } from "../../src/app/shell/SettingsRail";
import { setUiLanguage } from "../../src/shared/i18n/language";
import { applyDesktopSkin } from "../../src/shared/theme/desktopSkin";
import { Check, Plus } from "../../src/shared/ui/icons";
import "../../src/styles/index.css";

const query = new URLSearchParams(location.search);
setUiLanguage(query.get("lang") === "zh-CN" ? "zh-CN" : "en");
document.documentElement.classList.toggle("theme-light", query.get("theme") !== "dark");
localStorage.setItem("omnicode.desktopColorScheme", query.get("theme") === "dark" ? "dark" : "light");
applyDesktopSkin();
if (query.has("large")) document.documentElement.style.setProperty("--font-scale", "1.25");
// Tauri callers that query settings receive deterministic offline responses.
Object.assign(window, { __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} }, __TAURI_INTERNALS__: {
  metadata: { currentWindow: { label: "fixture" }, currentWebview: { label: "fixture" } },
  invoke: async (command: string) => {
    if (command === "plugin:event|listen") return 0;
    if (command === "plugin:event|unlisten") return undefined;
    if (command === "session_checkpoint_status") return { files: [], undoLocked: false, workspaceShared: false };
    if (/git_branches/.test(command)) return { current: "main", detached: false, branches: [{ name: "main", current: true, remote: null }] };
    if (/git_diff_stats/.test(command)) return { additions: 12, deletions: 4, files: [] };
    if (command === "chat_folders_list") return ["/fixture/Documents/omnicode/2026-10-13/chat-090000-aaaaaa"];
    if (/notification_preferences/.test(command)) return {};
    if (command === "system_fonts") return { sans: [], mono: [] };
    if (/list|recents|accounts|sessions|notifications/.test(command)) return [];
    if (/version/.test(command)) return "0.0.0-fixture";
    if (/available|enabled|running/.test(command)) return false;
    throw new Error(`Offline fixture: ${command}`);
  },
  transformCallback: () => 0,
  unregisterCallback: () => {},
  convertFileSrc: (path: string) => path,
} });
const noop = () => {};
function Gallery() {
 const [checked, setChecked] = useState(false);
 const [menu, setMenu] = useState(false);
 const [modal, setModal] = useState(false);
 const [expanded, setExpanded] = useState(true);
 const [choice, setChoice] = useState("one");
 const anchor = useRef<HTMLButtonElement>(null);
 return <SurfaceAppearance.Provider value="settings"><div style={{ display: "flex", height: "100vh" }}>
  <SettingsNav section="appearance" onSelect={noop} />
  <main style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 32 }}>
   <h1 data-settings-title>桌面组件 / Desktop controls</h1>
   <section data-checkbox-fixture style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 24 }}>
    <label className="flex items-center gap-2"><input data-ui="checkbox" data-checkbox-native type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />Native checkbox</label>
    <form onSubmit={event => event.preventDefault()} className="flex items-center gap-2"><Checkbox name="gallery-checkbox" aria-label="Shared checkbox" checked={checked} onCheckedChange={value => setChecked(value === true)} /><span>Shared checkbox</span></form>
    <label className="flex items-center gap-2"><input data-ui="checkbox" data-checkbox-mixed type="checkbox" ref={node => { if (node) node.indeterminate = true; }} />Mixed</label>
    <label className="flex items-center gap-2"><input data-ui="checkbox" data-checkbox-disabled type="checkbox" checked disabled />Disabled</label>
    <label className="flex items-center gap-2"><span className="relative flex size-4 items-center justify-center"><input data-ui="checkbox" data-checkbox-custom type="checkbox" defaultChecked className="peer appearance-none" /><Check data-desktop-checkbox-mark aria-hidden="true" className="pointer-events-none absolute hidden peer-checked:block" /></span>Custom mark</label>
   </section>
   <p className="desktop-pane-description">Static source specifications · 长文本与字号检查</p>
   <section className="settings-card" style={{ marginTop: 24, borderStyle: "solid", borderColor: "var(--color-stroke)" }}>
    <div className="settings-row flex flex-wrap items-center"><span className="settings-row-label">Capsule</span>{(["xs", "sm", "md", "lg", "xl"] as const).map(size => <Button variant="secondary" key={size} size={size}>{size}</Button>)}<Button variant="secondary" disabled>Disabled</Button></div>
    <div data-button-palette className="settings-row flex flex-wrap items-center gap-2">
     <Button variant="secondary">Secondary</Button>
     <Button variant="primary">Primary</Button>
     <Button variant="ghost">Ghost</Button>
     <Button variant="danger">Danger</Button>
     <Button variant="danger" disabled>Disabled danger</Button>
    </div>
    <div className="settings-row flex items-center"><span className="settings-row-label">Icons</span>{(["xs", "sm", "md", "lg"] as const).map(size => <IconButton key={size} size={size} label={`Icon ${size}`}><Plus /></IconButton>)}</div>
    <div className="settings-row flex items-center"><label>开关 Switch</label><Switch aria-label="Switch" checked={checked} onCheckedChange={setChecked} /><Switch aria-label="Disabled switch" disabled /><Switch size="sm" aria-label="Small switch" /><Switch aria-label="Disabled checked switch" checked disabled /></div>
    <div className="settings-row flex flex-wrap items-center"><Input aria-label="Long text" defaultValue="长文本 / long text sample" /><Input aria-label="Invalid field" aria-invalid defaultValue="Invalid" /></div>
    <div className="settings-row flex flex-wrap items-center gap-4">
     <label><Radio name="controls-radio" defaultChecked /> Radio</label>
     <label><Radio name="controls-radio" data-size="lg" /> Large radio</label>
     <label><Radio disabled /> Disabled radio</label>
     <Checkbox data-size="lg" aria-label="Large checkbox" />
     <IconButton size="sm" variant="secondary" label="Secondary icon"><Plus /></IconButton>
     <IconButton variant="secondary" label="Default secondary icon"><Plus /></IconButton>
     <IconButton size="sm" label="Disabled icon" disabled><Plus /></IconButton>
    </div>
    <div className="settings-row flex flex-wrap items-center gap-4"><Input size="lg" aria-label="Large input" placeholder="Large input" /><Input disabled aria-label="Disabled input" placeholder="Disabled input" /><Textarea aria-label="Text area" placeholder="Text area" /><Textarea aria-label="Disabled text area" placeholder="Disabled text area" disabled /></div>
    <div className="settings-row flex items-center"><SearchableSelect label="Compact language" variant="pill" value={choice} options={[{value:"one",label:"简体中文"},{value:"two",label:"English"}]} onChange={setChoice} /><SearchableSelect label="Language" value={choice} options={[{value:"one",label:"简体中文"},{value:"two",label:"English — a long option label"}]} onChange={setChoice} /></div>
    <div className="settings-row flex items-center"><Button variant="secondary" ref={anchor} onClick={() => setMenu(v => !v)}>Menu</Button><Button variant="secondary" onClick={() => setModal(true)}>Dialog</Button><Button variant="secondary" onClick={() => setExpanded(v => !v)}>Disclosure</Button></div>
    <div className="settings-row flex items-center">
    <Select value={choice} onValueChange={setChoice}><SelectTrigger aria-label="Workflow select"><SelectValue /></SelectTrigger><SelectContent position="popper"><SelectItem value="one">First workflow</SelectItem><SelectItem value="two">Second workflow</SelectItem></SelectContent></Select>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="secondary">Workflow menu</Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>Run workflow</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
   </div>
   <AnimatedCollapse expanded={expanded} keepMounted><div style={{ padding: 16 }}>Retained content 保持挂载 <input aria-label="Retained input" defaultValue="Preserved" /></div></AnimatedCollapse>
   </section>
   <Popover open={menu} anchor={anchor} role="menu" onDismiss={() => setMenu(false)}><button role="menuitem" onClick={() => setMenu(false)}>Menu item</button></Popover>
   {modal && <Modal title="设置确认 / Confirmation" onClose={() => setModal(false)}><div className="settings-row">No source-defined dialog transition.</div></Modal>}
  </main>
 </div></SurfaceAppearance.Provider>;
}
const CHAT_CWD = "/fixture/Documents/omnicode/2026-10-13/chat-090000-aaaaaa";
const CODE_CWD = "/fixture/omnicode";
const attachment: Attachment = { id: "fixture-file", name: "layout-notes.md", mimeType: "text/markdown", kind: "file", size: 128, path: "/fixture/layout-notes.md" };
const transcript: Block[] = [
  { id: "prompt", role: "user", text: "Refine this workspace while preserving its conversations and tools." },
  { id: "inspection", role: "tool", text: "Inspect the current layout", tool: { kind: "shell", status: "completed", title: "Read workspace files", detail: "src/app/AppView.tsx\nsrc/features/sessions/ui/Composer.tsx" } },
  { id: "reply", role: "assistant", text: "A clear workspace leaves room for the work.\n\nThe conversation, project tools, and composer share a consistent rhythm, while the existing session state stays in place.\n\n```ts\nconst panelGap = 12;\nconst composerRadius = 14;\n```" },
];
function fixtureSession(mode: DesktopMode, state: string): Session {
  const base = { ...newSession("claude", mode === "chat" ? CHAT_CWD : CODE_CWD, "claude-sonnet"), id: `fixture-${mode}`, title: mode === "chat" ? "Room for a new idea" : "Workspace refinement", context: { used: 33000, window: 100000 } };
  if (state === "empty") return base;
  const blocks = transcript.map(block => ({ ...block }));
  if (state === "attachments") blocks[0].attachments = [attachment];
  if (state === "running") { blocks[2].streaming = true; blocks[2].text = "I’m reviewing the layout and keeping the existing controls available."; }
  if (state === "approval") return { ...base, busy: true, blocks: [blocks[0], { id: "approval-tool", role: "tool", text: "npm test -- --run src/features/workspace/ui/PaneTreeSurfaces.test.ts", tool: { kind: "shell", status: "pending", title: "Run workspace checks" }, approval: { requestId: 9 } }] };
  return { ...base, blocks, busy: state === "running", pendingQuestion: state === "question" ? { requestId: 7, questions: [{ id: "workspace", prompt: "Which workspace should we refine first?", header: "Workspace", options: [{ id: "conversation", label: "Conversation", description: "Focus on reading and composing." }, { id: "code", label: "Code", description: "Focus on project tools and panels." }], multiSelect: false, allowCustom: true }] } : undefined };
}

/** Actual desktop components, deterministic data and inert native/provider IO. */
function DesktopWorkspaceFixture() {
  const [mode, setMode] = useState<DesktopMode>(query.get("mode") === "code" ? "code" : "chat");
  const [state, setState] = useState(query.get("state") ?? "empty");
  const [sidebar, setSidebar] = useState(true);
  const [composerFocused, setComposerFocused] = useState(false);
  const [page, setPage] = useState(query.get("view") === "projects" ? "projects" : "workspace");
  const [sessions, setSessions] = useState(() => ({ chat: fixtureSession("chat", query.get("state") ?? "empty"), code: fixtureSession("code", query.get("state") ?? "empty") }));
  const [pool] = useState(() => new TranscriptPool());
  const interactions = useRef<{ kind: "approval" | "question" | "submit" | "stop"; sessionId: string; requestId?: number; value: unknown }[]>([]);
  const recents = [{ path: CODE_CWD, openedAt: 1791891000000 }, { path: "/fixture/layout-lab", openedAt: 1791890000000 }];
  useLayoutEffect(() => { document.documentElement.dataset.desktopMode = mode; }, [mode]);
  useEffect(() => {
    Object.assign(window, { desktopFixture: {
      setMode, setSidebar,
      setState: (next: string) => { setState(next); setSessions(current => ({ ...current, [mode]: fixtureSession(mode, next) })); },
      setPage,
      interactions: interactions.current,
      getSession: () => sessions[mode],
      setBlocks: (blocks: Block[]) => setSessions(current => ({ ...current, [mode]: { ...current[mode], blocks } })),
    } });
  }, [mode, sessions]);
  const active = sessions[mode];
  const summary = (session: Session): SessionSummary => ({ id: session.id, cwd: session.cwd, harness: session.harness, model: session.model, runtimeMode: session.runtimeMode, title: session.title, createdAt: 1791891000000, updatedAt: 1791891000000 });
  const summaries = [summary(active), { ...summary(active), id: "fixture-history", title: "A quieter workspace", pinned: true }, { ...summary(active), id: "fixture-older", title: "Review the project structure", harness: "codex" as const }];
  const activity = { cwd: active.cwd, recents, onSearch: noop, onOpenInbox: noop, onOpenNotes: noop, onOpenAutomations: noop, onOpenWorkflows: noop, onOpenSettings: noop, notesEnabled: true };
  const paneHandlers = {
    onFocus: () => setComposerFocused(true), onClose: noop, onCwdChange: noop, onBranchChange: noop,
    onWorkspaceModeChange: ((sessionId, workspaceMode, worktreeBase) => setSessions(current => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, value.id === sessionId ? { ...value, workspaceMode, worktreeBase } : value])) as typeof current)) as ComponentProps<typeof PaneTree>["onWorkspaceModeChange"],
    onWorktreeBaseChange: ((sessionId, worktreeBase) => setSessions(current => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, value.id === sessionId ? { ...value, worktreeBase } : value])) as typeof current)) as ComponentProps<typeof PaneTree>["onWorktreeBaseChange"],
    onWorktreeChange: async () => {}, onModelChange: noop,
    onModelSettingsChange: noop, onRuntimeModeChange: noop, onSaveDraft: noop,
    onRemoveDraft: noop, onDeleteQueuedMessage: noop, onEditQueuedMessage: noop,
    onQueuedMessageEditingChange: noop, onSteerQueuedMessage: noop, onResumeQueue: noop,
    onUsageLimitResume: noop, onUsageLimitResumeAtReset: noop, onUsageLimitDismiss: noop,
    onOpenFile: noop, onOpenSessionFile: noop, onOpenDiff: noop, onOpenPlan: noop,
    onUpdatePlan: noop, onBuildPlan: noop, onMovePane: noop, onNewTerminal: noop,
    onSelectFile: noop, onCloseFile: noop, onCloseOtherFiles: noop, onReorderFiles: noop,
    onFileDirtyChange: noop, onFileErrorCountChange: noop, onRatio: noop,
  };
  const onApproval: ComponentProps<typeof PaneTree>["onApproval"] = (sessionId, requestId, decision) => {
    interactions.current.push({ kind: "approval", sessionId, requestId, value: decision });
    setSessions(current => ({ ...current, [mode]: { ...current[mode], busy: false, blocks: current[mode].blocks.map(block => block.approval?.requestId === requestId ? { ...block, approval: { ...block.approval, decided: decision }, tool: { ...block.tool, status: decision === "allow" ? "completed" : "failed" } } : block) } }));
  };
  const onQuestionReply: ComponentProps<typeof PaneTree>["onQuestionReply"] = (sessionId, requestId, reply) => {
    interactions.current.push({ kind: "question", sessionId, requestId, value: reply });
    setSessions(current => ({ ...current, [mode]: { ...current[mode], pendingQuestion: undefined } }));
  };
  const submit = (sessionId: string, text: string, attachments: Attachment[]) => {
    interactions.current.push({ kind: "submit", sessionId, value: { text, attachments } });
    setSessions(current => ({ ...current, [mode]: { ...current[mode], blocks: [...current[mode].blocks, { id: `sent-${Date.now()}`, role: "user", text, attachments }], busy: true } }));
    return Boolean(sessionId);
  };
  const stop = (sessionId: string) => {
    interactions.current.push({ kind: "stop", sessionId, value: "idle" });
    setSessions(current => ({ ...current, [mode]: { ...current[mode], busy: false, blocks: current[mode].blocks.map(block => ({ ...block, streaming: false })) } }));
  };
  const newConversation = () => { setPage("workspace"); setState("empty"); setSessions(current => ({ ...current, [mode]: fixtureSession(mode, "empty") })); };
  const titlebar = <DesktopTitlebarNavigation menu={<WindowMenuButton handlers={{ "Tab: New": newConversation }} dispatch={id => { if (id !== "Tab: New") return false; newConversation(); return true; }} />} modeToggle={<DesktopModeToggle mode={mode} onChange={setMode} />} canGoBack onGoBack={noop} panelActive={sidebar} onTogglePanel={() => setSidebar(value => !value)} />;
  return <MotionConfig reducedMotion="user"><div className="app-shell-root desktop-workspace" data-desktop-mode={mode} data-fixture-state={state} style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    <div data-window-chrome className="relative shrink-0" style={{ zIndex: 95 }}>
      <WindowDragBar windowNavigation={titlebar} />
    </div>
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <Sidebar desktopMode={mode} open={sidebar} cwd={active.cwd} recents={recents} sessions={summaries} projectHistory={summaries} loadedProjectPaths={new Set([CODE_CWD, active.cwd])} busySessionIds={new Set(active.busy ? [active.id] : [])} approvalSessionIds={new Set(active.blocks.some(block => block.approval && !block.approval.decided) ? [active.id] : [])} questionSessionIds={new Set(active.pendingQuestion ? [active.id] : [])} activeSessionId={active.id} visibleSessionId={page === "workspace" ? active.id : null} pending={false} status="idle" tab="sessions" onTabChange={noop} filesSearchOpen={false} onFilesSearchOpenChange={noop} onOpenFile={noop} onSelectSession={() => { setPage("workspace"); setState("conversation"); setSessions(current => ({ ...current, [mode]: fixtureSession(mode, "conversation") })); }} onNew={newConversation} onNewChat={newConversation} onOpenProject={noop} onSelectProject={noop} onToggleSidebar={() => setSidebar(value => !value)} chromeInMenuBar navigation={{ primary: <DesktopNewSessionAction mode={mode} onNew={newConversation} />, scrollable: <DesktopNavigation onProjects={() => setPage("projects")} projectsActive={page === "projects"} onBots={noop} botsActive={false} activity={activity} /> }} footer={<ActivityBar layout="sidebar-footer" {...activity} />} />
      <SidebarMain open={sidebar}><main className="desktop-workspace" style={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0 }}>
        <div hidden={page !== "projects"} style={{ display: page === "projects" ? "flex" : "none", minWidth: 0, flex: 1 }}><ProjectsPage mode={mode} cwd={active.cwd} recents={recents} onSelect={noop} onOpen={noop} onNewChat={newConversation} onArchive={noop} onRestore={noop} /></div>
        {(["chat", "code"] as const).map(value => {
          const session = sessions[value];
          const second = { ...session, id: `${session.id}-second`, title: "Implementation notes", blocks: [{ id: "second-reply", role: "assistant" as const, text: "This second pane keeps its own draft when the layout changes." }] };
          const split = value === "code" && state === "split";
          const visible = mode === value && page === "workspace";
          const props: ComponentProps<typeof PaneTree> = { ...paneHandlers, visible, layout: split ? { type: "split", id: "fixture-split", dir: "right", children: [{ type: "leaf", id: session.id }, { type: "leaf", id: second.id }], sizes: [0.6, 0.4] } : { type: "leaf", id: session.id }, sessions: split ? [session, second] : [session], editorPanes: [], dirtyFileIds: new Set(), fileErrorCounts: new Map(), focusedId: session.id, surfaceMode: "split", composerFocused: visible && composerFocused, recents, transcriptPool: pool, hideProjectPicker: false, onApproval, onQuestionReply, onSubmit: submit, onStop: stop, onCompactContext: () => true };
          return <div key={value} hidden={!visible} aria-hidden={!visible} inert={!visible || undefined} data-fixture-main-card className="pane-card" style={{ display: visible ? "flex" : "none", minWidth: 0, minHeight: 0, flex: 1 }}><SurfaceVisibilityContext.Provider value={visible}><PaneTree {...props} /></SurfaceVisibilityContext.Provider></div>;
        })}
      </main></SidebarMain>
    </div>
    <TranscriptPoolOutlet pool={pool} />
  </div></MotionConfig>;
}

if (query.get("page") === "workspace") {
  document.documentElement.dataset.desktopMode = query.get("mode") === "code" ? "code" : "chat";
  if (query.get("state") === "attachments") {
    stashComposerAttachments("fixture-chat", [attachment], new Set());
    stashComposerAttachments("fixture-code", [attachment], new Set());
  }
}
createRoot(document.getElementById("root")!).render(<TranscriptServices>{query.get("page") === "workspace" ? <DesktopWorkspaceFixture /> : query.get("page") === "settings"
 ? <PresenceBoundary><AppViewDialog title="Settings" onClose={noop}><SettingsView section={(query.get("section") ?? "appearance") as never} cwd="" sessions={[]} onClose={noop} onOpenSession={noop} onArchiveSession={noop} onDeleteSession={noop} onOpenWhatsNew={noop} /></AppViewDialog></PresenceBoundary>
 : <Gallery />}</TranscriptServices>);
