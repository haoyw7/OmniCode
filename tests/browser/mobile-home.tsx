import { setUiLanguage } from "../../src/shared/i18n/language";
import { IconButton } from "../../src/shared/ui/forms/IconButton";
// Real list components with local data; no paired Host or provider required.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { HostProject, HostSessionSummary } from "../../src/features/connections/model/protocol";
import { formatSessionTitle } from "../../src/features/sessions/model/session";
import { MobileHome } from "../../src/mobile/MobileHome";
import { applyMobileSkin, isMobileSkin } from "../../src/mobile/theme/skin";
import { PanelLeft, Search } from "../../src/shared/ui/icons";
import "../../src/mobile/theme/index.css";
import "../../src/mobile/styles/index.css";
import "../../src/mobile/motion.css";

const skin = new URLSearchParams(location.search).get("skin");
setUiLanguage("zh-CN");
applyMobileSkin(isMobileSkin(skin) ? skin : "daylight", "light");
const now = Date.UTC(2026, 9, 13, 10);
const projects: HostProject[] = [
  { id: "app", name: "Monocode", cwd: "/workspace/monocode" },
  { id: "research", name: "设计研究与移动端体验", cwd: "/workspace/research" },
];
const sessions: HostSessionSummary[] = [
  { id: "one", projectId: "app", title: formatSessionTitle("codex", "优化移动端的设置与导航"), harness: "codex", status: "running", revision: 1, updatedAt: now },
  { id: "two", projectId: "app", title: formatSessionTitle("claude", "为应用设计一个更自然的欢迎页面"), harness: "claude", status: "idle", revision: 1, updatedAt: now - 60_000 },
  { id: "three", projectId: "research", title: "长标题检查：在窄屏手机中保留智能体图标以及会话状态", harness: "codex", status: "idle", needsInput: true, revision: 1, updatedAt: now - 300_000 },
];
const loadSessions = async (projectId: string) => sessions.filter((session) => session.projectId === projectId);
const cachedSessions = (projectId: string) => sessions.filter((session) => session.projectId === projectId);
const noop = () => {};

function Fixture() {
  const [project, setProject] = useState<HostProject>();
  return <div className="mobile-app">
    <header className="mobile-header" data-floating="true">
      <IconButton className="" label="Home" onClick={() => setProject(undefined)}><PanelLeft /></IconButton>
      <div className="mobile-header-title"><strong>{project?.name ?? "Monocode"}</strong></div>
      <div className="mobile-header-actions"><IconButton className="" label="Search"><Search /></IconButton></div>
    </header>
    <MobileHome projects={projects} project={project} foreground query="" now={now}
      unreadIds={new Set(["two"])} loadSessions={loadSessions} cachedSessions={cachedSessions}
      onProject={setProject} onSession={noop} onNewSession={noop} onNewChat={noop}
      onSearch={noop} onAddProject={noop} />
  </div>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
