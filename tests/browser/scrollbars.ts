import { observeNativeScrollbarEdges } from "../../src/shared/ui/nativeScrollbarEdges";
import "../../src/styles/index.css";
import "../../src/shared/ui/readonly-text.css";
import "@xterm/xterm/css/xterm.css";
import { EditorView } from "@codemirror/view";
import { Terminal } from "@xterm/xterm";
import { editorScrollbar } from "../../src/features/connections/files/editor/editorScrollbar";
import { attachTerminalScrollbar } from "../../src/features/terminal/ui/terminalScrollbar";
import { Scrollbar } from "../../src/shared/ui/Scrollbar";
import scrollbarCSS from "../../src/shared/ui/scrollbar.css?raw";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { ProjectList } from "../../src/app/shell/ProjectList";

const stopNativeEdges = observeNativeScrollbarEdges(document);
const style = document.createElement("style");
style.textContent = `
  body { overflow: auto; padding: 24px; }
  #fixtures { display: grid; grid-template-columns: repeat(3, 260px); gap: 20px; }
  section { min-width: 0; }
  h2 { font-size: 14px; margin-bottom: 8px; }
  .fixture { position: relative; height: 200px; width: 260px; background: var(--color-panel); }
  .native { overflow: auto; }
  .lines { line-height: 20px; padding-left: 8px; white-space: pre; }
  .cm-editor { height: 100%; }
  .cm-scroller { overflow: auto; }
  #horizontal { overflow-x: auto; overflow-y: hidden; }
`;
document.head.append(style);
function fixture(id: string, title: string) {
  const section = document.createElement("section");
  const heading = document.createElement("h2");
  heading.textContent = title;
  const host = document.createElement("div");
  host.id = id;
  host.className = "fixture";
  section.append(heading, host);
  document.querySelector("#fixtures")!.append(section);
  return host;
}
const content = Array.from(
  { length: 80 },
  (_, n) => `Line ${n + 1}: scrollbar geometry`,
).join("\n");
const native = fixture("native", "Native / branch menu");
native.classList.add("native", "branch-menu-scroll");
native.innerHTML = `<div class="lines">${content}</div>`;
const readonly = fixture("readonly", "Read-only text");
readonly.classList.add("readonly-text-view");
const readonlyView = new EditorView({
  doc: content,
  parent: readonly,
  extensions: [EditorView.editable.of(false)],
});
const editor = fixture("editor", "File editor");
const view = new EditorView({
  doc: content,
  parent: editor,
  extensions: [editorScrollbar],
});
const terminalHost = fixture("terminal", "Terminal");
terminalHost.classList.add("monocode-terminal");
const renderer = document.createElement("div");
renderer.className = "monocode-terminal-renderer";
renderer.style.cssText = "width:100%;height:100%";
terminalHost.append(renderer);
const terminal = new Terminal({
  cols: 28,
  rows: 10,
  overviewRuler: { width: 7 },
  theme: {
    background: "#faf9f5",
    foreground: "#141413",
    overviewRulerBorder: "#00000000",
  },
});
terminal.open(renderer);
const detach = attachTerminalScrollbar(terminal, renderer);
const terminalReady = new Promise<void>((resolve) =>
  terminal.write(content.replaceAll("\n", "\r\n"), resolve),
);
const horizontal = fixture("horizontal", "Native horizontal");
horizontal.innerHTML =
  '<div style="width:1000px;padding:12px">Horizontal content</div>';
const timeline = fixture("timeline", "Timeline overlay");
const scroller = document.createElement("div");
scroller.className = "wf-scroller";
scroller.style.cssText = "overflow:auto;height:100%";
scroller.innerHTML =
  '<div style="width:1000px;padding:12px">Timeline content</div>';
timeline.append(scroller);
const bar = new Scrollbar(
  timeline,
  () => ({
    offset: scroller.scrollLeft,
    viewport: scroller.clientWidth,
    content: scroller.scrollWidth,
  }),
  (offset) => {
    scroller.scrollLeft = offset;
  },
  () => 40,
  "horizontal",
);
scroller.addEventListener("scroll", bar.update);
const shadowHost = fixture("shadow", "Diff shadow root");
const shadow = shadowHost.attachShadow({ mode: "open" });
const stopShadowEdges = observeNativeScrollbarEdges(shadow);
shadow.innerHTML = `<style>${scrollbarCSS} .scroll { height:200px; overflow:auto; } .wide { width:1000px; }</style><div class="scroll"><div class="wide">Diff content</div></div>`;
const short = fixture("short", "No overflow");
short.classList.add("native");
short.textContent = "Short content";

// Exercise the real sidebar scroller, including its padding and edge divider.
Object.assign(window, { __TAURI_INTERNALS__: {
  metadata: { currentWindow: { label: "fixture" }, currentWebview: { label: "fixture" } },
  invoke: async (command: string) => /list|recents|models|skills|sessions|accounts|notifications/.test(command) ? [] : {},
  transformCallback: () => 0, unregisterCallback: () => {}, convertFileSrc: (path: string) => path,
} });
const sidebar = fixture("sidebar", "Sidebar sessions");
sidebar.dataset.desktopSidebar = "chat";
sidebar.style.display = "flex";
sidebar.style.flexDirection = "column";
const sidebarRoot = createRoot(sidebar);
sidebarRoot.render(createElement(ProjectList, {
  cwd: "", recents: [], showProjectSections: false, previewAll: true,
  onOpenProject: () => {}, onSelectProject: () => {},
  chatEntries: Array.from({ length: 40 }, (_, n) => ({
    id: `session-${n}`,
    content: () => createElement("div", { style: { height: 32 } }, `Session ${n + 1}`),
  })),
}));

Object.assign(window, {
  scrollbarFixture: {
    view,
    readonlyView,
    terminal,
    terminalReady,
    bar,
    destroy: () => {
      stopNativeEdges();
      stopShadowEdges();
      detach();
      terminal.dispose();
      view.destroy();
      readonlyView.destroy();
      bar.destroy();
      sidebarRoot.unmount();
    },
  },
});
