// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopBotsButton } from "./DesktopBotsButton";
import { queryClient } from "../../../shared/lib/queryClient";
import { markBotRead } from "../model/botUnread";
import type { BotMessage } from "../model/botView";
import { setUiLanguage } from "../../../shared/i18n/language";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  notify: vi.fn(),
  listen: vi.fn(),
  focus: vi.fn(),
  hosts: [] as { id: string; environmentId: string; capabilities: string[] }[],
}));
vi.mock("../../notifications/model/notifications", () => ({
  NOTIFICATION_CLICK_EVENT: "omnicode:notification-click", notifyApp: mocks.notify,
}));
vi.mock("../../connections/model/remoteProjects", () => ({ sharedHostMachineId: () => "local" }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main", unminimize: async () => {}, setFocus: mocks.focus }) }));
vi.mock("../../connections/model/connections", () => ({
  remoteRequest: mocks.rpc,
}));
vi.mock("../model/useDesktopBotsHosts", () => ({
  useDesktopBotsHosts: () => mocks.hosts,
}));
let root: Root, node: HTMLDivElement;
const onOpen = vi.fn();
const reply = (id: string, revision: number, text = id): BotMessage => ({
  id,
  revision,
  text,
  kind: "assistant",
  createdAt: revision,
});
let messages: Record<string, BotMessage[]>;
let names: Record<string, string | null>;
beforeEach(() => {
  queryClient.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  localStorage.clear();
  setUiLanguage("en");
  onOpen.mockClear();
  mocks.notify.mockReset();
  mocks.focus.mockReset();
  mocks.listen.mockReset().mockResolvedValue(vi.fn());
  mocks.hosts = [
    { id: "local", environmentId: "env-local", capabilities: ["assistant.v1"] },
    {
      id: "remote",
      environmentId: "env-remote",
      capabilities: ["assistant.v1"],
    },
    { id: "old", environmentId: "env-old", capabilities: [] },
  ];
  messages = { local: [], remote: [] };
  names = { local: "Personal assistant", remote: "Remote helper" };
  mocks.rpc.mockReset().mockImplementation(async (id, method, params) => {
    if (method === "environment.describe")
      return { capabilities: id === "old" ? [] : ["assistant.v1"] };
    if (method === "assistant.get") return names[id] === null ? null : { id: "assistant", name: names[id], chatRevision: Math.max(0, ...messages[id].map((m) => m.revision)) };
    const entries = messages[id].filter(
      (entry) => entry.revision > params.afterRevision,
    );
    return {
      entries,
      hasMore: false,
      nextRevision: entries.at(-1)?.revision ?? params.afterRevision,
    };
  });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(
      createElement(DesktopBotsButton, { active: false, onOpen }),
    ),
  );
}
const button = () => node.querySelector("button")!;

it("shows unseen replies and opens the latest message's Host without polling unsupported Hosts", async () => {
  messages.local = [
    reply("local-reply", 1),
    { ...reply("user", 2), kind: "user" },
  ];
  messages.remote = [reply("remote-reply", 3, "Remote task finished")];
  await render();
  expect(button().getAttribute("aria-label")).toBe(
    "Bots, 2 unread messages",
  );
  expect(button().textContent).toBe("BotsRemote task finished2");
  expect(
    mocks.rpc.mock.calls
      .filter(([id]) => id === "old")
      .map(([, method]) => method),
  ).toEqual(["environment.describe"]);
  act(() => button().click());
  expect(onOpen).toHaveBeenCalledWith("remote");
  // Opening is not itself a read acknowledgement: the chat must load and show it.
  expect(button().getAttribute("aria-label")).toContain("2 unread");
  act(() => markBotRead("env-remote", messages.remote));
  expect(button().getAttribute("aria-label")).toBe("Bots, 1 unread messages");
  expect(button().textContent).toContain("local-reply");
  act(() => markBotRead("env-local", messages.local));
  expect(button().getAttribute("aria-label")).toBe("Bots");
  expect(button().textContent).toBe("Bots");
  expect(localStorage.getItem("omnicode.assistant-read:env-local")).toBe("2");
});

it("coalesces streaming revisions and notices new content after an earlier revision was read", async () => {
  messages.local = [{ ...reply("stream", 1, "First"), streaming: true }];
  await render();
  act(() => markBotRead("env-local", messages.local));
  messages.local = [
    { ...reply("stream", 2, "First, then finished"), streaming: false },
  ];
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(button().getAttribute("aria-label")).toContain("1 unread");
  expect(button().textContent).toContain("First, then finished");
  mocks.rpc.mockRejectedValueOnce(new Error("offline"));
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(button().textContent).toContain("First, then finished");
});

it("restores read state and synchronizes acknowledgements from another window", async () => {
  messages.local = [reply("seen", 1), reply("unseen", 2)];
  localStorage.setItem("omnicode.assistant-read:env-local", "1");
  await render();
  expect(button().getAttribute("aria-label")).toContain("1 unread");
  act(() => {
    localStorage.setItem("omnicode.assistant-read:env-local", "2");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "omnicode.assistant-read:env-local" }),
    );
  });
  expect(button().getAttribute("aria-label")).toBe("Bots");
  act(() => button().click());
  expect(onOpen).toHaveBeenCalledWith(undefined);
});

