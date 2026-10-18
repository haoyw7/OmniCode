// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useCommandDispatcher,
  type CommandDispatch,
} from "./useCommandDispatcher";

const native = vi.hoisted(() => ({
  listeners: new Map<string, () => void>(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, listener: () => void) => {
    native.listeners.set(event, listener);
    return native.unlisten;
  }),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.listeners.clear();
  native.unlisten.mockClear();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sidebar native command compatibility", () => {
  it("routes both native events to the current command and debounces their repeats", async () => {
    let now = 100;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const toggle = vi.fn();
    let dispatch: CommandDispatch;
    function Harness() {
      dispatch = useCommandDispatcher({ "App: Toggle Sidebar": toggle });
      return null;
    }
    await act(async () => root.render(createElement(Harness)));

    native.listeners.get("toggle_session_sidebar")!();
    native.listeners.get("toggle_sidebar")!();
    dispatch!("App: Toggle Sidebar");
    expect(toggle).toHaveBeenCalledTimes(1);

    now += 81;
    native.listeners.get("toggle_sidebar")!();
    expect(toggle).toHaveBeenCalledTimes(2);
    expect(dispatch!("App: Toggle Session Sidebar")).toBe(false);
  });
});
