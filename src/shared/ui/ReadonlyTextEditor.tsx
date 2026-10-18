import { Compartment, EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  lineNumbers,
  type ViewUpdate,
} from "@codemirror/view";
import { useContext, useEffect, useRef, useState } from "react";
import {
  ReadonlyTextStateContext,
  type ReadonlyTextProps,
} from "./ReadonlyTextView";
import { useTranslation } from "../i18n/useTranslation";
import { cspStyleNonce } from "../lib/csp";
import { useSurfaceVisibility } from "./SurfaceVisibility";
import "./readonly-text.css";

type ReadingState = { top: number; left: number; wrap: boolean };

function diffDecorations(view: EditorView) {
  const marks = [];
  for (const range of view.visibleRanges) {
    for (let position = range.from; position <= range.to;) {
      const row = view.state.doc.lineAt(position);
      const kind = row.text[0];
      if (kind === "+" || kind === "-")
        marks.push(
          Decoration.line({
            class: kind === "+" ? "readonly-diff-add" : "readonly-diff-del",
          }).range(row.from),
        );
      position = row.to + 1;
    }
  }
  return Decoration.set(marks, true);
}
const diffColors = ViewPlugin.fromClass(
  class {
    decorations;
    constructor(view: EditorView) {
      this.decorations = diffDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged)
        this.decorations = diffDecorations(update.view);
    }
  },
  { decorations: (value) => value.decorations },
);

const theme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "inherit",
    fontSize: "inherit",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-mono)",
    lineHeight: "1.65",
    overscrollBehaviorX: "contain",
  },
  ".cm-content": { padding: "8px 0", tabSize: "4" },
  ".cm-line": { padding: "0 12px" },
  ".cm-gutters": {
    backgroundColor:
      "color-mix(in srgb, var(--color-background-base) calc(var(--panel-opacity) * 100%), transparent)",
    color: "color-mix(in srgb, currentColor 45%, transparent)",
    borderRight: "1px solid var(--color-stroke)",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px" },
});

/** CodeMirror virtualizes lines AND long unwrapped lines; the complete text stays selectable/copyable. */
export default function ReadonlyTextEditor({
  text,
  line,
  startLine = 1,
  stateKey,
  onCopy,
  diff,
}: ReadonlyTextProps) {
  const { t } = useTranslation();
  const saved = useContext(ReadonlyTextStateContext);
  const key = stateKey ? `readonly:${stateKey}` : undefined;
  const initial = useRef(
    key ? (saved?.get(key) as ReadingState | undefined) : undefined,
  );
  const [wrap, setWrap] = useState(initial.current?.wrap ?? false);
  const currentWrap = useRef(wrap);
  const [copied, setCopied] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const wrapping = useRef(new Compartment());
  const currentText = useRef(text);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const visible = useSurfaceVisibility();
  const [ready, setReady] = useState(false);
  // Distant code fences do not construct editors during sheet opening.
  useEffect(() => {
    if (!visible || ready) return;
    if (typeof IntersectionObserver !== "function") {
      setReady(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setReady(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px" },
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, [visible, ready]);

  useEffect(() => {
    if (!ready || !host.current) return;
    const editor = new EditorView({
      parent: host.current,
      doc: currentText.current,
      extensions: [
        theme,
        EditorView.cspNonce.of(cspStyleNonce()),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({
          tabindex: "0",
          "aria-label": t("Read-only text"),
        }),
        diff
          ? diffColors
          : lineNumbers({
              formatNumber: (number) => String(number + startLine - 1),
            }),
        wrapping.current.of(
          initial.current?.wrap ? EditorView.lineWrapping : [],
        ),
      ],
    });
    view.current = editor;
    const restore = initial.current;
    if (restore)
      editor.requestMeasure({
        read: () => null,
        write: () => {
          editor.scrollDOM.scrollTop = restore.top;
          editor.scrollDOM.scrollLeft = restore.left;
        },
      });
    const remember = () => {
      if (key)
        saved?.set(key, {
          top: editor.scrollDOM.scrollTop,
          left: editor.scrollDOM.scrollLeft,
          wrap: currentWrap.current,
        } satisfies ReadingState);
    };
    editor.scrollDOM.addEventListener("scroll", remember, { passive: true });
    return () => {
      remember();
      editor.scrollDOM.removeEventListener("scroll", remember);
      editor.destroy();
      view.current = null;
    };
    // Text/locale updates must not recreate the viewport or lose the selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, startLine, key, saved, diff]);

  useEffect(() => {
    if (!visible) return;
    const previous = currentText.current;
    currentText.current = text;
    const editor = view.current;
    if (!editor || previous === text) return;
    // Streaming providers generally append; avoid replacing the existing document.
    const append = text.startsWith(previous);
    const follow =
      editor.scrollDOM.scrollHeight -
        editor.scrollDOM.scrollTop -
        editor.scrollDOM.clientHeight <
      48;
    editor.dispatch({
      changes: {
        from: append ? editor.state.doc.length : 0,
        to: editor.state.doc.length,
        insert: append ? text.slice(previous.length) : text,
      },
    });
    if (append && follow)
      editor.dispatch({
        effects: EditorView.scrollIntoView(editor.state.doc.length, {
          y: "end",
        }),
      });
  }, [text, ready, visible]);
  useEffect(() => {
    currentWrap.current = wrap;
    view.current?.dispatch({
      effects: wrapping.current.reconfigure(
        wrap ? EditorView.lineWrapping : [],
      ),
    });
  }, [wrap, ready]);
  useEffect(() => {
    view.current?.contentDOM.setAttribute("aria-label", t("Read-only text"));
    if (visible) view.current?.requestMeasure();
  }, [t, visible, ready]);
  useEffect(() => {
    const editor = view.current;
    if (!editor || !line || initial.current) return;
    const target = editor.state.doc.line(
      Math.max(1, Math.min(line - startLine + 1, editor.state.doc.lines)),
    );
    editor.dispatch({
      selection: { anchor: target.from },
      effects: EditorView.scrollIntoView(target.from, { y: "center" }),
    });
  }, [line, startLine, ready]);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const jump = (end: boolean) => {
    const editor = view.current;
    if (editor)
      editor.dispatch({
        effects: EditorView.scrollIntoView(end ? editor.state.doc.length : 0, {
          y: end ? "end" : "start",
        }),
      });
  };
  return (
    <div className="readonly-text-view" inert={!visible}>
      <div className="readonly-text-toolbar">
        <button
          type="button"
          aria-pressed={wrap}
          onClick={() => setWrap((value) => !value)}
        >
          {t("Wrap lines")}
        </button>
        <button type="button" onClick={() => jump(false)}>
          {t("Go to start")}
        </button>
        <button type="button" onClick={() => jump(true)}>
          {t("Go to end")}
        </button>
        {onCopy ? (
          <button
            type="button"
            onClick={() => {
              void onCopy(text).then(
                () => {
                  setCopied(true);
                  clearTimeout(copyTimer.current);
                  copyTimer.current = setTimeout(() => setCopied(false), 1200);
                },
                () => {},
              );
            }}
          >
            {t(copied ? "Copied" : "Copy all")}
          </button>
        ) : null}
      </div>
      <div className="readonly-text-viewport" ref={host} />
    </div>
  );
}
