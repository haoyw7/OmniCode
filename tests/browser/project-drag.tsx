// Actual project list with local data; no Host, provider or native filesystem.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { ProjectList } from "../../src/app/shell/ProjectList";
import { ProjectSessionSection } from "../../src/app/shell/ProjectSessionSection";
import { DEFAULT_SESSION_SIDEBAR_FILTERS } from "../../src/features/sessions/model/sessionFilters";
import type { SessionSummary } from "../../src/features/sessions/data/sessionStore";
import { savePinnedProjects, saveProjectRailOrder } from "../../src/features/projects/model/recents";
import { saveProjectGroups, setProjectGroupAssignment } from "../../src/features/projects/model/projectGroups";
import { defaultTransition } from "../../src/shared/motion/tokens";
import { applyDesktopSkin } from "../../src/shared/theme/desktopSkin";
import { setUiLanguage } from "../../src/shared/i18n/language";
import "../../src/styles/index.css";

const origin = new URLSearchParams(location.search).get("origin");
const paths = ["cha-k", "optimize-session-model-agent-loading", "ba", "delta", "epsilon", "zeta", "eta"].map(name => `/fixture/${name}`);
setUiLanguage("zh-CN");
document.documentElement.classList.add("theme-light");
localStorage.setItem("monocode.desktopColorScheme", "light");
applyDesktopSkin();
saveProjectRailOrder(paths);
savePinnedProjects(origin === "pinned" ? paths : []);
saveProjectGroups(origin === "group" ? [{ id: "team", name: "Team", collapsed: false }] : []);
if (origin === "group") for (const path of paths) setProjectGroupAssignment(path, "team");
Object.assign(window, { __TAURI_INTERNALS__: {
  metadata: { currentWindow: { label: "fixture" }, currentWebview: { label: "fixture" } },
  invoke: async (command: string) => /list|recents|models|skills|sessions|accounts|notifications/.test(command) ? [] : {},
  transformCallback: () => 0, unregisterCallback: () => {}, convertFileSrc: (path: string) => path,
} });
const noop = () => {};
const withSessions = new URLSearchParams(location.search).has("sessions");
const sessions: SessionSummary[] = paths.flatMap(cwd => Array.from({ length: 12 }, (_, index) => ({
  id: `${cwd}-${index}`, cwd, title: `Session ${index + 1}`, harness: "codex", model: "gpt-6",
  runtimeMode: "supervised", createdAt: 1791891000000 - index, updatedAt: 1791891000000 - index,
})));
function SessionChildren({ path }: { path: string }) {
  const [loaded, setLoaded] = useState(!new URLSearchParams(location.search).has("loading"));
  useEffect(() => {
    if (loaded) return;
    const timeout = setTimeout(() => setLoaded(true), 80);
    return () => clearTimeout(timeout);
  }, [loaded]);
  return <ProjectSessionSection
    cwd={path} sessions={loaded ? sessions.filter(session => session.cwd === path) : []} open
    busySessionIds={new Set()} approvalSessionIds={new Set()} status="idle" pending={!loaded}
    onSelectSession={noop} onOpenFile={noop} tab="sessions" onTabChange={noop}
    filesSearchOpen={false} onFilesSearchOpenChange={noop} complete={loaded} searchQuery=""
    sessionFilters={DEFAULT_SESSION_SIDEBAR_FILTERS}
  />;
}

function Fixture() {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  return <MotionConfig reducedMotion="user" transition={defaultTransition}>
    <aside data-desktop-sidebar style={{ width: 348, height: "100vh", paddingTop: 16, borderRight: "1px solid var(--color-stroke)", background: "var(--color-background-base)" }}>
      <ProjectList cwd={paths[0]} recents={paths.map((path, index) => ({ path, openedAt: paths.length - index }))}
        expandedPaths={expanded} statsEnabled={false} onOpenProject={noop} onSelectProject={noop}
        onToggleProject={path => setExpanded(current => {
          const next = new Set(current);
          if (next.has(path)) next.delete(path); else next.add(path);
          return next;
        })}
        renderProjectChildren={path => withSessions ? <SessionChildren path={path} /> : <div style={{ padding: 12 }}>Retained children: {path}<input aria-label="Retained project state" defaultValue="Original state" /></div>}
      />
    </aside>
  </MotionConfig>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
