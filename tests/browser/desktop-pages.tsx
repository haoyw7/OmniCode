// Offline fixtures render production pages and their actual desktop shell.
// Native and workflow services below own only synthetic, in-memory test data.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { Sidebar } from "../../src/app/shell/Sidebar";
import { SidebarRail } from "../../src/app/shell/SidebarTransition";
import { SidebarMain } from "../../src/app/shell/SidebarMain";
import { WindowDragBar } from "../../src/app/shell/WindowChrome";
import { WindowMenuButton } from "../../src/app/shell/WindowMenuButton";
import { ActivityBar } from "../../src/app/shell/ActivityBar";
import { DesktopModeToggle, DesktopNavigation, DesktopNewSessionAction, DesktopTitlebarNavigation } from "../../src/app/shell/DesktopNavigation";
import { AutomationsView } from "../../src/features/automations/ui/AutomationsView";
import { createAutomationTrigger, newAutomationDraft, type Automation, type AutomationRun } from "../../src/features/automations/model/automations";
import { NotesView } from "../../src/features/notes/ui/NotesView";
import type { Note } from "../../src/features/notes/notes";
import { InboxView } from "../../src/features/inbox/ui/InboxView";
import type { GithubWorkItem, GithubWorkItemDetails, GithubWorkItemThread } from "../../src/features/inbox/model/githubTasks";
import { WorkflowsView } from "../../src/features/workflows/ui/WorkflowsView";
import { WorkflowAppContext } from "../../src/features/workflows/ui/workflowAppContext";
import { WorkflowProjectsContext } from "../../src/features/workflows/kit/store/TabStoreProvider";
import { omnicodeAgentService, type IOmniCodeAgentService } from "../../src/features/workflows/kit/_shims/services";
import type { OmniCodeSavedWorkflowRun } from "../../src/features/workflows/kit/_shims/shared";
import { initTypography } from "../../src/features/settings/model/typography";
import { setUiLanguage } from "../../src/shared/i18n/language";
import { applyDesktopSkin } from "../../src/shared/theme/desktopSkin";
import { SurfaceVisibilityContext } from "../../src/shared/ui/SurfaceVisibility";
import { SearchView } from "../../src/features/search/ui/SearchView";
import { newSession } from "../../src/features/sessions/model/session";
import "../../src/styles/index.css";

type Page = "workflows" | "automations" | "notes" | "inbox" | "search";
const query = new URLSearchParams(location.search);
const initialPage = (["workflows", "automations", "notes", "inbox", "search"].includes(query.get("page") ?? "") ? query.get("page") : "workflows") as Page;
const cwd = "/fixture/omnicode";
const now = Date.UTC(2026, 9, 12, 12);
const noop = () => {};
const rpcCalls: string[] = [];
const unhandledCommands: string[] = [];
const actions: string[] = [];
const recents = [{ path: cwd, openedAt: now }, { path: "/fixture/layout-lab", openedAt: now - 1000 }];
const summary = { id: "fixture-session", title: "Refine the desktop workspace", harness: "claude" as const, model: "claude-sonnet", runtimeMode: "full-access" as const, cwd, createdAt: now, updatedAt: now };
const searchSession = { ...newSession("claude", cwd, "claude-sonnet"), id: "fixture-search-session", title: "claude · Desktop layout review", blocks: [{ id: "search-user", role: "user" as const, text: "Review the desktop layout and preserve the unsent draft." }, { id: "search-reply", role: "assistant" as const, text: "The layout uses a 288px sidebar and shared keyboard navigation." }] };

setUiLanguage(query.get("lang") === "zh-CN" ? "zh-CN" : "en");
document.documentElement.classList.toggle("theme-light", query.get("theme") !== "dark");
document.documentElement.dataset.desktopMode = "code";
applyDesktopSkin();
initTypography();

