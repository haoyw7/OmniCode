import { useState } from "react";
import { createRoot } from "react-dom/client";
import { WindowDragBar } from "../../src/app/shell/WindowChrome";
import { MenuBar, MENU_BAR_HEIGHT } from "../../src/app/shell/MenuBar";
import { saveMenuBarVisible } from "../../src/features/settings/model/settings";
import { PanelExample } from "./window-drag-panels";
import { Dialog, DialogContent, DialogTitle } from "../../src/shared/ui/primitives/Dialog";
import { LAYER } from "../../src/shared/lib/layers";
import "../../src/styles/index.css";

function Fixture() {
  const [open, setOpen] = useState(false);
  const params = new URLSearchParams(location.search);
  const kind = params.get("kind");
  const pinned = params.has("pinned");
  return (
    <div className="app-shell-root desktop-workspace relative flex h-full flex-col">
      <div data-window-chrome className="relative shrink-0" style={{ zIndex: LAYER.windowChrome, pointerEvents: "auto" }}>
        {pinned ? <MenuBar windowNavigation={null} handlers={{}} dispatch={() => true} /> : <WindowDragBar windowNavigation={null} />}
      </div>
      <main className="relative isolate flex min-h-0 flex-1 items-center justify-center">
        {kind ? <PanelExample kind={kind} topInset={pinned ? MENU_BAR_HEIGHT : 42} /> : <button onClick={() => setOpen(true)}>Open artifact</button>}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="flex h-[80vh] w-[960px] max-w-[calc(100%-2rem)] flex-col" aria-describedby={undefined}>
            <DialogTitle>Workflow artifact</DialogTitle>
            <input aria-label="Artifact control" />
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}

saveMenuBarVisible(new URLSearchParams(location.search).has("pinned"));
createRoot(document.getElementById("root")!).render(<Fixture />);