it("shows pending questions and removes the notification when they resolve", async () => {
  const question: BotMessage = {
    id: "question",
    revision: 1,
    createdAt: 1,
    kind: "input",
    text: "Choose a project",
    brainGeneration: 1,
    runId: "run",
    requestId: 1,
    inputKind: "question",
    resolved: false,
  };
  messages.local = [question];
  await render();
  expect(button().textContent).toContain("Choose a project");
  messages.local = [{ ...question, revision: 2, resolved: true }];
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(button().getAttribute("aria-label")).toBe("Bots");
});

it("notifies completed replies once and opens the matching Host from a system notification", async () => {
  messages.local = [reply("history", 1)];
  await render();
  expect(mocks.notify).not.toHaveBeenCalled();
  messages.local.push({ ...reply("stream", 2), streaming: true });
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(mocks.notify).not.toHaveBeenCalled();
  messages.local = [reply("stream", 3, "Ready to review")];
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(mocks.notify).toHaveBeenCalledExactlyOnceWith('assistant:["env-local","main"]', {
    title: "OmniCode", subtitle: "Personal assistant", body: "Ready to review",
  }, false);
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(mocks.notify).toHaveBeenCalledOnce();
  await act(async () => mocks.listen.mock.calls[0][1]({ payload: 'assistant:["env-remote","other-window"]' }));
  expect(onOpen).not.toHaveBeenCalled();
  await act(async () => mocks.listen.mock.calls[0][1]({ payload: 'assistant:["env-remote","main"]' }));
  expect(onOpen).toHaveBeenCalledWith("remote");
  expect(mocks.focus).toHaveBeenCalledOnce();
});

it("passes visibility only for the selected assistant Host", async () => {
  await act(async () => root.render(createElement(DesktopBotsButton, {
    active: true, selectedMachineId: "remote", onOpen,
  })));
  expect(button().textContent).toBe("Bots");
  messages.local = [reply("local", 1)];
  messages.remote = [reply("remote", 1)];
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(mocks.notify.mock.calls.map(([id, , visible]) => [id, visible])).toEqual([
    ['assistant:["env-local","main"]', false], ['assistant:["env-remote","main"]', true],
  ]);
});

it("keeps the Bots entry stable when a bot is renamed or removed", async () => {
  await render();
  expect(button().textContent).toBe("Bots");
  names.local = "我的助理";
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(button().textContent).toBe("Bots");
  expect(button().title).toBe("Bots");
  expect(button().getAttribute("aria-label")).toBe("Bots");
  names.local = null;
  act(() => setUiLanguage("zh-CN"));
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(button().textContent).toBe("Bots");
  expect(button().title).toBe("Bots");
});

it("isolates Bot thread unread state and routes notifications to their exact thread", async () => {
  const legacy = mocks.rpc.getMockImplementation()!;
  const entries: Record<string, BotMessage[]> = { one: [reply("one", 1)], two: [reply("two", 2)] };
  mocks.rpc.mockImplementation(async (id, method, params = {}) => {
    if (id !== "local") return legacy(id, method, params);
    if (method === "environment.describe") return { capabilities: ["assistant.v1", "bots.v1"] };
    if (method === "bots.list") return { revision: 1, bots: [{ id: "bot" }], threads: ["one", "two"].map((threadId) => ({ botId: "bot", id: threadId })) };
    if (method === "botThreads.get") return { id: "bot", name: "Bot", chatRevision: entries[params.threadId].at(-1)?.revision ?? 0 };
    if (method === "botThreads.messages") return { entries: entries[params.threadId].filter((message) => message.revision > params.afterRevision), nextRevision: entries[params.threadId].at(-1)?.revision ?? 0, hasMore: false };
    throw new Error(method);
  });
  await render();
  expect(button().getAttribute("aria-label")).toBe("Bots, 2 unread messages");
  act(() => markBotRead(JSON.stringify(["env-local", "bot", "one"]), entries.one));
  expect(button().getAttribute("aria-label")).toBe("Bots, 1 unread messages");
  act(() => button().click());
  expect(JSON.parse(localStorage.getItem("omnicode.bot-selection:env-local")!)).toMatchObject({ botId: "bot", threadId: "two" });
  expect(onOpen).toHaveBeenLastCalledWith("local");
  entries.two.push(reply("new-two", 3, "Thread two completed"));
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(mocks.notify).toHaveBeenLastCalledWith('bot:["env-local","main","bot","two"]', {
    title: "OmniCode", subtitle: "Bot", body: "Thread two completed",
  }, false);
  await act(async () => mocks.listen.mock.calls[0][1]({ payload: 'bot:["env-local","main","bot","one"]' }));
  expect(JSON.parse(localStorage.getItem("omnicode.bot-selection:env-local")!)).toMatchObject({ botId: "bot", threadId: "one" });
  expect(mocks.rpc.mock.calls.some(([id, method]) => id === "local" && method.startsWith("assistant."))).toBe(false);
});
