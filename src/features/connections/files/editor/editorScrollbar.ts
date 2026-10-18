import {
  forEachDiagnostic,
  setDiagnosticsEffect,
  type Diagnostic,
} from "@codemirror/lint";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { Scrollbar } from "../../../../shared/ui/Scrollbar";

export type DiagnosticOverviewTick = {
  severity: Diagnostic["severity"];
  top: number;
  pos: number;
  message: string;
};

const SEVERITY_PRIORITY: Record<Diagnostic["severity"], number> = {
  hint: 0,
  info: 1,
  warning: 2,
  error: 3,
};

/** One marker per line, keeping the most important diagnostic on that line. */
export function diagnosticOverviewTicks(
  state: EditorState,
): DiagnosticOverviewTick[] {
  const ticks = new Map<number, DiagnosticOverviewTick>();
  const lineCount = Math.max(1, state.doc.lines);
  forEachDiagnostic(state, (diagnostic, from) => {
    const pos = Math.min(state.doc.length, Math.max(0, from));
    const line = state.doc.lineAt(pos).number;
    const next = {
      severity: diagnostic.severity,
      top: (line - 1) / lineCount,
      pos,
      message: diagnostic.message,
    };
    const current = ticks.get(line);
    if (
      !current ||
      SEVERITY_PRIORITY[next.severity] > SEVERITY_PRIORITY[current.severity]
    ) {
      ticks.set(line, next);
    }
  });
  return [...ticks.values()].sort((a, b) => a.pos - b.pos);
}

class EditorScrollbar {
  readonly dom = document.createElement("div");
  readonly markers = document.createElement("div");
  readonly scrollbar: Scrollbar;
  readonly cursor = document.createElement("div");
  readonly resizeObserver: ResizeObserver | null;
  private frame = 0;

  constructor(readonly view: EditorView) {
    this.dom.className = "cm-editorScrollbar";
    this.dom.setAttribute("aria-hidden", "true");
    this.markers.className = "cm-editorScrollbarMarkers";
    this.cursor.className = "cm-editorScrollbarCursor";
    this.markers.append(this.cursor);
    this.dom.append(this.markers);
    this.view.dom.appendChild(this.dom);
    this.scrollbar = new Scrollbar(
      this.dom,
      () => ({ offset: view.scrollDOM.scrollTop, content: view.scrollDOM.scrollHeight, viewport: view.scrollDOM.clientHeight }),
      (offset) => { view.scrollDOM.scrollTop = offset; },
      () => view.defaultLineHeight,
    );

    this.dom.addEventListener("pointerdown", this.onPointerDown);
    this.view.scrollDOM.addEventListener("scroll", this.onScroll, {
      passive: true,
    });

    this.resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(this.scheduleDraw);
    this.resizeObserver?.observe(this.view.scrollDOM);
    this.drawMarkers();
    this.drawCursor();
    this.scheduleDraw();
  }

  update(update: ViewUpdate) {
    const diagnosticsChanged = update.transactions.some((transaction) =>
      transaction.effects.some((effect) => effect.is(setDiagnosticsEffect)),
    );
    if (update.docChanged || diagnosticsChanged) this.drawMarkers();
    if (update.docChanged || update.selectionSet) this.drawCursor();
    if (update.docChanged || update.geometryChanged) this.scheduleDraw();
  }

  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.dom.removeEventListener("pointerdown", this.onPointerDown);
    this.scrollbar.destroy();
    this.dom.remove();
  }

  private readonly onScroll = () => this.scheduleDraw();

  private readonly scheduleDraw = () => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.scrollbar.update();
    });
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const target = event.target;
    if (target instanceof HTMLElement) {
      const tick = target.closest<HTMLElement>(".cm-editorScrollbarTick");
      const pos = tick?.dataset.pos;
      if (pos != null) {
        const anchor = Number(pos);
        this.view.dispatch({
          selection: { anchor },
          effects: EditorView.scrollIntoView(anchor, { y: "center" }),
        });
        this.view.focus();
        return;
      }
    }
  };

  private drawCursor() {
    const state = this.view.state;
    const line = state.doc.lineAt(state.selection.main.head).number;
    const top = (line - 1) / Math.max(1, state.doc.lines);
    this.cursor.style.top = `${top * 100}%`;
  }

  private drawMarkers() {
    const fragment = document.createDocumentFragment();
    for (const tick of diagnosticOverviewTicks(this.view.state)) {
      const marker = document.createElement("div");
      marker.className = `cm-editorScrollbarTick cm-editorScrollbar-${tick.severity}`;
      marker.style.top = `${tick.top * 100}%`;
      marker.dataset.pos = String(tick.pos);
      marker.title = tick.message;
      fragment.appendChild(marker);
    }
    this.markers.replaceChildren(fragment, this.cursor);
  }
}

const scrollbarPlugin = ViewPlugin.fromClass(EditorScrollbar);

const scrollbarTheme = EditorView.theme({
  "&": {
    position: "relative",
    "--editor-scrollbar-width": "var(--scrollbar-size, 7px)",
  },
  ".cm-scroller": {
    scrollbarWidth: "none",
  },
  ".cm-scroller::-webkit-scrollbar": {
    width: "0",
    height: "0",
  },
  ".cm-content": {
    paddingRight: "var(--editor-scrollbar-width)",
  },
  ".cm-editorScrollbar": {
    position: "absolute",
    zIndex: "12",
    top: "0",
    right: "0",
    bottom: "0",
    width: "var(--editor-scrollbar-width)",
    boxSizing: "border-box",
    background: "transparent",
    cursor: "default",
    touchAction: "none",
    userSelect: "none",
  },
  ".cm-editorScrollbarMarkers": {
    position: "absolute",
    inset: "var(--scrollbar-vertical-button-size, 9px) 0",
    pointerEvents: "none",
  },
  ".cm-editorScrollbarTick": {
    position: "absolute",
    zIndex: "2",
    left: "calc(3px * var(--scrollbar-scale, 1))",
    right: "calc(2px * var(--scrollbar-scale, 1))",
    height: "3px",
    minHeight: "3px",
    borderRadius: "1px 0 0 1px",
    pointerEvents: "auto",
  },
  ".cm-editorScrollbar-error": {
    backgroundColor: "#f87171",
  },
  ".cm-editorScrollbar-warning": {
    backgroundColor: "#fbbf24",
  },
  ".cm-editorScrollbar-info": {
    backgroundColor: "#60a5fa",
  },
  ".cm-editorScrollbar-hint": {
    backgroundColor:
      "color-mix(in srgb, var(--color-content) 48%, transparent)",
  },
  ".cm-editorScrollbarCursor": {
    position: "absolute",
    zIndex: "3",
    left: "0",
    right: "0",
    height: "2px",
    pointerEvents: "none",
    backgroundColor: "var(--color-accent)",
    boxShadow:
      "0 0 0 1px color-mix(in srgb, var(--color-background-base) 42%, transparent)",
  },
  "&:not(.cm-focused) .cm-editorScrollbarCursor": {
    opacity: "0.6",
  },
});

export const editorScrollbar: Extension = [scrollbarPlugin, scrollbarTheme];