let notes: Note[] = [
  { id: "note-layout", slug: "desktop-layout", title: "Desktop layout notes", body: "# A quieter workspace\n\nKeep navigation visible and preserve the active conversation.\n\n- Sidebar: **288px**\n- Header: **44px**\n- Use shared disclosure motion.\n\n```ts\nconst panelGap = 12;\n```\n\n中文备注：保留草稿、终端与键盘导航。", tags: ["desktop", "design"], sourceCwd: cwd, slugPending: false, createdAt: now - 86400000, updatedAt: now },
  { id: "note-checklist", slug: "verification", title: "Verification checklist", body: "Check light and dark themes, long text, reduced motion, and local preferences.", tags: ["qa"], sourceCwd: "/fixture/layout-lab", slugPending: false, createdAt: now - 86400000, updatedAt: now - 10000 },
];
let automations: Automation[] = [
  { ...newAutomationDraft(cwd, "claude", "claude-sonnet"), id: "automation-review", name: "Daily workspace review", prompt: "Review recent changes, identify meaningful regressions, and write a concise summary.\n检查布局、草稿保留和键盘操作。", triggers: [{ ...createAutomationTrigger("time", "weekdays"), scheduleKind: "weekdays", time: "09:00" }], enabled: true, nextRunAt: now + 3600000, lastRunAt: now - 3600000, lastRunStatus: "succeeded", createdAt: now - 86400000, updatedAt: now },
  { ...newAutomationDraft("/fixture/layout-lab", "codex", "default"), id: "automation-tests", name: "Focused regression checks", prompt: "Run the focused tests for modified behavior and report actual results.", enabled: false, nextRunAt: 0, lastRunAt: now - 7200000, lastRunStatus: "failed", lastRunError: "Synthetic validation failure", createdAt: now - 86400000, updatedAt: now - 1000 },
];
const runs: AutomationRun[] = [
  { id: "run-success", automationId: "automation-review", trigger: "scheduled", scheduledFor: now - 3600000, createdAt: now - 3600000, startedAt: now - 3600000, completedAt: now - 3540000, status: "succeeded", sessionId: summary.id },
  { id: "run-failure", automationId: "automation-tests", trigger: "manual", scheduledFor: now - 7200000, createdAt: now - 7200000, startedAt: now - 7200000, completedAt: now - 7180000, status: "failed", error: "Synthetic validation failure" },
];
const items: GithubWorkItem[] = [
  { kind: "issue", number: 157, title: "Preserve drafts when switching desktop modes", url: "https://example.invalid/issues/157", state: "open", createdAt: new Date(now - 86400000).toISOString(), updatedAt: new Date(now).toISOString(), labels: [{ name: "desktop", color: "c96442" }, { name: "regression", color: "2563eb" }], assignees: [{ login: "fixture-reviewer", avatarUrl: "/omnicode.svg" }], draft: false, repo: "fixture/omnicode" },
  { kind: "pr", number: 158, title: "Align navigation, composer and shared controls", url: "https://example.invalid/pull/158", state: "open", createdAt: new Date(now - 86400000).toISOString(), updatedAt: new Date(now - 1000).toISOString(), labels: [{ name: "ui", color: "826cff" }], assignees: [], draft: false, repo: "fixture/omnicode" },
  { kind: "issue", number: 159, title: "验证中文标题与窄窗口下的详情面板", url: "https://example.invalid/issues/159", state: "open", updatedAt: new Date(now - 2000).toISOString(), labels: [], assignees: [], draft: false, repo: "fixture/omnicode" },
];
const details: GithubWorkItemDetails = { body: "## Workspace behavior\n\nSwitching between Chat and Code should preserve the current draft, file focus and running terminal.\n\n- Check keyboard navigation\n- Verify light and dark themes\n- Keep project actions available\n\n中文说明：本页面使用离线合成数据。", author: "fixture-reviewer", authorAvatarUrl: "/omnicode.svg", baseRefName: "main", headRefName: "desktop-layout", reviewDecision: "REVIEW_REQUIRED" };
const thread: GithubWorkItemThread = { comments: [{ id: "comment-1", kind: "issue", author: "fixture-reviewer", authorAvatarUrl: "/omnicode.svg", body: "The focused navigation checks passed. Please keep the existing workflow controls available.", createdAt: new Date(now).toISOString(), url: "https://example.invalid/comment/1", state: "", path: "", line: null, resolved: false, threadId: "", replies: [] }], commits: [], truncated: false, reviewDecision: "REVIEW_REQUIRED", baseRefName: "main", headRefName: "desktop-layout" };

