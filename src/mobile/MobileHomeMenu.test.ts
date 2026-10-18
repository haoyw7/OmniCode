// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostSessionSummary } from "../features/connections/model/protocol";
import { setUiLanguage } from "../shared/i18n/language";
import { MobileHomeMenu } from "./MobileHomeMenu";

const projects = ["alpha", "beta", "empty-one", "empty-two"].map((id) => ({
  id, name: id, cwd: `/${id}`,
}));
const session = (projectId: string, updatedAt: number, extra: Partial<HostSessionSummary> = {}): HostSessionSummary => ({
  id: `${projectId}-${updatedAt}`, projectId, title: projectId, harness: "codex",
  status: "idle", revision: 1, updatedAt, ...extra,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const cache = new Map<string, HostSessionSummary[]>();
let loadSessions = vi.fn<(id: string) => Promise<HostSessionSummary[]>>();
const cachedSessions = (id: string) => cache.get(id);
const onProject = vi.fn(), onClose = vi.fn();
let root: Root;
let node: HTMLDivElement;
let trigger: HTMLButtonElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  setUiLanguage("en");
  cache.clear();
  cache.set("alpha", [session("alpha", 10)]);
  cache.set("beta", [session("beta", 100)]);
  loadSessions = vi.fn<(id: string) => Promise<HostSessionSummary[]>>();
  onProject.mockClear();
  onClose.mockClear();
  node = document.createElement("div");
  trigger = document.createElement("button");
  document.body.append(trigger, node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  trigger.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render(props: Partial<Parameters<typeof MobileHomeMenu>[0]> = {}) {
  await act(async () => root.render(createElement(MobileHomeMenu, {
    open: true, foreground: true, anchor: { current: trigger }, projects,
    projectsPending: false, projectsUnavailable: false,
    loadSessions, cachedSessions, onProject, onClose, ...props,
  })));
}
const order = () => [...node.querySelectorAll(".mobile-project-options strong")].map((row) => row.textContent);

describe("mobile header project menu", () => {
  it("uses cached activity immediately, refreshes the newest conversation order and preserves it on failure", async () => {
    const pending = deferred<HostSessionSummary[]>();
    loadSessions.mockImplementation((id) => id === "alpha" ? pending.promise : Promise.resolve(cache.get(id) ?? []));
    await render();
    expect(order()).toEqual(["beta", "alpha", "empty-one", "empty-two"]);
    await act(async () => pending.resolve([
      session("alpha", 1, { pinned: true }),
      session("alpha", 300),
    ]));
    expect(order()).toEqual(["alpha", "beta", "empty-one", "empty-two"]);

    loadSessions.mockImplementation(async (id) => id === "alpha" ? [
      session(id, 9000, { activityAt: 300 }),
      session(id, 10000, { archived: true }),
    ] : id === "beta" ? [session(id, 400)] : []);
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(order()).toEqual(["beta", "alpha", "empty-one", "empty-two"]);
    loadSessions.mockRejectedValue(new Error("Offline"));
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(order()).toEqual(["beta", "alpha", "empty-one", "empty-two"]);
    expect(projects.map((project) => project.id)).toEqual(["alpha", "beta", "empty-one", "empty-two"]);

    act(() => node.querySelector<HTMLButtonElement>(".mobile-project-options button")!.click());
    expect(onProject).toHaveBeenCalledExactlyOnceWith(projects[1]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("only refreshes while open in the foreground, ignores late responses and rereads cache on reopen", async () => {
    const pending = deferred<HostSessionSummary[]>();
    loadSessions.mockImplementation((id) => id === "alpha" ? pending.promise : Promise.resolve(cache.get(id) ?? []));
    await render({ open: false });
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(loadSessions).not.toHaveBeenCalled();
    await render({ foreground: false });
    expect(order()).toEqual(["beta", "alpha", "empty-one", "empty-two"]);
    expect(loadSessions).not.toHaveBeenCalled();

    await render();
    expect(loadSessions).toHaveBeenCalledTimes(projects.length);
    await render({ open: false });
    await act(async () => pending.resolve([session("alpha", 1000)]));
    expect(order()).toEqual(["beta", "alpha", "empty-one", "empty-two"]);
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(loadSessions).toHaveBeenCalledTimes(projects.length);

    cache.set("alpha", [session("alpha", 200)]);
    await render({ foreground: false });
    expect(order()).toEqual(["alpha", "beta", "empty-one", "empty-two"]);
    expect(loadSessions).toHaveBeenCalledTimes(projects.length);
  });
});
