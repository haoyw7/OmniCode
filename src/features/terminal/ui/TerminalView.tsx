import { attachTerminalScrollbar } from "./terminalScrollbar";
import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { copyText } from "../../../platform/tauri/clipboard";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { ExplorerMenu } from "../../connections/files/ui/ExplorerMenu";
import { pasteTerminalClipboard } from "../model/terminalClipboard";
import {
  getPtyStatus,
  killPty,
  resizePty,
  spawnPty,
  subscribePty,
  writePty,
} from "../../../platform/tauri/pty";
import { isOscColorQuery, oscColorReply } from "../model/terminalChrome";
import { guardTerminalComposition } from "../model/terminalComposition";
import { createTerminalFitScheduler } from "../model/terminalFitScheduler";
import { createTerminalResize } from "../model/terminalResize";
import {
  isMacTerminalClearShortcut,
  macTerminalShortcutData,
  terminalClipboardShortcut,
} from "../model/terminalKeys";
import {
  defaultTerminalTitle,
  scanOscCwd,
  type TerminalMetaPatch,
} from "../model/terminalTab";
import { isLightScheme, SCHEME_CHANGE_EVENT } from "../../settings/model/appearance";
import {
  applyTerminalChrome,
  fitTerminal,
  deduplicateTerminalDimensionStyles,
  refreshTerminalMeasurements,
  type TerminalFitMode,
} from "../model/terminalLayout";
import { IS_MAC } from "../../../platform/tauri/platform";
import "@xterm/xterm/css/xterm.css";

type Props = {
  id: string;
  cwd: string;
  active: boolean;
  onMetaChange?: (patch: TerminalMetaPatch) => void;
};

function cssColor(expr: string, fallback: string): string {
  const probe = document.createElement("span");
  probe.style.color = expr;
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color || fallback;
}

