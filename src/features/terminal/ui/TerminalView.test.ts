import { completeMotionAnimation } from "../../../../tests/helpers/motionDriver";
// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { beginPaneResize } from "../../../shared/lib/paneResize";

const pty = vi.hoisted(() => ({
  spawnPty: vi.fn(async () => {}),
  killPty: vi.fn(async () => {}),
  resizePty: vi.fn(async () => {}),
  writePty: vi.fn(async () => {}),
  subscribePty: vi.fn(() => () => {}),
  getPtyStatus: vi.fn(async () => ({ foreground: null })),
}));
vi.mock("../../../platform/tauri/pty", () => pty);
const xterm = vi.hoisted(() => ({
  options: [] as { fontFamily?: string }[],
  open: vi.fn(),
  selection: "",
  paste: vi.fn(),
}));
const layout = vi.hoisted(() => ({
  deduplicateTerminalDimensionStyles: vi.fn(),
  fitTerminal: vi.fn<() => { cols: number; rows: number } | null>(() => null),
  refreshTerminalMeasurements: vi.fn(),
  applyTerminalChrome: () => {},
}));
vi.mock("../model/terminalLayout", () => layout);
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    constructor(options: { fontFamily?: string }) {
      this.options = options;
      xterm.options.push(options);
    }
    cols = 80;
    rows = 24;
    options: { fontFamily?: string } = {};
    parser = { registerOscHandler: () => ({ dispose() {} }) };
    buffer = {
      active: { type: "normal" },
      onBufferChange: () => ({ dispose() {} }),
    };
    element = undefined;
    open(host: HTMLElement) {
      xterm.open(host.isConnected);
    }
    focus() {}
    hasSelection() { return !!xterm.selection; }
    getSelection() { return xterm.selection; }
    paste(text: string) { xterm.paste(text); }
    dispose() {}
    writeln() {}
    onData() {
      return { dispose() {} };
    }
    onRender() {
      return { dispose() {} };
    }
    attachCustomKeyEventHandler() {}
    attachCustomWheelEventHandler() {}
  },
}));
import { TERMINAL_HANDOFF_MS, TerminalView } from "./TerminalView";

afterEach(() => {
  xterm.options.length = 0;
  xterm.selection = "";
  vi.clearAllMocks();
  vi.restoreAllMocks();
  layout.fitTerminal.mockReturnValue(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Let an unclaimed terminal's handoff window lapse and its teardown run. */
async function lapseHandoff() {
  await act(async () => {
    vi.advanceTimersByTime(TERMINAL_HANDOFF_MS + 1);
  });
}

function setup() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const host = document.createElement("div");
  document.body.appendChild(host);
  return { host, root: createRoot(host) };
}

it("copies selected output with Ctrl+C and preserves Ctrl+C without a selection", async () => {
  const { host, root } = setup();
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  try {
    await act(async () => root.render(createElement(TerminalView, {
      id: "copy", cwd: "/tmp", active: true,
    })));
    const target = host.querySelector(".monocode-terminal-host")!;
    xterm.selection = "selected output";
    const selectedKey = new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => { target.dispatchEvent(selectedKey); });
    expect(copy).toHaveBeenCalledExactlyOnceWith("selected output");
    expect(selectedKey.defaultPrevented).toBe(true);
    xterm.selection = "";
    const interruptKey = new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => { target.dispatchEvent(interruptKey); });
    expect(interruptKey.defaultPrevented).toBe(false);
    expect(copy).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    await lapseHandoff();
    host.remove();
  }
});

it("handles native paste once before it reaches xterm's own listeners", async () => {
  const { host, root } = setup();
  try {
    await act(async () => root.render(createElement(TerminalView, {
      id: "paste", cwd: "/tmp", active: true,
    })));
    const target = host.querySelector(".monocode-terminal-host")!;
    const nativeHandler = vi.fn();
    target.addEventListener("paste", nativeHandler);
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "echo 你好\necho world");
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData });
    await act(async () => { target.dispatchEvent(event); });
    expect(xterm.paste).toHaveBeenCalledExactlyOnceWith("echo 你好\necho world");
    expect(event.defaultPrevented).toBe(true);
    expect(nativeHandler).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    await lapseHandoff();
    host.remove();
  }
});

