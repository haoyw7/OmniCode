import type { Terminal } from "@xterm/xterm";

export type TerminalFitMode = "shell" | "tui";

const DEFAULT_SCROLLBAR_WIDTH = 7;
const MIN_TUI_SCROLLBAR_WIDTH = 1;

type CellSize = { width: number; height: number };

type MeasuredTerminal = Terminal & {
  _core?: {
    _charSizeService?: { measure(): void };
    _renderService?: {
      dimensions?: { css?: { cell?: CellSize } };
      handleCharSizeChanged?(): void;
      _renderer?: { value?: { _dimensionsStyleElement?: HTMLStyleElement } };
    };
  };
};

const guardedDimensionStyles = new WeakSet<HTMLStyleElement>();

/** xterm 6's DOM renderer rewrites this static stylesheet on every resize. */
export function deduplicateTerminalDimensionStyles(term: Terminal): void {
  const style = (term as MeasuredTerminal)._core?._renderService?._renderer
    ?.value?._dimensionsStyleElement;
  if (!style || guardedDimensionStyles.has(style)) return;
  let prototype: object | null = Object.getPrototypeOf(style);
  let descriptor: PropertyDescriptor | undefined;
  while (prototype && !descriptor) {
    descriptor = Object.getOwnPropertyDescriptor(prototype, "textContent");
    prototype = Object.getPrototypeOf(prototype);
  }
  if (!descriptor?.get || !descriptor.set) return;
  const { get, set } = descriptor;
  // Keep the workaround on this renderer-owned node, never Node.prototype.
  // Read the real contents so external edits and genuinely new CSS still work.
  // Identical writes otherwise invalidate page styles, especially in WebKit.
  Object.defineProperty(style, "textContent", {
    configurable: true,
    get() { return get.call(this); },
    set(value: string | null) {
      if (get.call(this) !== value) set.call(this, value);
    },
  });
  guardedDimensionStyles.add(style);
}

/** Recover DOM renderer measurements after a hidden host or a font load. */
export function refreshTerminalMeasurements(term: Terminal): void {
  deduplicateTerminalDimensionStyles(term);
  const core = (term as MeasuredTerminal)._core;
  core?._charSizeService?.measure();
  // xterm 6 keeps a separate DOM glyph-width cache. Measuring the base cell
  // alone does not invalidate it when the cell size itself stayed unchanged.
  // Keep this private API access beside the existing cell-dimensions adapter.
  core?._renderService?.handleCharSizeChanged?.();
  term.refresh(0, term.rows - 1);
}

export function terminalScrollbarWidth(
  overviewRuler?: { width?: number },
): number {
  const width = overviewRuler?.width;
  return width === undefined ? DEFAULT_SCROLLBAR_WIDTH : width;
}

function cellSize(term: Terminal): CellSize | null {
  const dims = (term as MeasuredTerminal)._core?._renderService?.dimensions?.css
    ?.cell;
  if (!dims || dims.width < 1 || dims.height < 1) return null;
  return dims;
}

function availableSize(
  host: HTMLElement,
  mode: TerminalFitMode,
  term: Terminal,
): { width: number; height: number } | null {
  const gutter =
    mode === "tui"
      ? MIN_TUI_SCROLLBAR_WIDTH
      : terminalScrollbarWidth(term.options.overviewRuler);
  const width = host.clientWidth - gutter;
  const height = host.clientHeight;
  if (width < 8 || height < 8) return null;
  return { width, height };
}

export function fitTerminal(
  term: Terminal,
  host: HTMLElement,
  mode: TerminalFitMode,
): { cols: number; rows: number } | null {
  // Also covers a renderer/style node replaced after the terminal was opened.
  deduplicateTerminalDimensionStyles(term);
  const size = availableSize(host, mode, term);
  if (!size) return null;

  const cell = cellSize(term);
  if (!cell) return null;

  const cols = Math.max(2, Math.floor(size.width / cell.width));
  const rows = Math.max(1, Math.floor(size.height / cell.height));
  if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows);

  return { cols: term.cols, rows: term.rows };
}

export function applyTerminalChrome(
  term: Terminal,
  outer: HTMLElement,
  tui: boolean,
): void {
  outer.classList.toggle("monocode-terminal--alt-screen", tui);
  term.options.overviewRuler = {
    width: tui ? MIN_TUI_SCROLLBAR_WIDTH : DEFAULT_SCROLLBAR_WIDTH,
  };
}
