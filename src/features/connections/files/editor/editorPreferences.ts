import { EditorState, type Extension } from "@codemirror/state";
import { indentUnit } from "@codemirror/language";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  highlightWhitespace,
  scrollPastEnd,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { loadEditorPreferences } from "../model/editorPreferences";

function guides(view: EditorView): DecorationSet {
  const marks = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      let columns = 0;
      for (const char of line.text) {
        if (char === " ") columns++;
        else if (char === "\t")
          columns += view.state.tabSize - (columns % view.state.tabSize);
        else break;
      }
      if (columns > 0)
        marks.push(
          Decoration.line({
            attributes: {
              style: `background-image: repeating-linear-gradient(to right, color-mix(in srgb, currentColor 14%, transparent) 0px, color-mix(in srgb, currentColor 14%, transparent) 1px, transparent 1px, transparent ${view.state.tabSize}ch); background-size: ${columns}ch 100%; background-repeat: no-repeat; background-position: 6px 0`,
            },
          }).range(line.from),
        );
      pos = line.to + 1;
    }
  }
  return Decoration.set(marks, true);
}
const indentGuides = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = guides(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.startState.tabSize !== update.state.tabSize
      )
        this.decorations = guides(update.view);
    }
  },
  { decorations: (value) => value.decorations },
);

export function editorPreferenceExtensions(): Extension {
  const prefs = loadEditorPreferences();
  return [
    EditorState.tabSize.of(prefs.tabSize),
    indentUnit.of(" ".repeat(prefs.tabSize)),
    prefs.wordWrap ? EditorView.lineWrapping : [],
    prefs.indentGuides ? indentGuides : [],
    prefs.showWhitespace ? highlightWhitespace() : [],
    prefs.scrollPastEnd ? scrollPastEnd() : [],
  ];
}