it("offers copy and paste in the context menu and closes it when hidden", async () => {
  const { host, root } = setup();
  const render = (active: boolean) => root.render(createElement(TerminalView, {
    id: "clipboard-menu", cwd: "/tmp", active,
  }));
  try {
    await act(async () => render(true));
    const target = host.querySelector(".monocode-terminal-host")!;
    await act(async () => {
      target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    });
    const menu = document.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    const actions = menu!.querySelectorAll<HTMLButtonElement>("button[data-menu-index]");
    expect(actions).toHaveLength(2);
    expect(actions[0].disabled).toBe(true);
    expect(actions[1].disabled).toBe(false);
    await act(async () => render(false));
    await act(async () => completeMotionAnimation(document.body));
    expect(document.querySelector('[role="menu"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    await lapseHandoff();
    host.remove();
  }
});

it("opens xterm only after its node is connected", async () => {
  const { host, root } = setup();
  try {
    await act(async () => {
      root.render(
        createElement(TerminalView, {
          id: "connected", cwd: "/tmp", active: true,
        }),
      );
    });
    expect(xterm.open).toHaveBeenCalledWith(true);
  } finally {
    await act(async () => root.unmount());
    await lapseHandoff();
    host.remove();
  }
});

it("remeasures a revealed terminal even when its rows and columns stay the same", async () => {
  const { host, root } = setup();
  const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockReturnValue(800);
  const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get")
    .mockReturnValue(480);
  layout.fitTerminal.mockReturnValue({ cols: 80, rows: 24 });
  const view = (active: boolean) =>
    createElement(TerminalView, { id: "revealed", cwd: "/tmp", active });
  try {
    await act(async () => root.render(view(true)));
    expect(layout.refreshTerminalMeasurements).toHaveBeenCalledTimes(1);
    expect(pty.resizePty).toHaveBeenCalledTimes(1);

    width.mockReturnValue(0);
    await act(async () => root.render(view(false)));
    await act(async () => root.render(view(true)));
    expect(layout.refreshTerminalMeasurements).toHaveBeenCalledTimes(1);

    await act(async () => root.render(view(false)));
    width.mockReturnValue(800);
    await act(async () => root.render(view(true)));
    expect(layout.refreshTerminalMeasurements).toHaveBeenCalledTimes(2);
    expect(pty.resizePty).toHaveBeenCalledTimes(1);
    expect(pty.spawnPty).toHaveBeenCalledTimes(1);
    expect(pty.killPty).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    await lapseHandoff();
    width.mockRestore();
    height.mockRestore();
    host.remove();
  }
});

it("keeps glyph measurements and PTY dimensions stable when switching laid-out terminal tabs", async () => {
  const { host, root } = setup();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(480);
  layout.fitTerminal.mockReturnValue({ cols: 80, rows: 24 });
  const view = (selected: string) => createElement("div", null,
    ...["first", "second"].map((id) => createElement(TerminalView, {
      key: id, id, cwd: "/tmp", active: id === selected,
    })),
  );
  try {
    await act(async () => root.render(view("first")));
    await act(async () => root.render(view("second")));
    const measurements = layout.refreshTerminalMeasurements.mock.calls.length;
    const resizes = pty.resizePty.mock.calls.length;
    expect(measurements).toBe(2);

    await act(async () => root.render(view("first")));
    await act(async () => root.render(view("second")));
    expect(layout.refreshTerminalMeasurements).toHaveBeenCalledTimes(measurements);
    expect(pty.resizePty).toHaveBeenCalledTimes(resizes);
    expect(pty.spawnPty).toHaveBeenCalledTimes(2);
    expect(pty.killPty).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    await lapseHandoff();
    host.remove();
  }
});

it("fits and notifies the PTY while a pane resize is still active", async () => {
  const { host, root } = setup();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(480);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  layout.fitTerminal.mockReturnValue({ cols: 80, rows: 24 });
  const view = (active: boolean) => createElement(TerminalView, {
    id: "resize-focus", cwd: "/tmp", active,
  });
  let finish: (() => void) | undefined;
  try {
    await act(async () => root.render(view(true)));
    await act(async () => frames.splice(0).forEach(callback => callback(0)));
    const fits = layout.fitTerminal.mock.calls.length;
    finish = beginPaneResize();
    layout.fitTerminal.mockReturnValue({ cols: 100, rows: 24 });
    await act(async () => root.render(view(false)));
    await act(async () => root.render(view(true)));
    expect(layout.fitTerminal).toHaveBeenCalledTimes(fits + 1);
    expect(pty.resizePty).toHaveBeenLastCalledWith("resize-focus", 100, 24);
    await act(async () => {
      finish?.();
      frames.splice(0).forEach(callback => callback(0));
    });
    expect(layout.fitTerminal).toHaveBeenCalledTimes(fits + 1);
    expect(pty.resizePty).toHaveBeenLastCalledWith("resize-focus", 100, 24);
  } finally {
    finish?.();
    await act(async () => root.unmount());
    await lapseHandoff();
    host.remove();
  }
});

it("does not let StrictMode cleanup kill the replacement shell", async () => {
  const { host, root } = setup();
  try {
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(TerminalView, {
            id: "same-id",
            cwd: "/tmp",
            active: true,
          }),
        ),
      );
    });
    expect(pty.spawnPty).toHaveBeenCalledTimes(1);
    expect(pty.subscribePty).toHaveBeenCalledTimes(1);
    expect(pty.killPty).not.toHaveBeenCalled();
  } finally {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  }
  expect(pty.killPty).not.toHaveBeenCalled();
  await lapseHandoff();
  expect(pty.killPty).toHaveBeenCalledTimes(1);
});

