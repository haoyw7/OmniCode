// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryClient } from "../../../shared/lib/queryClient";
import { InboxDiscussionPanel } from "./InboxDiscussionPanel";
import type { InboxItem } from "../model/githubTasks";

const item = { provider: "github", repo: "acme/web", number: 1, kind: "issue", title: "Issue" } as InboxItem;
let root: Root, container: HTMLDivElement;
const open = vi.fn(), restart = vi.fn(), mount = vi.fn();
beforeEach(() => {
  queryClient.clear(); open.mockReset(); restart.mockReset(); mount.mockReset(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); queryClient.clear(); container.remove(); vi.unstubAllGlobals(); });
const render = (number: number) => act(async () => root.render(createElement(InboxDiscussionPanel, { item: { ...item, number }, onOpen: open, onRestart: restart, onMount: mount, onClose: vi.fn() })));

it("ignores a late open after changing items and restarts the current item", async () => {
  let finish!: (session: string) => void;
  open.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce("current");
  restart.mockResolvedValueOnce("restarted");
  await render(1);
  await render(2);
  await act(async () => finish("old"));
  expect(mount).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "current" }));
  expect(mount.mock.calls.some(([value]) => value?.sessionId === "old")).toBe(false);
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Restart conversation"]')!.click());
  expect(restart).toHaveBeenCalledWith(expect.objectContaining({ number: 2 }));
  expect(mount).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "restarted" }));
});

it("does not attach a restarted conversation after unmount", async () => {
  open.mockResolvedValueOnce("current");
  let finish!: (session: string) => void;
  restart.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await render(1);
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Restart conversation"]')!.click());
  act(() => root.unmount());
  await act(async () => finish("late"));
  expect(mount).toHaveBeenLastCalledWith(null);
  expect(mount.mock.calls.some(([value]) => value?.sessionId === "late")).toBe(false);
});