Object.assign(window, { __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: noop }, __TAURI_INTERNALS__: {
  metadata: { currentWindow: { label: "fixture" }, currentWebview: { label: "fixture" } },
  transformCallback: () => 0, unregisterCallback: noop, convertFileSrc: (path: string) => path,
  invoke: async (command: string, params: Record<string, any> = {}) => {
    rpcCalls.push(command);
    if (command.startsWith("plugin:event|") || command === "plugin:webview|set_webview_focus") return 0;
    if (command === "plugin:window|is_maximized") return false;
    if (command === "notes_list") return notes;
    if (command === "notes_get") return notes.find(note => note.id === params.id) ?? null;
    if (command === "notes_upsert") { const prior = notes.find(note => note.id === params.note.id); const saved = { ...prior, slug: "fixture-note", slugPending: false, createdAt: now, ...params.note, updatedAt: now }; notes = [saved, ...notes.filter(note => note.id !== saved.id)]; return saved; }
    if (command === "notes_delete") { notes = notes.filter(note => note.id !== params.id); return; }
    if (command === "list_project_files") return [{ path: `${cwd}/src/app/AppView.tsx`, relative: "src/app/AppView.tsx", name: "AppView.tsx" }, { path: `${cwd}/docs/layout.md`, relative: "docs/layout.md", name: "layout.md" }];
    if (command === "session_search") return { hits: [], truncated: false };
    if (command === "search_project") return { matches: [{ path: `${cwd}/src/app/AppView.tsx`, relative: "src/app/AppView.tsx", line: 42, column: 1, preview: "const layout = measuredDesktopLayout();" }], truncated: false };
    if (["cancel_project_search", "cancel_session_search"].includes(command)) return;
    if (command === "automations_list") return automations;
    if (command === "automation_runs_list") return runs.filter(run => run.automationId === params.automationId);
    if (command === "automations_upsert") { const saved = { ...params.automation, createdAt: now, updatedAt: now }; automations = automations.map(item => item.id === saved.id ? saved : item); return saved; }
    if (command === "git_github_status") return { connected: true, installed: true, authenticated: true };
    if (["linear_status", "jira_status", "gitlab_status", "azure_devops_status"].includes(command)) return { connected: false };
    if (command === "git_github_repo") return "fixture/omnicode";
    if (command === "git_github_repositories") return ["fixture/omnicode"];
    if (command === "git_github_work_items") return items.filter(item => item.kind === params.kind);
    if (command === "git_github_work_item") return items.find(item => item.number === params.number) ?? items[0];
    if (command === "git_github_work_item_details") return details;
    if (command === "git_github_work_item_thread") return thread;
    if (command === "git_github_pr_diff") return { additions: 12, deletions: 4, files: [{ path: "src/app/AppView.tsx", additions: 12, deletions: 4 }], patch: "diff --git a/src/app/AppView.tsx b/src/app/AppView.tsx\n--- a/src/app/AppView.tsx\n+++ b/src/app/AppView.tsx\n@@ -1 +1 @@\n-oldLayout();\n+measuredLayout();\n", truncated: false };
    if (command === "git_github_pr_checks") return { headOid: "1234567890abcdef", checks: [{ name: "Focused UI checks", workflow: "Tests", state: "pass", url: null, startedAt: new Date(now - 60000).toISOString(), completedAt: new Date(now).toISOString() }] };
    if (command === "git_branches") return { current: "main", detached: false, branches: [{ name: "main", current: true, remote: null }] };
    if (command === "git_diff_stats") return { additions: 12, deletions: 4, files: [] };
    if (["list_external_editors", "remote_machines", "chat_folders_list", "list_skills", "session_list", "session_list_project", "git_worktrees"].includes(command)) return [];
    if (command === "system_fonts") return { sans: [], mono: [] };
    if (command === "notification_preferences_get") return {};
    unhandledCommands.push(command);
    throw new Error(`Offline fixture does not implement ${command}`);
  },
} });

const workflowRuns: OmniCodeSavedWorkflowRun[] = [{ runId: "workflow-run-review", name: "review-layout", status: "completed", createdAt: now - 60000, updatedAt: now, spentTokens: 4200, parentSessionId: summary.id, cwd, args: { focus: "desktop" }, artifacts: [{ id: "report", kind: "markdown", title: "Layout review", version: 1, contentType: "text/markdown" }] }];
const workflowService: IOmniCodeAgentService = {
  listSavedWorkflows: async target => ({ workflows: [{ name: target.scope === "global" ? "summarize-changes" : "review-layout", description: target.scope === "global" ? "Summarize recent changes with focused evidence and follow-up actions." : "Review desktop layout, draft retention, keyboard navigation, and long multilingual text.", whenToUse: "Before handing off a desktop UI change.", args: { focus: { type: "string", description: "Area to inspect", default: "desktop" }, strict: { type: "boolean", default: true } }, scope: target.scope === "global" ? "global" : "project", path: `${target.workspacePath ?? "/fixture/home"}/.omnicode/workflows/review-layout.dwf.ts` }], invalid: [], dir: `${target.workspacePath ?? "/fixture/home"}/.omnicode/workflows` }),
  listSavedWorkflowRuns: async params => ({ runs: params.scope === "global" ? [] : workflowRuns }),
  getSavedWorkflow: async params => ({ ok: true, name: params.name, path: `${cwd}/.omnicode/workflows/${params.name}.dwf.ts`, scope: params.scope === "global" ? "global" : "project", meta: { description: "Review the desktop workspace and record focused evidence.", whenToUse: "Before handing off a UI change.", args: { focus: { type: "string", default: "desktop" } } }, script: "export default async function review(ctx) {\n  return ctx.agent({ prompt: 'Review the desktop layout' });\n}\n" }),
  updateSavedWorkflowMeta: async () => ({ ok: true, path: `${cwd}/.omnicode/workflows/review-layout.dwf.ts` }),
  deleteSavedWorkflow: async () => ({ ok: true, path: `${cwd}/.omnicode/workflows/review-layout.dwf.ts` }),
  moveSavedWorkflow: async () => ({ ok: true, from: "/fixture/home/review-layout.dwf.ts", to: `${cwd}/.omnicode/workflows/review-layout.dwf.ts` }),
};
Object.assign(omnicodeAgentService, workflowService);
Object.assign(window, { desktopPagesFixture: { rpcCalls, unhandledCommands, actions } });

