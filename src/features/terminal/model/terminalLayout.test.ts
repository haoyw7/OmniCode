import type { Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import {
  applyTerminalChrome,
  fitTerminal,
  terminalScrollbarWidth,
} from "./terminalLayout";

describe("terminalScrollbarWidth", () => {
  it("defaults to 7px when overview ruler width is unset", () => {
    expect(terminalScrollbarWidth(undefined)).toBe(7);
    expect(terminalScrollbarWidth({})).toBe(7);
  });

  it("honors an explicit overview ruler width", () => {
    expect(terminalScrollbarWidth({ width: 1 })).toBe(1);
    expect(terminalScrollbarWidth({ width: 0 })).toBe(0);
  });
});

it("restores the shell rail after a TUI and fits to its actual width", () => {
  const term = {
    cols: 79,
    rows: 24,
    options: { overviewRuler: {}, letterSpacing: 0, lineHeight: 1 },
    _core: {
      _renderService: { dimensions: { css: { cell: { width: 10, height: 20 } } } },
    },
    resize: vi.fn((cols: number, rows: number) => {
      term.cols = cols;
      term.rows = rows;
    }),
  };
  const terminal = term as unknown as Terminal;
  const outer = { classList: { toggle: vi.fn() } } as unknown as HTMLElement;
  const host = { clientWidth: 807, clientHeight: 480 } as HTMLElement;

  applyTerminalChrome(terminal, outer, true);
  expect(term.options.overviewRuler).toEqual({ width: 1 });
  applyTerminalChrome(terminal, outer, false);
  expect(term.options.overviewRuler).toEqual({ width: 7 });
  expect(fitTerminal(terminal, host, "shell")).toEqual({ cols: 80, rows: 24 });
  expect(term.resize).toHaveBeenCalledWith(80, 24);
});

it("changes TUI columns and rows without stretching glyphs or clipping the last cell", () => {
  const term = {
    cols: 80, rows: 24,
    options: { letterSpacing: 0, lineHeight: 1 },
    _core: { _renderService: { dimensions: { css: { cell: { width: 10, height: 20 } } } } },
    resize: vi.fn((cols: number, rows: number) => { term.cols = cols; term.rows = rows; }),
  };
  const host = { clientWidth: 796, clientHeight: 475 };
  const fit = () => fitTerminal(term as unknown as Terminal, host as HTMLElement, "tui");
  expect(fit()).toEqual({ cols: 79, rows: 23 });
  host.clientWidth = 651;
  host.clientHeight = 390;
  expect(fit()).toEqual({ cols: 65, rows: 19 });
  expect(term.options).toEqual({ letterSpacing: 0, lineHeight: 1 });
  fit();
  expect(term.resize).toHaveBeenCalledTimes(2);
});
