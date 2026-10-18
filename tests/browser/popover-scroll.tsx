import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Popover } from "../../src/shared/ui/Popover";
import { useHoverSummary } from "../../src/shared/ui/HoverSummary";
import { UpdateNotesPopover } from "../../src/app/shell/UpdateNotesPopover";
import "../../src/styles/index.css";

function Fixture() {
  const anchor = useRef<HTMLButtonElement>(null);
  const hover = useHoverSummary<HTMLButtonElement>();
  const [count, setCount] = useState(60);
  const notes = new URLSearchParams(location.search).has("notes");
  return (
    <>
      <button
        style={{ position: "fixed", right: 20, top: 20 }}
        onClick={() => setCount(count + 1)}
      >
        Append row
      </button>
      <div
        data-testid="anchor-scroll"
        style={{ height: 600, width: 220, overflowY: "auto" }}
      >
        <div style={{ height: 1200, paddingTop: 480 }}>
          <button
            ref={notes ? hover.anchorRef : anchor}
            {...(notes ? hover.triggerProps : {})}
          >
            Open notes
          </button>
        </div>
      </div>
      {notes ? (
        <UpdateNotesPopover
          hover={hover}
          version="99.0.0"
          releaseNotes={Array.from(
            { length: count },
            (_, i) => `- Release note ${i + 1}: scrollable update details.`,
          ).join("\n")}
        />
      ) : (
        <Popover
          anchor={anchor}
          side="right"
          align="end"
          width={460}
          maxHeight={420}
          data-testid="list"
          className="overflow-y-auto overscroll-contain p-3"
        >
          <ul>
            {Array.from({ length: count }, (_, i) => (
              <li key={i} style={{ padding: 8 }}>
                List entry {i + 1}
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