function FeaturePagesFixture() {
  const [page, setPage] = useState<Page>(initialPage);
  const [sidebar, setSidebar] = useState(!query.has("collapsed"));
  const activity = { cwd, recents, onSearch: () => setPage("search"), onOpenInbox: () => setPage("inbox"), onOpenNotes: () => setPage("notes"), onOpenAutomations: () => setPage("automations"), onOpenWorkflows: () => setPage("workflows"), onOpenSettings: noop, notesEnabled: true, searchActive: page === "search", inboxActive: page === "inbox", notesActive: page === "notes", automationsActive: page === "automations", workflowsActive: page === "workflows" };
  const content = page === "workflows" ? <WorkflowsView cwd={cwd} />
    : page === "automations" ? <AutomationsView active cwd={cwd} recents={recents} onClose={noop} onLaunch={() => { actions.push("automation.launch"); }} onOpenSession={() => { actions.push("session.open"); }} />
    : page === "notes" ? <NotesView active cwd={cwd} recents={recents} onClose={noop} />
    : page === "search" ? <SearchView open cwd={cwd} recents={recents} history={[{ ...summary, id: searchSession.id, title: searchSession.title }]} sessions={[searchSession]} onClose={noop} onOpenFile={() => { actions.push("search.file"); }} onOpenSession={() => { actions.push("search.session"); }} onOpenProject={() => { actions.push("search.project"); }} />
    : <InboxView active cwd={cwd} recents={recents} onClose={noop} onAsk={async () => "fixture-ask"} onAskRestart={async () => "fixture-ask"} onAskMount={noop} onStart={() => { actions.push("inbox.start"); }} onOpenIntegrations={noop} sessions={[summary]} onOpenSession={() => { actions.push("session.open"); }} />;
  const titlebar = <DesktopTitlebarNavigation menu={<WindowMenuButton handlers={{ "Tab: New": noop }} dispatch={() => true} />} modeToggle={<DesktopModeToggle mode="code" onChange={noop} />} canGoBack onGoBack={noop} panelActive={sidebar} onTogglePanel={() => setSidebar(value => !value)} />;
  return <MotionConfig reducedMotion="user"><WorkflowProjectsContext.Provider value={recents.map(project => ({ workspacePath: project.path, label: project.path.split("/").pop()! }))}><WorkflowAppContext.Provider value={{ openRun: noop, openAgent: noop, openSession: () => { actions.push("workflow.open"); }, createViaChat: () => { actions.push("workflow.create"); } }}><SurfaceVisibilityContext.Provider value={true}>
    <div className="app-shell-root desktop-workspace" data-desktop-mode="code" data-fixture-page={page} style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <WindowDragBar windowNavigation={titlebar} />
      <div className="flex min-h-0 min-w-0 flex-1">
      <SidebarRail open={!sidebar}><ActivityBar layout="rail" chromeInMenuBar {...activity} /></SidebarRail>
      <Sidebar desktopMode="code" open={sidebar} cwd={cwd} recents={recents} sessions={[summary]} projectHistory={[summary]} loadedProjectPaths={new Set([cwd])} busySessionIds={new Set()} approvalSessionIds={new Set()} activeSessionId={summary.id} visibleSessionId={null} pending={false} status="idle" tab="sessions" onTabChange={noop} filesSearchOpen={false} onFilesSearchOpenChange={noop} onOpenFile={noop} onSelectSession={noop} onNew={noop} onNewChat={noop} onOpenProject={noop} onSelectProject={noop} onToggleSidebar={() => setSidebar(value => !value)} chromeInMenuBar navigation={{ primary: <DesktopNewSessionAction mode="code" onNew={noop} />, scrollable: <DesktopNavigation onProjects={noop} projectsActive={false} onBots={noop} botsActive={false} activity={activity} /> }} footer={<ActivityBar layout="sidebar-footer" {...activity} />} />
      <SidebarMain open={sidebar}><main data-fixture-page-content className="flex min-h-0 min-w-0 flex-1 overflow-hidden">{content}</main></SidebarMain>
      </div>
    </div>
  </SurfaceVisibilityContext.Provider></WorkflowAppContext.Provider></WorkflowProjectsContext.Provider></MotionConfig>;
}
createRoot(document.getElementById("root")!).render(<FeaturePagesFixture />);
