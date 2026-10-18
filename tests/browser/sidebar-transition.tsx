import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SidebarRail, SidebarTransition } from "../../src/app/shell/SidebarTransition";
import "../../src/styles/index.css";

const noop = () => {};

function Fixture() {
  const [open, setSidebar] = useState(true);
  useEffect(() => { Object.assign(window, { desktopFixture: { setSidebar } }); }, []);
  return <div style={{ display: "flex", height: "100vh" }}>
    <SidebarRail open={!open}><button onClick={() => setSidebar(true)}>Open sidebar</button></SidebarRail>
    <SidebarTransition open={open} width={360} trailingInset="8px" dragging={false} setPaneRef={noop} finishDrag={noop}>
      <aside style={{ height: "100%", background: "#ccc" }}>
        <button onClick={() => setSidebar(false)}>Close sidebar</button>
        <input aria-label="Retained sidebar draft" defaultValue="draft" />
      </aside>
    </SidebarTransition>
    <main style={{ flex: 1 }}>Workspace</main>
  </div>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
