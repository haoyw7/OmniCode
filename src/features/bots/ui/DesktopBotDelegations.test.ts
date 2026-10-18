// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopBotDelegationCard, DesktopBotDelegations } from "./DesktopBotDelegations";
import { SurfaceVisibilityContext } from "../../../shared/ui/SurfaceVisibility";
import { setUiLanguage } from "../../../shared/i18n/language";
import type { BotDelegation, BotScope } from "../model/bots";
let node: HTMLDivElement, root: Root;
const scope: BotScope = { botId: "a", threadId: "a-1" };
const names = { a: "Atlas", b: "Researcher", c: "Other Bot" };
const delegation = (id = "d1", at = 3): BotDelegation => ({ id, source: { ...scope, runId: "source-run" }, target: { botId: "b", threadId: "b-delegated", runId: "target-run" }, requestId: id, prompt: "Check the plan", status: "running", createdAt: at, updatedAt: at, deadlineAt: 240003 });
const button = (text: string) => [...node.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === text)!;
async function flush() { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); }); }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); setUiLanguage("en"); vi.useFakeTimers();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); node.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("refreshes message cards only on revisions or visibility, and opens the admitted target thread", async () => {
  let value = delegation();
  const rpc = vi.fn(async () => value), open = vi.fn();
  const render = (revision: number, visible = true) => act(() => root.render(createElement(SurfaceVisibilityContext.Provider, { value: visible }, createElement(DesktopBotDelegationCard, { scope, rpc: rpc as never, delegationId: "d1", revision, botNames: names, onOpenThread: open }))));
  render(1); await flush();
  expect(node.textContent).toContain("Atlas → Researcher");
  act(() => button("Open target thread").click()); expect(open).toHaveBeenCalledWith({ botId: "b", threadId: "b-delegated" });
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); }); expect(rpc).toHaveBeenCalledTimes(1);
  value = { ...value, status: "completed", result: "The plan is ready", updatedAt: 9 };
  render(2); await flush(); expect(rpc).toHaveBeenCalledTimes(2); expect(node.textContent).toContain("The plan is ready"); expect(button("Cancel delegation")).toBeUndefined();
  render(3, false); await flush(); expect(rpc).toHaveBeenCalledTimes(2);
  render(3); await flush(); expect(rpc).toHaveBeenCalledTimes(3);
  const disclosure = node.querySelector<HTMLButtonElement>(".desktop-bot-delegation-heading")!;
  act(() => disclosure.click()); await flush(); expect(node.textContent).toContain("Delegation deadline");
  act(() => disclosure.click()); expect(node.querySelector(".desktop-bot-delegation-body")).not.toBeNull();
  expect(node.querySelector('.zen-fold-item[data-fold-state="closing"]')).not.toBeNull();
  const body = node.querySelector(".desktop-bot-delegation-body");
  act(() => disclosure.click()); expect(node.querySelector(".desktop-bot-delegation-body")).toBe(body);
  expect(node.querySelector('.zen-fold-item[data-fold-state="opening"]')).not.toBeNull();
});

it("cancels only its delegation with a stable retry command after an unknown response", async () => {
  let value = delegation(), fail = true;
  const rpc = vi.fn(async (method: string, _params: Record<string, unknown>) => {
    if (method === "botDelegations.get") return value;
    if (method === "botDelegations.cancel") { if (fail) { fail = false; throw new Error("Connection lost"); } value = { ...value, status: "cancelled" }; return value; }
    throw new Error(method);
  });
  const render = (visible: boolean) => act(() => root.render(createElement(SurfaceVisibilityContext.Provider, { value: visible }, createElement(DesktopBotDelegationCard, { scope, rpc: rpc as never, delegationId: "d1", revision: 1, botNames: names }))));
  render(true); await flush();
  render(false); expect(button("Cancel delegation").disabled).toBe(true);
  act(() => button("Cancel delegation").click()); expect(rpc.mock.calls.some(([method]) => method === "botDelegations.cancel")).toBe(false);
  render(true); await flush();
  act(() => button("Cancel delegation").click()); await flush(); expect(node.textContent).toContain("Connection lost");
  act(() => button("Cancel delegation").click()); await flush();
  const calls = rpc.mock.calls.filter(([method]) => method === "botDelegations.cancel");
  expect(calls).toHaveLength(2); expect(calls[0][1].commandId).toBe(calls[1][1].commandId);
  expect(calls[1][1]).toMatchObject({ botId: "a", threadId: "a-1", delegationId: "d1" });
  expect(button("Cancel delegation")).toBeUndefined(); expect(node.textContent).toContain("Cancelled");
});

it("rejects foreign records and never cancels or displays their private content", async () => {
  const foreign = { ...delegation(), source: { botId: "c", threadId: "c-1", runId: "private" }, prompt: "Private prompt", result: "Private result" };
  const rpc = vi.fn(async (_method: string, _params: Record<string, unknown>) => foreign);
  act(() => root.render(createElement(DesktopBotDelegationCard, { scope, rpc: rpc as never, delegationId: "d1", revision: 1, botNames: names }))); await flush();
  expect(node.textContent).toContain("Delegation unavailable in this thread"); expect(node.textContent).not.toContain("Private"); expect(button("Cancel delegation")).toBeUndefined();
  expect(rpc.mock.calls[0]).toEqual(["botDelegations.get", { ...scope, delegationId: "d1" }]);
});

it("refreshes loaded delegation pages, accepts target-thread records, filters foreign records and stops hidden polling", async () => {
  let updated = false;
  const rpc = vi.fn(async (method: string, params: Record<string, any>) => {
    expect(method).toBe("botDelegations.list");
    const at = params.before?.createdAt ?? (updated ? 4 : 3);
    const value = at > 3 ? delegation("new", 3) : at > 2 ? delegation("recent", 2) : { ...delegation("old", 1), source: { botId: "b", threadId: "b-1", runId: "b-run" }, target: { ...scope, runId: "a-run" }, status: updated ? "timed_out" as const : "running" as const };
    const foreign = { ...delegation("foreign"), source: { botId: "c", threadId: "c-1", runId: "private" }, prompt: "Do not expose" };
    return { revision: updated ? 2 : 1, delegations: [value, foreign], hasMore: value.id !== "old", next: value.id === "old" ? undefined : { createdAt: value.createdAt, id: value.id } };
  });
  const render = (visible: boolean) => act(() => root.render(createElement(SurfaceVisibilityContext.Provider, { value: visible }, createElement(DesktopBotDelegations, { scope, rpc: rpc as never, botNames: names }))));
  render(true); await flush(); act(() => button("Load older delegations").click()); await flush();
  expect(node.querySelectorAll(".desktop-bot-delegation-card")).toHaveLength(2);
  expect(node.textContent).toContain("Researcher → Atlas"); expect(node.textContent).not.toContain("Other Bot");
  updated = true; await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); await flush(); expect(node.textContent).toContain("Timed out");
  expect(node.querySelectorAll(".desktop-bot-delegation-card")).toHaveLength(3);
  expect(rpc.mock.calls.at(-1)![1].before).toEqual({ createdAt: 2, id: "recent" });
  render(false); const count = rpc.mock.calls.length; await act(async () => { await vi.advanceTimersByTimeAsync(6000); }); expect(rpc).toHaveBeenCalledTimes(count);
  expect(rpc.mock.calls.every(([, params]) => params.botId === scope.botId && params.threadId === scope.threadId)).toBe(true);
});
