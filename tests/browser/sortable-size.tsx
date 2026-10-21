import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ProjectList } from "../../src/app/shell/ProjectList";
import { SessionCard } from "../../src/app/shell/sessions/SessionCard";
import { SessionStatusPanel } from "../../src/features/sessions/ui/SessionStatusPanel";
import { newSession } from "../../src/features/sessions/model/session";
import { applyDesktopSkin } from "../../src/shared/theme/desktopSkin";
import { SortableItem, SortableList } from "../../src/shared/ui/primitives/Sortable";
import { ListMotionItem } from "../../src/shared/ui/ListMotion";
import { setUiLanguage } from "../../src/shared/i18n/language";
import "../../src/styles/index.css";

setUiLanguage("en");
applyDesktopSkin();
const noop = () => {};
const paths = ["/work/alpha", "/work/beta", "/work/gamma"];
const horizontal = new URLSearchParams(location.search).has("horizontal");

function Fixture() {
  const [ids, setIds] = useState(["a", "b", "c"]);
  const [width, setWidth] = useState(horizontal ? 900 : 340);
  const [revision, setRevision] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [commits, setCommits] = useState(0);
  const scope = useRef<HTMLDivElement>(null);
  Object.assign(window, { sortableFixture: {
    rerender: () => { setWidth(horizontal ? 1050 : 430); setRevision(value => value + 1); },
    unmount: () => setMounted(false),
  } });
  const query = new URLSearchParams(location.search);
  if (query.has("status")) return <div ref={scope} style={{ position: "relative", height: "100vh" }}>
    <SessionStatusPanel scope={scope} blocks={[{ id: "tasks", role: "tasks", text: "", taskList: {
      items: [{ text: "Keep card contents the same size", status: "in_progress" }, { text: "Verify preview geometry", status: "completed" }],
    } }]} busy={false} cwd="/work/alpha" branch="main" git={{ additions: 23, deletions: 7, files: 3, branch: "main" }}
      context={{ used: 46000, window: 200000, ...(query.has("longContext") ? { breakdown: {
        used: 46000, window: 200000, updatedAt: 1791891000000, estimated: false,
        categories: Array.from({ length: 12 }, (_, index) => ({ name: `Category ${index + 1}`, tokens: 3000, kind: "used" as const })),
      } } : {}) }} onNavigate={noop} />
  </div>;
  if (query.has("sidebar") || query.has("sessions")) return <aside data-desktop-sidebar="code" style={{ width: 360 }}>
    <ProjectList cwd={paths[0]} recents={paths.map((path, index) => ({ path, openedAt: 3 - index }))}
      expandedPaths={new Set(paths)} onSelectProject={noop} onToggleProject={noop} onOpenProject={noop}
      onNewInProject={noop} statsEnabled={false}
      chatEntries={query.has("sessions") ? ["first", "second"].map((id, index) => ({ id,
        content: <SessionCard session={{ ...newSession("claude", "", "claude-sonnet"), id,
          title: `Conversation ${index + 1}: preserve its preview`, createdAt: 1791891000000, updatedAt: 1791891000000 }}
          isActive={index === 0} isSelected={false} busy={false} done={false} unread={index === 1}
          linkedUpdate={false} dense now={1791891010000} onSelect={noop} />,
      })) : [{ id: "chat", content: <textarea defaultValue="Chat draft" /> }]}
      workflowsSection={<div style={{ height: 70 }}>Workflow content</div>}
      renderProjectChildren={path => <div data-project-content={path} style={{ padding: 8, height: path === paths[0] ? 115 : 68 }}>
        <textarea style={{ width: "100%", height: "100%", resize: "none" }} defaultValue={`Draft ${path}`} />
      </div>} />
  </aside>;
  return <>
    <style>{`.size-list { display: flex; gap: 12px; flex-direction: ${horizontal ? "row" : "column"}; }
      .size-card { border: 2px solid; padding: 12px; flex: ${horizontal ? "1" : "0 0 auto"}; min-width: 0; }
      .size-card:nth-child(1) { height: 120px; } .size-card:nth-child(2) { height: 210px; }
      .size-card:nth-child(3) { height: 165px; }
      .size-card textarea { display: block; width: 100%; height: calc(100% - 30px); resize: none; }`}</style>
    <div data-commits={commits} data-revision={revision} className="size-list" style={{ width }}>
      {mounted && <SortableList ids={ids} axis={horizontal ? "x" : "y"}
        onReorder={next => { setIds(next); setCommits(count => count + 1); }} renderOverlay={id => `Card ${id}`}>
        {ids.map(id => <SortableItem id={id} key={id}>{item => <ListMotionItem {...item.motionProps}
          ref={item.ref} style={item.style} className="size-card" data-card={id}>
          <button {...item.handleProps} type="button" style={{ touchAction: "none" }}>Move {id}</button>
          <textarea defaultValue={`Retained draft ${id}`} />
        </ListMotionItem>}</SortableItem>)}
      </SortableList>}
    </div>
  </>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