it("keeps the shell when a terminal moves between the dock and a pane", async () => {
  const { host, root } = setup();
  // A new `key` remounts a fresh view with the same PTY id, as moving a
  // terminal between the dock and a split pane does.
  const view = (key: string) =>
    createElement(TerminalView, {
      key,
      id: "moved",
      cwd: "/tmp",
      active: true,
    });
  try {
    await act(async () => {
      root.render(view("dock"));
    });
    await act(async () => {
      root.render(view("pane"));
    });
    await lapseHandoff();
    expect(pty.subscribePty).toHaveBeenCalledTimes(1);
    expect(pty.spawnPty).toHaveBeenCalledTimes(1);
    expect(pty.killPty).not.toHaveBeenCalled();
  } finally {
    await act(async () => {
      root.unmount();
    });
    await lapseHandoff();
    host.remove();
  }
  expect(pty.killPty).toHaveBeenCalledTimes(1);
});

it("waits for a closed terminal's teardown before starting its id again", async () => {
  const { host, root } = setup();
  const operations: string[] = [];
  let releaseSpawn!: () => void;
  pty.subscribePty.mockImplementation(() => {
    operations.push("subscribe");
    return () => {
      operations.push("unsubscribe");
    };
  });
  pty.spawnPty
    .mockImplementationOnce(() => {
      operations.push("spawn old");
      return new Promise<void>((resolve) => {
        releaseSpawn = resolve;
      });
    })
    .mockImplementationOnce(async () => {
      operations.push("spawn replacement");
    });
  pty.killPty.mockImplementation(async () => {
    operations.push("kill");
  });
  const view = () =>
    createElement(TerminalView, { id: "reopened", cwd: "/tmp", active: true });
  try {
    await act(async () => {
      root.render(view());
    });
    await act(async () => {
      root.render(null);
    });
    await lapseHandoff();
    await act(async () => {
      root.render(view());
    });
    expect(operations).toEqual(["subscribe", "spawn old"]);
    await act(async () => {
      releaseSpawn();
    });
    expect(operations).toEqual([
      "subscribe",
      "spawn old",
      "unsubscribe",
      "kill",
      "subscribe",
      "spawn replacement",
    ]);
  } finally {
    await act(async () => {
      root.unmount();
    });
    await lapseHandoff();
    host.remove();
  }
});

it("does not hold a different terminal behind another one's teardown", async () => {
  const { host, root } = setup();
  pty.spawnPty.mockImplementationOnce(() => new Promise<void>(() => {}));
  try {
    await act(async () => {
      root.render(
        createElement(TerminalView, { id: "first", cwd: "/tmp", active: true }),
      );
    });
    await act(async () => {
      root.render(
        createElement(TerminalView, {
          id: "second",
          cwd: "/tmp",
          active: true,
        }),
      );
    });
    expect(pty.spawnPty).toHaveBeenCalledTimes(2);
    expect(pty.spawnPty).toHaveBeenLastCalledWith("second", "/tmp", 80, 24);
  } finally {
    await act(async () => {
      root.unmount();
    });
    await lapseHandoff();
    host.remove();
  }
});

it.each([
  { name: "keeps a resolved monospace font", narrow: 256, boldNarrow: 256, prefix: "" },
  { name: "replaces a proportional fallback", narrow: 96, boldNarrow: 96, prefix: "monospace, " },
  { name: "replaces a proportional bold fallback", narrow: 256, boldNarrow: 96, prefix: "monospace, " },
])("$name while retaining the configured icon fonts", async ({ narrow, boldNarrow, prefix }) => {
  const { host, root } = setup();
  const stack = '"Test Nerd Font", monospace';
  const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const width = this.textContent === "i".repeat(32)
        ? (this.style.fontWeight === "700" ? boldNarrow : narrow)
        : 256;
      return new DOMRect(0, 0, width, 16);
    });
  document.documentElement.style.setProperty("--font-terminal", stack);
  try {
    await act(async () => {
      root.render(
        createElement(TerminalView, { id: "font", cwd: "/tmp", active: true }),
      );
    });
    expect(xterm.options[0]?.fontFamily).toBe(prefix + stack);
  } finally {
    await act(async () => {
      root.unmount();
    });
    await lapseHandoff();
    measure.mockRestore();
    host.remove();
    document.documentElement.style.removeProperty("--font-terminal");
  }
});

it("updates an open terminal's font without replacing its PTY", async () => {
  const { host, root } = setup();
  const initial = '"JetBrains Mono", "Symbols Nerd Font Mono", monospace';
  const selected = '"Selected Mono", "Symbols Nerd Font Mono", monospace';
  document.documentElement.style.setProperty("--font-terminal", initial);
  try {
    await act(async () => root.render(createElement(TerminalView, {
      id: "live-font", cwd: "/tmp", active: true,
    })));
    expect(xterm.options[0]?.fontFamily).toBe(initial);
    await act(async () => {
      document.documentElement.style.setProperty("--font-terminal", selected);
      await vi.waitFor(() => expect(xterm.options[0]?.fontFamily).toBe(selected));
    });
    expect(xterm.options).toHaveLength(1);
    expect(pty.spawnPty).toHaveBeenCalledTimes(1);
    expect(pty.killPty).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    await lapseHandoff();
    host.remove();
    document.documentElement.style.removeProperty("--font-terminal");
  }
});

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