function cssHexColor(expr: string, fallback: string): string {
  const color = cssColor(expr, fallback);
  if (/^#[\da-f]{6}$/i.test(color)) return color;
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length < 3 || channels.some(Number.isNaN)) {
    return fallback;
  }
  return `#${channels
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const ANSI_DARK = {
  black: "#1d2428",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#e8eef2",
  brightBlack: "#64748b",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde68a",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#f8fafc",
};

// One-Light-family palette tuned for a near-white canvas.
const ANSI_LIGHT = {
  black: "#383a42",
  red: "#e45649",
  green: "#50a14f",
  yellow: "#c18401",
  blue: "#4078f2",
  magenta: "#a626a4",
  cyan: "#0184bc",
  white: "#fafafa",
  brightBlack: "#7c8591",
  brightRed: "#df6b60",
  brightGreen: "#68b567",
  brightYellow: "#d19a2f",
  brightBlue: "#5c89f5",
  brightMagenta: "#b54bb3",
  brightCyan: "#1f9cc9",
  brightWhite: "#ffffff",
};

function terminalTheme(light: boolean) {
  return {
    background: "#00000000",
    // Setting the scrollbar width also enables xterm's white ruler outline.
    overviewRulerBorder: "#00000000",
    foreground: cssColor("var(--color-content)", light ? "#2e2e2e" : "#e8eef2"),
    cursor: cssColor("var(--color-accent)", light ? "#4078f2" : "#4da3f5"),
    cursorAccent: light ? "#ffffff" : "#000000",
    selectionBackground: light ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.18)",
    selectionInactiveBackground: light
      ? "rgba(0,0,0,0.08)"
      : "rgba(255,255,255,0.08)",
    ...(light ? ANSI_LIGHT : ANSI_DARK),
  };
}

function terminalFont(): string {
  const fromCss = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-terminal")
    .trim();
  const stack = fromCss ||
    'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace';
  // Some Linux WebKit/fontconfig setups resolve a named fallback or
  // ui-monospace to a proportional face. xterm then pads every glyph to W's
  // width, so check the rendered font rather than trusting the family name.
  const probe = document.createElement("span");
  probe.style.cssText =
    "position:absolute;visibility:hidden;display:inline-block;white-space:pre;font-size:13px;letter-spacing:0;font-kerning:none";
  probe.style.fontFamily = stack;
  document.body.appendChild(probe);
  try {
    for (const weight of ["400", "700"]) {
      probe.style.fontWeight = weight;
      probe.textContent = "W".repeat(32);
      const wide = probe.getBoundingClientRect().width;
      probe.textContent = "i".repeat(32);
      const narrow = probe.getBoundingClientRect().width;
      if (wide > 0 && narrow > 0 && Math.abs(wide - narrow) > 1) {
        // Keep the configured families available for Nerd Font/PUA icons.
        return `monospace, ${stack}`;
      }
    }
    return stack;
  } finally {
    probe.remove();
  }
}

/**
 * Teardown still in flight per PTY id. A view that mounts with an id another
 * view (or a StrictMode replay of itself) is still stopping must wait, or the
 * late kill lands on the replacement shell and drops its data handler.
 */
const stoppingPtys = new Map<string, Promise<void>>();

function oscColors() {
  const light = isLightScheme();
  return {
    fg: cssHexColor(
      "var(--color-content)",
      light ? "#2e2e2e" : "#ebebeb",
    ),
    bg: cssHexColor(
      "var(--color-background-base)",
      light ? "#f7f7f7" : "#171717",
    ),
    cursor: cssHexColor(
      "var(--color-accent)",
      light ? "#4078f2" : "#4da3f5",
    ),
  };
}

/**
 * How long a released terminal waits for another view to adopt it before its
 * shell is killed. Moving a terminal between the dock and a split pane mounts
 * a new view in the same commit, well inside this window.
 */
export const TERMINAL_HANDOFF_MS = 1000;

type MetaRef = { current: ((patch: TerminalMetaPatch) => void) | undefined };

/** One xterm and its PTY, owned by whichever view currently shows it. */
type LiveTerminal = {
  term: Terminal;
  spawned: boolean;
  runningProcess: string | null;
  applySize: () => void;
  attach: (outer: HTMLElement, host: HTMLElement, meta: MetaRef) => object;
  release: (owner: object) => void;
};

const liveTerminals = new Map<string, LiveTerminal & { parked?: number }>();

function claimTerminal(id: string, cwd: string, host: HTMLElement): LiveTerminal {
  const existing = liveTerminals.get(id);
  if (existing) {
    deduplicateTerminalDimensionStyles(existing.term);
    if (existing.parked !== undefined) clearTimeout(existing.parked);
    existing.parked = undefined;
    return existing;
  }
  const created = createLiveTerminal(id, cwd, host);
  liveTerminals.set(id, created);
  return created;
}

function createLiveTerminal(
  id: string,
  cwd: string,
  initialHost: HTMLElement,
): LiveTerminal & { parked?: number } {
  // xterm renders into its own node, which moves between views' hosts.
  const node = document.createElement("div");
  node.className = "monocode-terminal-renderer";
  node.style.width = "100%";
  node.style.height = "100%";
  const term = new Terminal({
    cursorBlink: true,
    cursorStyle: "bar",
    fontFamily: terminalFont(),
    fontSize: 13,
    lineHeight: 1,
    letterSpacing: 0,
    scrollback: 5000,
    allowTransparency: true,
    smoothScrollDuration: 0,
    theme: terminalTheme(isLightScheme()),
    macOptionIsMeta: IS_MAC,
  });
  // xterm's DOM renderer measures glyphs during open; a detached node reports
  // zero width. Hidden tabs are measured again when their host becomes visible.
  initialHost.appendChild(node);
  term.open(node);
  const detachScrollbar = attachTerminalScrollbar(term, node);
  deduplicateTerminalDimensionStyles(term);
  const stopCompositionGuard = guardTerminalComposition(term.textarea);
  let closed = false;
  let outer: HTMLElement | null = null;
  let host: HTMLElement | null = null;
  let meta: MetaRef = { current: undefined };
  let owner: object | null = null;

  term.attachCustomKeyEventHandler((event) => {
    const shortcutData = IS_MAC ? macTerminalShortcutData(event) : null;
    if (shortcutData) {
      if (event.type === "keydown") {
        event.preventDefault();
        event.stopPropagation();
        term.input(shortcutData);
      }
      return false;
    }
    if (IS_MAC && isMacTerminalClearShortcut(event)) {
      if (event.isComposing) return false;
      if (event.type === "keydown") {
        event.preventDefault();
        term.clear();
      }
      return false;
    }

    return true;
  });

  let oscBuffer = "";

  const live: LiveTerminal & { parked?: number } = {
    term,
    spawned: false,
    runningProcess: null,
    applySize: () => {},
    attach: () => ({}),
    release: () => {},
  };

  let unsubscribe = () => {};
  let didStart = false;
  const start = () => {
    if (closed) return;
    unsubscribe = subscribePty(
      id,
      (data) => {
        if (closed) return;
        const onMeta = meta.current;
        if (onMeta) {
          const text = new TextDecoder().decode(data);
          const scanned = scanOscCwd(text, oscBuffer);
          oscBuffer = scanned.rest;
          if (scanned.cwd) {
            const patch: TerminalMetaPatch = { cwd: scanned.cwd };
            if (!live.runningProcess) {
              patch.title = defaultTerminalTitle(scanned.cwd);
            }
            onMeta(patch);
          }
        }
        term.write(data);
      },
      (code) => {
        if (closed) return;
        const status = code == null ? "" : ` (${code})`;
        term.writeln(`\r\n[process exited${status}]`);
      },
    );
    didStart = true;
    return spawnPty(id, cwd, term.cols, term.rows);
  };

  const starting = (stoppingPtys.get(id) ?? Promise.resolve())
    .then(start)
    .then(() => {
      if (!closed) live.spawned = true;
    })
    .catch((error) => {
      live.spawned = false;
      if (!closed) {
        const message = error instanceof Error ? error.message : String(error);
        term.writeln(`\x1b[31m${message}\x1b[0m`);
      }
      throw error;
    });
  void starting.catch(() => undefined);

  const dataSub = term.onData((data) => {
    void starting
      .then(() => (closed ? undefined : writePty(id, data)))
      .catch(() => undefined);
  });

  const replyOsc = (code: 10 | 11 | 12, hex: string) => {
    const reply = oscColorReply(code, hex);
    if (reply) {
      void starting
        .then(() => (closed ? undefined : writePty(id, reply)))
        .catch(() => undefined);
    }
    return true;
  };
  const oscFg = term.parser.registerOscHandler(10, (data) =>
    isOscColorQuery(data) ? replyOsc(10, oscColors().fg) : false,
  );
  const oscBg = term.parser.registerOscHandler(11, (data) =>
    isOscColorQuery(data) ? replyOsc(11, oscColors().bg) : false,
  );
  const oscCursor = term.parser.registerOscHandler(12, (data) =>
    isOscColorQuery(data) ? replyOsc(12, oscColors().cursor) : false,
  );

  const onSchemeChange = () => {
    term.options.theme = terminalTheme(isLightScheme());
  };
  window.addEventListener(SCHEME_CHANGE_EVENT, onSchemeChange);

  term.attachCustomWheelEventHandler(() => {
    if (term.element?.classList.contains("enable-mouse-events")) return true;
    return term.buffer.active.type !== "alternate";
  });

  let tuiMode = false;
  let needsMeasurement = true;
  const resize = createTerminalResize(async (cols, rows) => {
    await starting;
    if (!closed) await resizePty(id, cols, rows);
  });

  const fitMode = (): TerminalFitMode =>
    term.buffer.active.type === "alternate" ? "tui" : "shell";

  const syncAltScreenMode = () => {
    const next = fitMode() === "tui";
    if (next === tuiMode) return;
    tuiMode = next;
    if (outer) applyTerminalChrome(term, outer, next);
    schedule();
  };

  const applySize = () => {
    if (closed || !host) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!host.isConnected || width < 8 || height < 8) {
      needsMeasurement = true;
      return;
    }
    if (needsMeasurement) {
      needsMeasurement = false;
      refreshTerminalMeasurements(term);
    }
    const next = fitTerminal(term, host, fitMode());
    if (!next) return;
    resize.request(next.cols, next.rows);
  };

  const fitScheduler = createTerminalFitScheduler(applySize, initialHost.ownerDocument.defaultView ?? window);
  const schedule = fitScheduler.schedule;

  live.applySize = applySize;
  const renderSub = term.onRender(() => {
    if (!live.spawned) schedule();
  });
  const bufferSub = term.buffer.onBufferChange(syncAltScreenMode);
  const observer = new ResizeObserver(schedule);
  const syncFont = () => {
    const family = terminalFont();
    if (term.options.fontFamily === family) return;
    term.options.fontFamily = family;
    needsMeasurement = true;
    schedule();
  };
  // xterm snapshots the CSS font stack. Update it when appearance settings
  // change without recreating the terminal or its PTY.
  const fontObserver = new MutationObserver(syncFont);
  fontObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style", "data-skin"],
  });
  const onFontsLoaded = () => {
    // The initial monospace probe may have run before the webfont was ready.
    syncFont();
    needsMeasurement = true;
    schedule();
  };
  document.fonts?.addEventListener("loadingdone", onFontsLoaded);

  const dispose = () => {
    if (liveTerminals.get(id) === live) liveTerminals.delete(id);
    closed = true;
    resize.dispose();
    fitScheduler.dispose();
    observer.disconnect();
    fontObserver.disconnect();
    document.fonts?.removeEventListener("loadingdone", onFontsLoaded);
    stopCompositionGuard();
    window.removeEventListener(SCHEME_CHANGE_EVENT, onSchemeChange);
    dataSub.dispose();
    oscFg.dispose();
    oscBg.dispose();
    oscCursor.dispose();
    renderSub.dispose();
    detachScrollbar();
    bufferSub.dispose();
    const stopping = starting
      .catch(() => undefined)
      .then(() => {
        unsubscribe();
        return didStart ? killPty(id) : undefined;
      })
      .finally(() => {
        if (stoppingPtys.get(id) === stopping) stoppingPtys.delete(id);
      });
    stoppingPtys.set(id, stopping);
    term.dispose();
    node.remove();
    live.spawned = false;
  };

  live.attach = (nextOuter, nextHost, nextMeta) => {
    if (outer && outer !== nextOuter) {
      outer.classList.remove("monocode-terminal--alt-screen");
    }
    outer = nextOuter;
    host = nextHost;
    meta = nextMeta;
    if (node.parentElement !== nextHost) nextHost.appendChild(node);
    applyTerminalChrome(term, nextOuter, tuiMode);
    observer.disconnect();
    observer.observe(nextHost);
    needsMeasurement = true;
    // A new host may have a different size; refit once it has laid out.
    schedule();
    owner = {};
    return owner;
  };

  live.release = (released) => {
    if (owner !== released) return;
    owner = null;
    fitScheduler.cancel();
    observer.disconnect();
    outer?.classList.remove("monocode-terminal--alt-screen");
    outer = null;
    host = null;
    meta = { current: undefined };
    live.parked = window.setTimeout(dispose, TERMINAL_HANDOFF_MS);
  };

  syncAltScreenMode();
  return live;
}

export function TerminalView({ id, cwd, active, onMetaChange }: Props) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const [menu, setMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [clipboardError, setClipboardError] = useState<"copy" | "paste" | null>(null);
  const interactiveRef = useRef(active && visible);
  interactiveRef.current = active && visible;
  const outerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<LiveTerminal | null>(null);
  const onMetaChangeRef = useRef(onMetaChange);
  onMetaChangeRef.current = onMetaChange;

  const clipboardAction = async (action: "copy" | "paste", selection?: string) => {
    const live = liveRef.current;
    const host = outerRef.current;
    if (!live || !host) return;
    const isCurrent = () => liveRef.current === live && interactiveRef.current;
    setClipboardError(null);
    try {
      if (action === "copy") {
        const text = selection ?? live.term.getSelection();
        if (text) await copyText(text);
        if (isCurrent()) live.term.focus();
      } else {
        await pasteTerminalClipboard(live.term, host, isCurrent);
      }
    } catch {
      if (isCurrent()) setClipboardError(action);
    }
  };

  useEffect(() => {
    if (!active || !visible) setMenu(null);
  }, [active, visible]);

  useEffect(() => {
    const outer = outerRef.current;
    const host = hostRef.current;
    if (!outer || !host) return;
    // A terminal moved here from the dock or another pane keeps its shell.
    const live = claimTerminal(id, cwd, host);
    const owner = live.attach(outer, host, onMetaChangeRef);
    liveRef.current = live;
    return () => {
      if (liveRef.current === live) liveRef.current = null;
      live.release(owner);
    };
  }, [id]);

  // Identity-stable: the callers pass an inline arrow, so depending on the
  // prop itself would tear down and re-arm the poll — and re-fork `ps` — on
  // every parent render.
  const wantsMeta = !!onMetaChange;

  useEffect(() => {
    if (!wantsMeta) return;
    let lastForeground: string | null = null;
    let inFlight = false;
    const refresh = () => {
      const live = liveRef.current;
      if (!live?.spawned) return;
      // Each status read forks `ps`; an off-screen window has no title to paint.
      if (document.hidden) return;
      if (inFlight) return;
      inFlight = true;
      void getPtyStatus(id)
        .then(({ foreground }) => {
          const fg = foreground?.trim() || null;
          live.runningProcess = fg;
          if (fg === lastForeground) return;
          lastForeground = fg;
          onMetaChangeRef.current?.(
            fg
              ? { title: fg, foreground: fg }
              : { title: defaultTerminalTitle(cwd), foreground: null },
          );
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };
    refresh();
    const interval = setInterval(refresh, 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [id, cwd, wantsMeta]);

  useEffect(() => {
    if (!active) return;
    // Tab hosts keep their layout while inactive. Only hidden/reattached hosts
    // and font loads invalidate measurements; focus alone must not reset them.
    liveRef.current?.applySize();
    liveRef.current?.term.focus();
  }, [active]);

  return (
    <div
      ref={outerRef}
      className="monocode-terminal content-surface flex h-full w-full min-h-0 min-w-0 flex-col"
      onMouseDown={() => liveRef.current?.term.focus()}
      onKeyDownCapture={(event) => {
        const term = liveRef.current?.term;
        if (!term) return;
        const action = terminalClipboardShortcut(event.nativeEvent, IS_MAC, term.hasSelection());
        if (!action) return;
        event.preventDefault();
        event.stopPropagation();
        void clipboardAction(action);
      }}
      onCopyCapture={(event) => {
        const text = liveRef.current?.term.getSelection();
        if (!text) return;
        event.preventDefault();
        event.stopPropagation();
        event.clipboardData.setData("text/plain", text);
      }}
      onPasteCapture={(event) => {
        const term = liveRef.current?.term;
        if (!term) return;
        event.preventDefault();
        event.stopPropagation();
        const text = event.clipboardData.getData("text/plain");
        if (text) term.paste(text);
      }}
      onContextMenuCapture={(event) => {
        if (!visible) return;
        event.preventDefault();
        event.stopPropagation();
        setMenu({ x: event.clientX, y: event.clientY, text: liveRef.current?.term.getSelection() ?? "" });
      }}
    >
      <div
        ref={hostRef}
        className="monocode-terminal-host min-h-0 min-w-0 flex-1 overflow-hidden"
      />
      {clipboardError && (
        <div role="alert" className="shrink-0 px-2 py-1 text-xs text-destructive">
          {t(clipboardError === "copy" ? "Copy failed." : "Paste failed.")}
        </div>
      )}
      <PresenceBoundary propagate>{menu && active && visible && (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          ariaLabel={t("Terminal")}
          items={[
            { kind: "item", id: "copy", label: t("Copy"), disabled: !menu.text,
              shortcut: IS_MAC ? "⌘C" : "Ctrl+Shift+C" },
            { kind: "item", id: "paste", label: t("Paste"),
              shortcut: IS_MAC ? "⌘V" : "Ctrl+Shift+V" },
          ]}
          onPick={(action) => {
            const selection = menu.text;
            setMenu(null);
            if (action === "copy" || action === "paste") void clipboardAction(action, selection);
          }}
          onClose={() => setMenu(null)}
        />
      )}</PresenceBoundary>
    </div>
  );
}
