import { memo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ResizableRegion, ResizableHandle, ResizablePanel, ResizablePanelGroup, type PanelImperativeHandle } from "../../src/shared/ui/primitives/Resizable";
import { isPaneResizing } from "../../src/shared/lib/paneResize";
import "../../src/styles/index.css";

let renders = 0;
let hmrUpdates = 0;
const onHmr = () => { hmrUpdates++; };
import.meta.hot?.on("vite:beforeUpdate", onHmr);
import.meta.hot?.dispose(() => import.meta.hot?.off("vite:beforeUpdate", onHmr));
const Content = memo(function Content() {
  renders++;
  return <div data-content className="h-full overflow-auto"><textarea aria-label="Draft" defaultValue="Keep this draft" />
    {Array.from({ length: 500 }, (_, index) => <p key={index}>{index}: A stable content row to verify live reflow and retained content.</p>)}
  </div>;
});

function Fixture({ region = false }: { region?: boolean }) {
  const [mounted, setMounted] = useState(true);
  const [revision, setRevision] = useState(0);
  const panel = useRef<PanelImperativeHandle | null>(null);
  const regionPane = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(280);
  const commits = useRef<number[]>([]);
  Object.assign(window, { resizeFixture: {
    rerender: () => setRevision(value => value + 1),
    unmount: () => setMounted(false),
    get commits() { return commits.current; },
    get renders() { return renders; },
    get hmrUpdates() { return hmrUpdates; },
    isPaneResizing,
  } });
  return <div data-revision={revision} style={{ height: 600, width: 1000 }}>
    {mounted && region ? <div style={{ display: "flex", height: "100%" }}>
      <div ref={regionPane} data-region-panel style={{ position: "relative", flexShrink: 0, height: "100%" }}>
        <Content />
        <ResizableRegion targetRef={regionPane} size={size} min={240} max={500} defaultSize={280} label="Resize content"
          onCommit={value => { commits.current.push(value); setSize(value); }} />
      </div><div style={{ flex: 1, minWidth: 420 }}><Content /></div>
    </div> : mounted && <ResizablePanelGroup className="h-full" onLayoutChanged={(_, meta) => {
      if (meta.isUserInteraction && panel.current) commits.current.push(panel.current.getSize().inPixels);
    }}>
      <ResizablePanel id="first" defaultSize={280} minSize={240} maxSize={500} panelRef={panel} groupResizeBehavior="preserve-pixel-size">
        <Content />
      </ResizablePanel>
      <ResizableHandle aria-label="Resize content" onDoubleClick={() => panel.current?.resize(280)} />
      <ResizablePanel id="second" minSize={420}><Content /></ResizablePanel>
    </ResizablePanelGroup>}
  </div>;
}

createRoot(document.getElementById("root")!).render(<Fixture region={new URLSearchParams(location.search).has("region")} />);
