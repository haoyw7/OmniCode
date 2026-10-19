import { SurfaceVisibilityContext } from "../../../shared/ui/SurfaceVisibility";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startMotionClock, stopMotionClock, finishMotion } from "../../../../tests/helpers/sharedMotionClock";
import { BotChat } from "./BotChat";
import { MobileAssistant } from "../../../mobile/MobileAssistant";
import { BotSettings } from "./BotSettings";
import {
  fullBotPolicy,
  type BotMessage,
  type BotHistory,
  type BotPatch,
  type BotConfiguration,
} from "../model/botView";
import { setUiLanguage } from "../../../shared/i18n/language";
import { LAYER } from "../../../shared/lib/layers";
vi.mock("./BotWorkerDetails", () => ({
  BotWorkerDetails: () => createElement("div", null, "Read-only worker"),
}));
let root: Root, node: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  startMotionClock();
  localStorage.clear();
  setUiLanguage("en");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  stopMotionClock();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function disclosure(name: string) {
  return [...node.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) =>
      b.textContent === name ||
      b.querySelector(".assistant-settings-disclosure-title")?.textContent ===
        name,
  )!;
}
async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}
it("uses capability fallback without polling an old Host", async () => {
  const rpc = vi.fn(async () => ({ capabilities: [] }));
  act(() =>
    root.render(
      createElement(BotChat, {
        hostKey: "old",
        hostName: "Old Host",
        rpc: rpc as any,
        onOpen: () => {},
      }),
    ),
  );
  await flush();
  await act(async () => {
    vi.advanceTimersByTime(6000);
  });
  expect(node.textContent).toContain("Assistant is unavailable on this Host");
  expect(rpc.mock.calls).toHaveLength(1);
});
it.each([false, true])("gates shared Feishu settings on the Host capability (%s)", async (supported) => {
  const rpc = vi.fn(async (method: string) => {
    if (method === "environment.describe") return { capabilities: ["assistant.v1", ...(supported ? ["im.feishu.v1"] : [])] };
    if (method === "assistant.get") return null;
    if (method === "models.list") return { models: {}, errors: {} };
    if (method === "projects.list") return [];
    if (method === "im.get") return { configured: false, status: { state: "stopped" }, pending: 0, deliveries: [] };
    throw new Error(`Unexpected method: ${method}`);
  });
  act(() => root.render(createElement(BotChat, {
    hostKey: "host", hostName: "Host", rpc: rpc as any, onOpen: () => {},
  })));
  await flush();
  act(() => disclosure("Feishu").click());
  await flush();
  if (supported) {
    expect(rpc).toHaveBeenCalledWith("im.get", {});
    expect(node.textContent).toContain("Enable the assistant before connecting Feishu.");
  } else {
    expect(rpc).not.toHaveBeenCalledWith("im.get", {});
    expect(node.textContent).toContain("This Host does not support Feishu.");
  }
});
it("keeps desktop orchestration cards opening their existing worker details", async () => {
  const onOpen = vi.fn();
  const view = { id: "a", name: "Assistant", lifecycle: "idle", revision: 1, enabled: true,
    triggers: { user: true, event: true, schedule: true }, brainGeneration: 1, policy: fullBotPolicy() };
  const rpc = vi.fn(async (method: string) => {
    if (method === "environment.describe") return { capabilities: ["assistant.v1"] };
    if (method === "assistant.get") return view;
    if (method === "assistant.messages") return { entries: [{ id: "worker-card", revision: 1, createdAt: 1, kind: "session-card",
      ref: { environmentId: "host", projectId: "project", sessionId: "worker" }, projectName: "Project", title: "Worker",
      harness: "codex", model: "test", actionId: "action", status: "completed" }], nextRevision: 1, hasMore: false };
    if (method === "models.list") return { models: {}, errors: {} };
    if (method === "projects.list") return [{ id: "project", cwd: "/project", name: "Project" }];
    if (method === "sessions.get") return { projectId: "project", session: { id: "worker", orchestrationLeadId: "lead" } };
    return null;
  });
  act(() => root.render(createElement(BotChat, { hostKey: "host", hostName: "Host", rpc: rpc as any, onOpen })));
  await flush();
  act(() => node.querySelector<HTMLButtonElement>(".assistant-card button")!.click());
  await flush();
  expect(node.textContent).toContain("Read-only worker");
  expect(onOpen).not.toHaveBeenCalled();
});
it.each([false, true])("loads session-card display names after history and tolerates catalog failure (%s)", async failed => {
  const message: Extract<BotMessage, { kind: "session-card" }> = {
    kind: "session-card", id: "model-card", revision: 1, createdAt: 1,
    ref: { environmentId: "host", projectId: "project", sessionId: "target" },
    title: "Task", projectName: "Project", harness: "codex", model: "codex:gpt-test",
    actionId: "action", status: "completed",
  };
  let resolveModels!: (value: unknown) => void;
  let rejectModels!: (error: Error) => void;
  const models = new Promise((resolve, reject) => { resolveModels = resolve; rejectModels = reject; });
  const rpc = vi.fn(async (method: string) => {
    if (method === "environment.describe") return { capabilities: ["assistant.v1"] };
    if (method === "assistant.get") return configuredView();
    if (method === "assistant.messages") return { entries: [message], nextRevision: 1, hasMore: false };
    if (method === "models.list") return models;
    throw new Error(`Unexpected method: ${method}`);
  });
  act(() => root.render(createElement(BotChat, {
    hostKey: "model-names", hostName: "Host", rpc: rpc as any, onOpen: () => {},
  })));
  await flush();
  const name = () => node.querySelector(".assistant-card-model-name")?.textContent;
  expect(name()).toBe("gpt-test");
  expect(node.querySelector<HTMLButtonElement>(".assistant-card button")?.disabled).toBe(false);
  expect(rpc.mock.calls.filter(([method]) => method === "models.list")).toHaveLength(1);
  expect(rpc.mock.calls.some(([method]) => method === "projects.list")).toBe(false);
  await act(async () => {
    if (failed) rejectModels(new Error("Catalog unavailable"));
    else resolveModels({ models: { codex: [{ harness: "codex", id: "codex:gpt-test", name: "GPT-Test" }] }, errors: {} });
  });
  await flush();
  expect(name()).toBe(failed ? "gpt-test" : "GPT-Test");
  expect(node.querySelector(".assistant-error")).toBeNull();
  expect(message.model).toBe("codex:gpt-test");
});
it("renders only public replies and one updated card without transcript logs", async () => {
  const card: BotMessage = {
    kind: "session-card",
    id: "card",
    revision: 2,
    createdAt: 1,
    ref: { environmentId: "host", projectId: "project", sessionId: "target" },
    title: "Fix test",
    projectName: "Project",
    harness: "codex",
    model: "test",
    actionId: "a",
    status: "queued",
  };
  const messages: BotMessage[] = [
    {
      kind: "assistant",
      id: "reply",
      revision: 1,
      createdAt: 1,
      text: "Task started",
    },
    card,
    { ...card, revision: 3, status: "running" },
  ];
  const view = {
    id: "a",
    name: "Assistant",
    lifecycle: "idle",
    revision: 1,
    enabled: true,
    triggers: { user: true, event: true, schedule: true },
    brainGeneration: 1,
    policy: fullBotPolicy(),
  };
  const rpc = vi.fn(async (method: string) =>
    method === "environment.describe"
      ? { capabilities: ["assistant.v1"] }
      : method === "assistant.get"
        ? { ...view }
        : method === "assistant.messages"
          ? { entries: messages, nextRevision: 3, hasMore: false }
          : method === "models.list"
            ? { models: {}, errors: {} }
            : [],
  );
  act(() =>
    root.render(
      createElement(BotChat, {
        hostKey: "host",
        hostName: "Host",
        rpc: rpc as any,
        onOpen: () => {},
      }),
    ),
  );
  await flush();
  expect(node.querySelectorAll('[data-session-id="target"]')).toHaveLength(1);
  expect(node.textContent).toContain("Task started");
  const runningStatus = node.querySelector('.assistant-card [role="status"]')!;
  expect(runningStatus.getAttribute("aria-label")).toBe("Running");
  expect(runningStatus.textContent).toBe("");
  expect(runningStatus.querySelector("svg.animate-spin")).not.toBeNull();
  expect(node.querySelectorAll(".tool-block, .reasoning-block")).toHaveLength(
    0,
  );
  expect(
    rpc.mock.calls.some(
      ([method]) => method === "events.read" || method === "sessions.sync",
    ),
  ).toBe(false);
  const cardButton = node.querySelector<HTMLButtonElement>(
    ".assistant-card button",
  )!;
  expect(cardButton.disabled).toBe(false);
  view.policy = { ...fullBotPolicy(), allowedProjects: [] };
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  await flush();
  expect(cardButton.disabled).toBe(true);
  act(() => cardButton.click());
  expect(rpc.mock.calls.some(([method]) => method === "sessions.get")).toBe(
    false,
  );
});
it("updates one streaming bubble during a turn and settles it without interrupting history reading", async () => {
  const reply = {
    kind: "assistant",
    id: "stream",
    revision: 1,
    createdAt: 1,
    text: "Hello",
    streaming: true,
  };
  const view = {
    id: "a",
    name: "Assistant",
    lifecycle: "running",
    revision: 1,
    enabled: true,
    triggers: { user: true, event: false, schedule: false },
    brainGeneration: 1,
    policy: fullBotPolicy(),
  };
  const rpc = vi.fn(async (method: string) =>
    method === "environment.describe"
      ? { capabilities: ["assistant.v1"] }
      : method === "assistant.get"
        ? { ...view }
        : method === "assistant.messages"
          ? {
              entries: [{ ...reply }],
              nextRevision: reply.revision,
              hasMore: false,
            }
          : method === "models.list"
            ? { models: {}, errors: {} }
            : [],
  );
  act(() =>
    root.render(
      createElement(BotChat, {
        hostKey: "stream",
        hostName: "Host",
        rpc: rpc as any,
        onOpen: () => {},
      }),
    ),
  );
  await flush();
  const bubble = node.querySelector(".assistant-message-assistant")!;
  expect(bubble.getAttribute("data-streaming")).toBe("true");
  expect(node.querySelector(".assistant-working")).toBeNull();
  const log = node.querySelector<HTMLDivElement>(".assistant-messages")!;
  Object.defineProperty(log, "scrollHeight", { value: 1000 });
  Object.defineProperty(log, "clientHeight", { value: 200 });
  log.scrollTop = 100;
  const scroll = vi.fn();
  log.scrollTo = scroll;
  act(() => log.dispatchEvent(new Event("scroll")));
  reply.text = "Hello world";
  reply.revision++;
  await act(async () => {
    vi.advanceTimersByTime(250);
  });
  await flush();
  expect(node.querySelectorAll(".assistant-message-assistant")).toHaveLength(1);
  expect(node.querySelector(".assistant-message-assistant")).toBe(bubble);
  expect(scroll).not.toHaveBeenCalled();
  reply.streaming = false;
  reply.revision++;
  view.lifecycle = "idle";
  await act(async () => {
    vi.advanceTimersByTime(250);
  });
  await flush();
  // Paced text arms its next tick after each commit, so let React commit between ticks.
  for (let elapsed = 0; elapsed < 500; elapsed += 25)
    await act(async () => vi.advanceTimersByTime(25));
  expect(bubble.hasAttribute("data-streaming")).toBe(false);
  expect(bubble.textContent).toContain("Hello world");
  expect(node.querySelector(".assistant-working")).toBeNull();
});
it("defaults to all permissions and animates permission disclosure in both directions", async () => {
  let saved: BotPatch | undefined;
  act(() =>
    root.render(
      createElement(BotSettings, {
        value: null,
        catalog: {
          models: { codex: [{ id: "test", name: "Test" }] },
          errors: {},
        },
        projects: [],
        busy: false,
        onSave: async (value) => {
          saved = value;
        },
      }),
    ),
  );
  const button = disclosure("Assistant permissions");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  const fold = () =>
    button.closest("section")!.querySelector(":scope > .zen-fold-item");
  act(() => button.click());
  expect(fold()?.getAttribute("data-fold-state")).toBe("opening");
  const checks = [
    ...node.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ];
  expect(checks).toHaveLength(20);
  expect(checks.every((input) => input.checked)).toBe(true);
  act(() =>
    node
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(saved?.policy).toEqual(fullBotPolicy());
  expect(saved?.runtimeMode).toBe("full-access");
  act(() => button.click());
  expect(fold()?.getAttribute("data-fold-state")).toBe("closing");
  expect((fold() as HTMLElement | null)?.inert).toBe(true);
  act(() => button.click());
  expect(fold()?.getAttribute("data-fold-state")).toBe("opening");
  act(() => button.click());
  await act(async () => { await finishMotion(); });
  expect(fold()).toBeNull();
});
it("localizes settings and honors reduced motion", () => {
  setUiLanguage("zh-CN");
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
  } as MediaQueryList);
  act(() =>
    root.render(
      createElement(BotSettings, {
        value: null,
        catalog: { models: {}, errors: {} },
        projects: [],
        busy: false,
        onSave: async () => {},
      }),
    ),
  );
  expect(
    [...node.querySelectorAll("h3")].map((heading) => heading.textContent),
  ).toEqual(["助理", "模型"]);
  expect(disclosure("助理唤醒").getAttribute("aria-expanded")).toBe("false");
  const button = disclosure("助理权限");
  const fold = () =>
    button.closest("section")!.querySelector(":scope > .zen-fold-item");
  act(() => button.click());
  expect(fold()?.getAttribute("data-fold-state")).toBe("open");
  act(() => button.click());
  expect(fold()).toBeNull();
});

function setValue(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype = Object.getPrototypeOf(input);
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function rename(value: string) {
  const name = [...node.querySelectorAll("label")]
    .find((l) => (l.textContent?.startsWith("Assistant name") || l.textContent?.startsWith("Name")))!
    .querySelector("input")!;
  setValue(name, value);
}
function configuredView(): BotConfiguration {
  return {
    id: "a",
    name: "Assistant",
    revision: 1,
    chatRevision: 0,
    enabled: true,
    lifecycle: "idle",
    harness: "codex",
    model: "test",
    modelSettings: {},
    runtimeMode: "full-access",
    targetRuntimeMode: "full-access",
    policy: fullBotPolicy(),
    policyVersion: 1,
    triggers: { user: true, event: true, schedule: true },
    schedules: [],
    watches: [],
    maxAutoTurns: 8,
    chainWindowMinutes: 15,
    brainGeneration: 1,
  };
}
it("keeps the edited settings revision until an explicit reload after a competing save", async () => {
  let view = configuredView();
  const rpc = vi.fn(
    async (method: string, params?: Record<string, unknown>) => {
      if (method === "environment.describe")
        return { capabilities: ["assistant.v1"] };
      if (method === "assistant.get") return view;
      if (method === "assistant.messages")
        return { entries: [], nextRevision: 0, hasMore: false };
      if (method === "models.list")
        return {
          models: { codex: [{ id: "test", name: "Test" }] },
          errors: {},
        };
      if (method === "assistant.configure") {
        if (params?.expectedRevision !== view.revision)
          throw new Error("Assistant settings changed. Reload before saving.");
        return { revision: view.revision + 1 };
      }
      return [];
    },
  );
  act(() =>
    root.render(
      createElement(BotChat, {
        hostKey: "host",
        hostName: "Host",
        rpc: rpc as any,
        onOpen: () => {},
      }),
    ),
  );
  await flush();
  act(() =>
    node.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click(),
  );
  view = { ...view, revision: 2, name: "Changed elsewhere" };
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  await flush();
  const submit = () => {
    rename(`Renamed ${Math.random()}`);
    node
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  };
  act(submit);
  await flush();
  expect(node.querySelector('[role="alert"]')?.textContent).toContain(
    "settings changed",
  );
  const toasts = () =>
    document.querySelector("[data-status-toast-host]")?.textContent ?? "";
  expect(toasts()).not.toContain("Assistant settings saved");
  expect(
    rpc.mock.calls.find(([method]) => method === "assistant.configure")?.[1]
      ?.expectedRevision,
  ).toBe(1);
  act(() =>
    [...node.querySelectorAll("button")]
      .find((b) => b.textContent === "Reload settings")!
      .click(),
  );
  act(submit);
  await flush();
  expect(
    rpc.mock.calls
      .filter(([method]) => method === "assistant.configure")
      .at(-1)?.[1]?.expectedRevision,
  ).toBe(2);
  expect(toasts()).toContain("Assistant settings saved");
});
it("retries an uncertain desktop Bot settings save with the same receipt identity", async () => {
  const base = chatRpc(configuredView());
  let first = true;
  const rpc = vi.fn(async (method: string, params?: object) => {
    if (method === "environment.describe") return { capabilities: ["assistant.v1", "bots.shell.v1"] };
    if (method === "assistant.configure") {
      if (first) { first = false; throw new Error("Connection interrupted"); }
      return { accepted: true };
    }
    return base(method, params);
  });
  act(() => root.render(createElement(BotChat, {
    hostKey: "host", hostName: "Host", rpc: rpc as any, onOpen: () => {}, desktopBots: true,
  })));
  await flush();
  act(() => node.querySelector<HTMLButtonElement>('[aria-label="Bot details"]')!.click());
  await flush();
  act(() => rename("Edited Bot"));
  const submit = () => node.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  act(submit);
  await flush();
  expect(node.textContent).toContain("Connection interrupted");
  act(submit);
  await flush();
  const attempts = rpc.mock.calls.filter(([method]) => method === "assistant.configure");
  expect(attempts).toHaveLength(2);
  expect(attempts[0][1]).toEqual(attempts[1][1]);
});
it("sends necessary input with its exact run and generation rather than a chat prompt", async () => {
  const input: BotMessage = {
    id: "approval",
    kind: "input",
    revision: 1,
    createdAt: 1,
    text: "Allow execution?",
    inputKind: "approval",
    brainGeneration: 3,
    runId: "current-run",
    requestId: 7,
    resolved: false,
  };
  const rpc = vi.fn(async (method: string, _params?: object) => {
    if (method === "environment.describe")
      return { capabilities: ["assistant.v1"] };
    if (method === "assistant.get") return configuredView();
    if (method === "assistant.messages")
      return { entries: [input], nextRevision: 1, hasMore: false };
    if (method === "models.list") return { models: {}, errors: {} };
    return [];
  });
  act(() =>
    root.render(
      createElement(BotChat, {
        hostKey: "host",
        hostName: "Host",
        rpc: rpc as any,
        onOpen: () => {},
      }),
    ),
  );
  await flush();
  act(() =>
    [...node.querySelectorAll("button")]
      .find((b) => b.textContent === "Allow")!
      .click(),
  );
  await flush();
  expect(
    rpc.mock.calls.find(([method]) => method === "assistant.respond")?.[1],
  ).toMatchObject({
    messageId: "approval",
    brainGeneration: 3,
    runId: "current-run",
    requestId: 7,
    decision: "allow",
  });
  expect(rpc.mock.calls.some(([method]) => method === "assistant.send")).toBe(
    false,
  );
});

it("shows the stored answer inside a resolved question card", async () => {
  const question: BotMessage = {
    id: "question", kind: "input", revision: 1, createdAt: 1, text: "Which account?", inputKind: "question",
    brainGeneration: 1, runId: "run", requestId: 2, resolved: true,
    question: { requestId: 2, questions: [{ id: "q", prompt: "Which account?", multiSelect: false, allowCustom: true, options: [] }] },
    reply: { kind: "answered", answers: { q: ["__custom__"] }, custom: { q: "@tibo, latest 20" } },
  };
  const approval: BotMessage = { ...question, id: "approval", createdAt: 2, inputKind: "approval", question: undefined, reply: undefined, text: "Run?", decision: "deny" };
  const legacy: BotMessage = { ...approval, id: "legacy", createdAt: 3, decision: undefined };
  act(() => root.render(createElement(BotChat, { hostKey: "host", hostName: "Host", rpc: chatRpc(configuredView(), [question, approval, legacy]) as any, onOpen: () => {} })));
  await flush();
  const cards = [...node.querySelectorAll(".assistant-input")];
  expect(cards[0].querySelector(".assistant-input-answer")?.textContent).toBe("@tibo, latest 20");
  expect(cards[0].querySelector("dt")).toBeNull();
  expect(cards[1].querySelector(".assistant-input-answer")?.textContent).toBe("Denied");
  expect(cards[2].querySelector(".assistant-pill")?.textContent).toBe("Resolved");
});

function chatRpc(view: BotConfiguration, entries: BotMessage[] = []) {
  return vi.fn(async (method: string, _params?: object) => {
    if (method === "environment.describe")
      return { capabilities: ["assistant.v1"] };
    if (method === "assistant.get") return view;
    if (method === "assistant.messages")
      return { entries, nextRevision: entries.length, hasMore: false };
    if (method === "assistant.send") return { accepted: true };
    if (method === "models.list")
      return { models: { codex: [{ id: "test", name: "Test" }] }, errors: {} };
    return [];
  });
}
it("centers timestamps before the first message and gaps of at least five minutes without regrouping revisions", async () => {
  setUiLanguage("zh-CN");
  const start = new Date(2026, 9, 5, 14, 52).getTime();
  const messages: BotMessage[] = [0, 299999, 599998, 899998].map(
    (offset, index) => ({
      kind: "user",
      id: `message-${index}`,
      revision: index + 1,
      createdAt: start + offset,
      text: `Message ${index}`,
      readAt: null,
    }),
  );
  const rpc = chatRpc(configuredView(), messages);
  act(() =>
    root.render(
      createElement(BotChat, {
        hostKey: "dates",
        hostName: "Host",
        rpc: rpc as any,
        onOpen: () => {},
      }),
    ),
  );
  await flush();
  const separators = () => [
    ...node.querySelectorAll<HTMLTimeElement>(".assistant-date-separator"),
  ];
  expect(separators().map((time) => time.dateTime)).toEqual([
    new Date(start).toISOString(),
    new Date(start + 899998).toISOString(),
  ]);
  expect(separators()[0].textContent).toContain("10月5日");
  expect(separators()[0].textContent).toContain("14:52");
  expect(separators()[1].nextElementSibling?.textContent).toContain(
    "Message 3",
  );
  expect(separators()[0].parentElement?.getAttribute("role")).toBe("log");
  messages[3] = {
    ...messages[3],
    revision: 5,
    readAt: start + 900000,
  } as BotMessage;
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  await flush();
  expect(separators()).toHaveLength(2);
  expect(separators()[1].dateTime).toBe(new Date(start + 899998).toISOString());
});
it("renders assistant replies as Markdown and keeps user text literal", async () => {
  const rpc = chatRpc(configuredView(), [
    { kind: "user", id: "u", revision: 1, createdAt: 1, text: "**literal**" },
    {
      kind: "assistant",
      id: "a",
      revision: 2,
      createdAt: 2,
      text: "Done with **two** tasks",
    },
  ] as BotMessage[]);
  act(() =>
    root.render(
      createElement(BotChat, {
        hostKey: "host",
        hostName: "Host",
        rpc: rpc as any,
        onOpen: () => {},
      }),
    ),
  );
  await flush();
  expect(
    node.querySelector(
      '.assistant-message-assistant [data-streamdown="strong"]',
    )?.textContent,
  ).toBe("two");
  expect(
    node.querySelector(".assistant-message-user > span")?.textContent,
  ).toBe("**literal**");
});
it("quotes a reply from the desktop context menu without replacing the draft or sending early", async () => {
  const rpc = chatRpc(configuredView(), [
    {
      kind: "assistant",
      id: "reply",
      revision: 1,
      createdAt: 1,
      text: "First line\nSecond **line**",
    },
  ]);
  act(() =>
    root.render(
      createElement(BotChat, {
        hostKey: "host",
        hostName: "Host",
        rpc: rpc as any,
        onOpen: () => {},
      }),
    ),
  );
  await flush();
  const field = node.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Message assistant"]',
  )!;
  act(() => setValue(field, "Please expand"));
  const bubble = node.querySelector(".assistant-message-assistant")!;
  act(() =>
    bubble.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 80,
        clientY: 100,
      }),
    ),
  );
  const menu = document.querySelector('[role="menu"][aria-label="Reply"]')!;
  expect(menu).not.toBeNull();
  expect(Number((menu.parentElement as HTMLElement).style.zIndex)).toBe(
    LAYER.popover,
  );
  act(() =>
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click(),
  );
  expect(field.value).toBe("> First line\n> Second **line**\n\nPlease expand");
  expect(document.activeElement).toBe(field);
  expect(
    document.querySelector('[role="menu"][aria-label="Reply"]'),
  ).toBeNull();
  expect(rpc.mock.calls.some(([method]) => method === "assistant.send")).toBe(
    false,
  );
  act(() =>
    field.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await flush();
  expect(
    rpc.mock.calls.find(([method]) => method === "assistant.send")?.[1],
  ).toMatchObject({ text: "> First line\n> Second **line**\n\nPlease expand" });
});
it("closes the reply portal when its workspace page is hidden and retains the draft", async () => {
  const rpc = chatRpc(configuredView(), [
    {
      kind: "assistant",
      id: "reply",
      revision: 1,
      createdAt: 1,
      text: "Hello",
    },
  ]);
  const render = (visible: boolean) =>
    act(() =>
      root.render(
        createElement(
          SurfaceVisibilityContext.Provider,
          { value: visible },
          createElement(BotChat, {
            hostKey: "host",
            hostName: "Host",
            rpc: rpc as any,
            onOpen: () => {},
          }),
        ),
      ),
    );
  render(true);
  await flush();
  const field = node.querySelector<HTMLTextAreaElement>("textarea")!;
  act(() => setValue(field, "Keep draft"));
  act(() =>
    node
      .querySelector(".assistant-message-assistant")!
      .dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
  );
  expect(
    document.querySelector('[role="menu"][aria-label="Reply"]'),
  ).not.toBeNull();
  render(false);
  expect(
    document.querySelector('[role="menu"][aria-label="Reply"]'),
  ).toBeNull();
  render(true);
  await flush();
  expect(node.querySelector("textarea")).toBe(field);
  expect(field.value).toBe("Keep draft");
});
it("sends on Enter but not on Shift+Enter in the desktop composer", async () => {
  const rpc = chatRpc(configuredView());
  act(() =>
    root.render(
      createElement(BotChat, {
        hostKey: "host",
        hostName: "Host",
        rpc: rpc as any,
        onOpen: () => {},
      }),
    ),
  );
  await flush();
  const field = node.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Message assistant"]',
  )!;
  act(() => setValue(field, "Check progress"));
  const key = (shiftKey: boolean) =>
    act(() => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  key(true);
  await flush();
  expect(rpc.mock.calls.some(([m]) => m === "assistant.send")).toBe(false);
  key(false);
  await flush();
  expect(rpc.mock.calls.some(([m]) => m === "assistant.send")).toBe(true);
});
it.each([false, true])("shows desktop send loading until delivery succeeds or fails (failure: %s)", async (failed) => {
  const base = chatRpc(configuredView());
  let finish!: () => void;
  let pending = new Promise<void>((resolve) => { finish = resolve; });
  let fail = failed;
  const rpc = vi.fn(async (method: string, params?: object) => {
    if (method === "assistant.send") {
      await pending;
      if (fail) throw new Error("Host disconnected");
    }
    return base(method, params);
  });
  act(() => root.render(createElement(BotChat, {
    hostKey: "host", hostName: "Host", rpc: rpc as any, onOpen: () => {},
  })));
  await flush();
  const field = node.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message assistant"]')!;
  act(() => setValue(field, "Send this message"));
  const send = node.querySelector<HTMLButtonElement>(".assistant-send")!;
  const expectLoading = () => {
    expect(send.getAttribute("aria-busy")).toBe("true");
    expect(send.getAttribute("aria-label")).toBe("Sending...");
    expect(send.querySelector(".animate-spin")).not.toBeNull();
    expect(send.disabled).toBe(true);
    expect(field.value).toBe("Send this message");
  };
  const expectIdle = () => {
    expect(send.getAttribute("aria-busy")).toBeNull();
    expect(send.getAttribute("aria-label")).toBe("Send");
    expect(send.querySelector(".animate-spin")).toBeNull();
  };
  act(() => send.click());
  expectLoading();
  act(() => {
    send.click();
    send.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(rpc.mock.calls.filter(([method]) => method === "assistant.send")).toHaveLength(1);
  finish();
  await flush();
  expectIdle();
  expect(field.value).toBe(failed ? "Send this message" : "");
  if (failed) {
    fail = false;
    pending = new Promise<void>((resolve) => { finish = resolve; });
    act(() => [...node.querySelectorAll<HTMLButtonElement>("button")]
      .find(button => button.textContent === "Retry message")!.click());
    expectLoading();
    finish();
    await flush();
    expectIdle();
    expect(field.value).toBe("");
  }
});
it("retains a failed send's draft and clears its saved text immediately after a successful retry", async () => {
  const key = "omnicode.assistant-draft:host";
  localStorage.setItem(key, "Saved before typing");
  const base = chatRpc(configuredView());
  let fail = true;
  const rpc = vi.fn(async (method: string, params?: object) => {
    if (method === "assistant.send" && fail) throw new Error("Host disconnected");
    return base(method, params);
  });
  act(() => root.render(createElement(BotChat, {
    hostKey: "host", hostName: "Host", rpc: rpc as any, onOpen: () => {},
  })));
  await flush();
  const field = node.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message assistant"]')!;
  expect(field.value).toBe("Saved before typing");
  act(() => setValue(field, "Retry this exact draft"));
  const send = () => act(() => field.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter", bubbles: true, cancelable: true,
  })));
  send();
  await flush();
  expect(field.value).toBe("Retry this exact draft");
  expect(localStorage.getItem(key)).toBe("Saved before typing");
  act(() => vi.advanceTimersByTime(300));
  expect(localStorage.getItem(key)).toBe("Retry this exact draft");
  fail = false;
  act(() => [...node.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent === "Retry message")!.click());
  await flush();
  expect(field.value).toBe("");
  expect(localStorage.getItem(key)).toBe("");
  act(() => vi.advanceTimersByTime(300));
  expect(localStorage.getItem(key)).toBe("");
});
it("enables saving only for changed, valid settings", () => {
  const onSave = vi.fn(async () => {});
  act(() =>
    root.render(
      createElement(BotSettings, {
        value: configuredView(),
        catalog: {
          models: { codex: [{ id: "test", name: "Test" }] },
          errors: {},
        },
        projects: [],
        busy: false,
        onSave,
      }),
    ),
  );
  const save = [...node.querySelectorAll("button")].find(
    (b) => b.textContent === "Save settings",
  )!;
  expect(save.disabled).toBe(true);
  act(() => rename("Helper"));
  expect(save.disabled).toBe(false);
  act(() => disclosure("Assistant wakeups").click());
  const interval = node.querySelector<HTMLInputElement>(
    'input[aria-label="Interval"]',
  )!;
  act(() => setValue(interval, "0"));
  expect(interval.getAttribute("aria-invalid")).toBe("true");
  act(() => save.click());
  expect(onSave).not.toHaveBeenCalled();
  act(() => vi.runOnlyPendingTimers());
  expect(document.activeElement).toBe(interval);
  act(() => setValue(interval, "2"));
  act(() =>
    node
      .querySelector<HTMLButtonElement>('button[aria-label^="Interval unit"]')!
      .click(),
  );
  act(() =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((o) => o.textContent?.includes("Hours"))!
      .click(),
  );
  act(() => save.click());
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "Helper",
      schedules: [expect.objectContaining({ intervalMinutes: 120 })],
    }),
  );
});
it.each(["maxAutoTurns", "chainWindowMinutes"] as const)(
  "reveals wakeups and More options for invalid %s before focusing the field",
  (key) => {
    const onSave = vi.fn(async () => {});
    act(() =>
      root.render(
        createElement(BotSettings, {
          value: { ...configuredView(), [key]: 0 },
          catalog: {
            models: { codex: [{ id: "test", name: "Test" }] },
            errors: {},
          },
          projects: [],
          busy: false,
          onSave,
        }),
      ),
    );
    expect(disclosure("Assistant wakeups").getAttribute("aria-expanded")).toBe("false");
    expect(disclosure("More options")).toBeUndefined();
    act(() => rename("Helper"));
    act(() => disclosure("Save settings").click());
    expect(onSave).not.toHaveBeenCalled();
    expect(disclosure("Assistant wakeups").getAttribute("aria-expanded")).toBe("true");
    expect(disclosure("More options").getAttribute("aria-expanded")).toBe("true");
    act(() => vi.runOnlyPendingTimers());
    expect(document.activeElement).toBe(node.querySelector('[aria-invalid="true"]'));
  },
);
it("offers Continue inside an interruption notice", async () => {
  const rpc = chatRpc({
    ...configuredView(),
    lifecycle: "interrupted",
    error: "Host restarted while the assistant was working.",
  });
  act(() =>
    root.render(
      createElement(BotChat, {
        hostKey: "host",
        hostName: "Host",
        rpc: rpc as any,
        onOpen: () => {},
      }),
    ),
  );
  await flush();
  const notice = node.querySelector('[role="alert"]')!;
  act(() =>
    [...notice.querySelectorAll("button")]
      .find((b) => b.textContent === "Continue")!
      .click(),
  );
  await flush();
  expect(
    rpc.mock.calls.find(([m]) => m === "assistant.control")?.[1],
  ).toMatchObject({ action: "resume", expectedGeneration: 1 });
});
it("explains an unsupported Host bridge and reconnects on retry", async () => {
  const base = chatRpc(configuredView());
  let rejected = false;
  const rpc = vi.fn(async (method: string, params?: object) => {
    if (method === "environment.describe" && !rejected) {
      rejected = true;
      throw "Unsupported remote operation";
    }
    return base(method, params);
  });
  act(() =>
    root.render(
      createElement(BotChat, {
        hostKey: "host",
        hostName: "Host",
        rpc: rpc as any,
        onOpen: () => {},
      }),
    ),
  );
  await flush();
  const notice = node.querySelector('[role="alert"]')!;
  expect(notice.textContent).toContain("Update OmniCode");
  expect(notice.textContent).not.toContain("Unsupported remote operation");
  act(() =>
    [...notice.querySelectorAll("button")]
      .find((b) => b.textContent === "Retry")!
      .click(),
  );
  await flush();
  expect(
    rpc.mock.calls.filter(([m]) => m === "environment.describe"),
  ).toHaveLength(2);
  expect(node.querySelector(".assistant-conversation")).not.toBeNull();
});

it("only acknowledges messages while the assistant page and document are visible", async () => {
  const rpc = chatRpc(configuredView(), [
    { kind: "assistant", id: "reply", revision: 1, createdAt: 1, text: "Hello" },
  ]);
  const render = (visible: boolean) => act(() => root.render(
    createElement(SurfaceVisibilityContext.Provider, { value: visible },
      createElement(BotChat, { hostKey: "read-host", hostName: "Host", rpc: rpc as any, onOpen: () => {} })),
  ));
  const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  try {
    render(false);
    await flush();
    expect(localStorage.getItem("omnicode.assistant-read:read-host")).toBeNull();
    render(true);
    await flush();
    expect(localStorage.getItem("omnicode.assistant-read:read-host")).toBeNull();
    state.mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(localStorage.getItem("omnicode.assistant-read:read-host")).toBe("1");
  } finally {
    state.mockRestore();
  }
});
it("paints the newest history first and adds older rows near the top", async () => {
  // A tall log: the newest rows already fill the viewport.
  const height = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get")
    .mockImplementation(function () { return this.classList.contains("assistant-messages") ? 5000 : 0; });
  const viewport = vi.spyOn(HTMLElement.prototype, "clientHeight", "get")
    .mockImplementation(function () { return this.classList.contains("assistant-messages") ? 600 : 0; });
  const view = {
    id: "a",
    name: "Assistant",
    lifecycle: "idle",
    revision: 1,
    enabled: true,
    triggers: { user: true, event: false, schedule: false },
    brainGeneration: 1,
    policy: fullBotPolicy(),
  };
  const entries = Array.from({ length: 75 }, (_, index) => ({
    id: `m${index}`,
    kind: "user" as const,
    text: `Message ${index}`,
    createdAt: index + 1,
    revision: index + 1,
  }));
  const rpc = vi.fn(async (method: string) =>
    method === "environment.describe"
      ? { capabilities: ["assistant.v1"] }
      : method === "assistant.get"
        ? view
        : method === "assistant.messages"
          ? { entries, nextRevision: 75, hasMore: false }
          : method === "models.list"
            ? { models: {}, errors: {} }
            : [],
  );
  act(() =>
    root.render(
      createElement(BotChat, {
        hostKey: "history",
        hostName: "Host",
        rpc: rpc as any,
        onOpen: () => {},
      }),
    ),
  );
  await flush();
  const rows = () => node.querySelectorAll(".assistant-message-user");
  expect(rows()).toHaveLength(30);
  expect(rows()[29]?.textContent).toContain("Message 74");
  const log = node.querySelector<HTMLDivElement>(".assistant-messages")!;
  log.scrollTop = 4400;
  await act(async () => log.dispatchEvent(new Event("scroll")));
  expect(rows()).toHaveLength(30);
  expect(log.dataset.followLatest).toBe("true");
  // Scrolling up stops following before the snap distance is left.
  log.scrollTop = 4380;
  await act(async () => log.dispatchEvent(new Event("scroll")));
  expect(log.dataset.followLatest).toBe("false");
  log.scrollTop = 4390;
  await act(async () => log.dispatchEvent(new Event("scroll")));
  expect(log.dataset.followLatest).toBe("true");
  for (const _ of [1, 2]) {
    log.scrollTop = 100;
    await act(async () => log.dispatchEvent(new Event("scroll")));
  }
  expect(rows()).toHaveLength(75);
  expect(rows()[0]?.textContent).toContain("Message 0");
  height.mockRestore();
  viewport.mockRestore();
});
it.each([false, true])("opens a paged chat before older history and defers catalog discovery until settings (mobile: %s)", async (mobile) => {
  const height = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get")
    .mockImplementation(function () { return this.classList.contains("assistant-messages") ? 5000 : 0; });
  const viewport = vi.spyOn(HTMLElement.prototype, "clientHeight", "get")
    .mockImplementation(function () { return this.classList.contains("assistant-messages") ? 600 : 0; });
  const getRect = HTMLElement.prototype.getBoundingClientRect;
  const geometry = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function () {
      const parent = this.parentElement;
      if (parent?.classList.contains("assistant-messages"))
        return new DOMRect(0, [...parent.children].indexOf(this) * 100 - parent.scrollTop, 300, 100);
      if (this.classList.contains("assistant-messages")) return new DOMRect(0, 0, 300, 600);
      return getRect.call(this);
    });
  try {
    const view = { ...configuredView(), chatRevision: 75 };
    const entries: BotMessage[] = Array.from({ length: 75 }, (_, index) => ({
      id: `m${index}`, kind: index === 20 ? "assistant" : "user",
      text: index === 20 ? "An older reply should appear immediately without replaying its text animation." : `Message ${index}`,
      createdAt: index + 1, revision: index + 1,
    }));
    let resolveOlder!: (page: BotHistory) => void;
    const older = new Promise<BotHistory>((resolve) => { resolveOlder = resolve; });
    const rpc = vi.fn(async (method: string, params?: any) => {
      if (method === "environment.describe") return { capabilities: ["assistant.v1", "assistant.history"] };
      if (method === "assistant.get") return view;
      if (method === "assistant.messages") {
        expect(params.latest).toBe(true);
        if (params.before?.id === "m45") return older;
        const end = params.before ? Number(params.before.id.slice(1)) : 75;
        const start = Math.max(0, end - params.limit);
        return { assistant: view, entries: entries.slice(start, end), hasMore: start > 0,
          nextCursor: { createdAt: start + 1, id: `m${start}` } };
      }
      if (method === "models.list") return { models: { codex: [{ id: "test", name: "Test" }] }, errors: {} };
      if (method === "projects.list") return [];
      throw new Error(`Unexpected method: ${method}`);
    });
    act(() => root.render(createElement(mobile ? MobileAssistant : BotChat, {
      hostKey: "paged", hostName: "Host", rpc: rpc as any, onOpen: () => {},
    })));
    await flush();
    expect(node.querySelectorAll(".assistant-message-row")).toHaveLength(30);
    expect(node.textContent).toContain("Message 74");
    expect(node.textContent).not.toContain("Message 0");
    expect(rpc.mock.calls.map(([method]) => method)).toEqual(["environment.describe", "assistant.messages"]);
    const log = node.querySelector<HTMLDivElement>(".assistant-messages")!;
    log.scrollTop = 100;
    act(() => {
      log.dispatchEvent(new Event("scroll"));
      log.dispatchEvent(new Event("scroll"));
    });
    const anchored = [...log.querySelectorAll<HTMLElement>(".assistant-message-row")]
      .find((row) => row.textContent?.includes("Message 50"))!;
    const anchorTop = anchored.getBoundingClientRect().top;
    await flush();
    expect(node.querySelectorAll(".assistant-message-row")).toHaveLength(30);
    expect(rpc.mock.calls.filter(([method]) => method === "assistant.messages")).toHaveLength(2);
    await act(async () => resolveOlder({ assistant: view, entries: entries.slice(15, 45), hasMore: true,
      nextCursor: { createdAt: 16, id: "m15" } }));
    await flush();
    expect(node.querySelectorAll(".assistant-message-row")).toHaveLength(60);
    expect(anchored.getBoundingClientRect().top).toBe(anchorTop);
    expect(node.querySelector(".assistant-markdown")?.textContent).toContain(entries[20].kind === "assistant" && entries[20].text);
    log.scrollTop = 100;
    act(() => log.dispatchEvent(new Event("scroll")));
    await flush();
    expect(node.querySelectorAll(".assistant-message-row")).toHaveLength(75);
    expect(node.querySelector(".assistant-history-loading")).toBeNull();
    if (mobile) {
      act(() => node.querySelector<HTMLButtonElement>('[aria-label="Assistant options"]')!.click());
      act(() => [...document.querySelectorAll<HTMLButtonElement>("button.mobile-sheet-row")]
        .find((button) => button.textContent === "Settings")!.click());
    } else act(() => node.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click());
    await flush();
    expect(rpc.mock.calls.filter(([method]) => method === "models.list")).toHaveLength(1);
    expect(rpc.mock.calls.filter(([method]) => method === "projects.list")).toHaveLength(1);
  } finally {
    height.mockRestore();
    viewport.mockRestore();
    geometry.mockRestore();
  }
});
it("offers a retry when the first history read fails and keeps legacy Hosts on incremental sync", async () => {
  const view = configuredView();
  const rpc = vi.fn().mockResolvedValueOnce({ capabilities: ["assistant.v1", "assistant.history"] })
    .mockRejectedValueOnce(new Error("Host connection failed"))
    .mockResolvedValueOnce({ capabilities: ["assistant.v1"] })
    .mockResolvedValueOnce(view)
    .mockResolvedValueOnce({ entries: [], nextRevision: 0, hasMore: false });
  act(() => root.render(createElement(BotChat, {
    hostKey: "retry-history", hostName: "Host", rpc: rpc as any, onOpen: () => {},
  })));
  await flush();
  expect(node.querySelector(".assistant-loading")).toBeNull();
  act(() => [...node.querySelectorAll<HTMLButtonElement>('[role="alert"] button')]
    .find((button) => button.textContent === "Retry")!.click());
  await flush();
  expect(node.querySelector(".assistant-conversation")).not.toBeNull();
  expect(rpc.mock.calls.filter(([method]) => method === "assistant.messages")).toEqual([
    ["assistant.messages", { latest: true, limit: 30 }],
    ["assistant.messages", { afterRevision: 0, limit: 100 }],
  ]);
});

it.each([false, true])("enables the desktop Bots shell only with its Host capability (%s)", async (supported) => {
  const base = chatRpc(configuredView());
  const rpc = vi.fn(async (method: string, params?: object) => method === "environment.describe"
    ? { capabilities: ["assistant.v1", ...(supported ? ["bots.shell.v1"] : [])] }
    : base(method, params));
  act(() => root.render(createElement(BotChat, {
    hostKey: "host", hostName: "Host", rpc: rpc as any, onOpen: () => {}, desktopBots: true,
  })));
  await flush();
  expect(!!node.querySelector(".desktop-bots-workspace")).toBe(supported);
  expect(node.querySelector(".assistant-chat")?.getAttribute("data-layout")).toBe("desktop");
  expect(!!node.querySelector('[aria-label="Bot details"]')).toBe(supported);
  expect(base.mock.calls.some(([method]) => method === "assistant.get")).toBe(true);
  expect(rpc.mock.calls.some(([method]) => method.startsWith("bots."))).toBe(false);
});

it.each(["idle", "running"] as const)("jumps back to the latest Bot message with the shared button (%s)", async (lifecycle) => {
  const base = chatRpc({ ...configuredView(), lifecycle });
  const rpc = vi.fn(async (method: string, params?: object) => method === "environment.describe"
    ? { capabilities: ["assistant.v1", "bots.shell.v1"] }
    : base(method, params));
  act(() => root.render(createElement(BotChat, {
    hostKey: "jump", hostName: "Host", rpc: rpc as any, onOpen: () => {}, desktopBots: true,
  })));
  await flush();
  const log = node.querySelector<HTMLDivElement>(".assistant-messages")!;
  Object.defineProperty(log, "scrollHeight", { value: 1000 });
  Object.defineProperty(log, "clientHeight", { value: 200 });
  log.scrollTop = 100;
  const scroll = vi.fn();
  log.scrollTo = scroll;
  act(() => log.dispatchEvent(new Event("scroll")));
  act(() => vi.advanceTimersByTime(100));
  expect(node.querySelector(".desktop-bots-jump")).toBeNull();
  // A brief excursion from the bottom must not flash the button.
  log.scrollTop = 800;
  act(() => log.dispatchEvent(new Event("scroll")));
  act(() => vi.advanceTimersByTime(100));
  expect(node.querySelector(".desktop-bots-jump")).toBeNull();
  log.scrollTop = 100;
  act(() => log.dispatchEvent(new Event("scroll")));
  act(() => vi.advanceTimersByTime(149));
  expect(node.querySelector(".desktop-bots-jump")).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  const jump = node.querySelector<HTMLButtonElement>('[data-ui="jump-to-bottom"]')!;
  expect(jump.closest(".assistant-compose")).not.toBeNull();
  expect(jump.getAttribute("aria-label")).toBe("Jump to latest");
  expect(!!jump.querySelector(".typing-dots")).toBe(lifecycle === "running");
  act(() => { jump.click(); jump.click(); });
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ top: 1000 }));
  expect(log.dataset.followLatest).toBe("true");
  // Intermediate smooth-scroll events must not bring the control back.
  log.scrollTop = 400;
  act(() => log.dispatchEvent(new Event("scroll")));
  act(() => vi.advanceTimersByTime(200));
  await act(async () => { await finishMotion(); });
  expect(log.dataset.followLatest).toBe("true");
  expect(node.querySelector(".desktop-bots-jump")).toBeNull();
  // Scrolling upward during the jump restores manual reading.
  log.scrollTop = 200;
  act(() => log.dispatchEvent(new Event("scroll")));
  act(() => vi.advanceTimersByTime(150));
  expect(log.dataset.followLatest).toBe("false");
  expect(node.querySelector(".desktop-bots-jump")).not.toBeNull();
});

it("keeps Bots chat interactive and retains detail drafts through closing, reversal and Host updates", async () => {
  const motion = vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
  let view = configuredView();
  const base = chatRpc(view);
  const rpc = vi.fn(async (method: string, params?: object) => {
    if (method === "environment.describe") return { capabilities: ["assistant.v1", "bots.shell.v1"] };
    if (method === "assistant.get") return view;
    return base(method, params);
  });
  act(() => root.render(createElement(BotChat, {
    hostKey: "host", hostName: "Host", rpc: rpc as any, onOpen: () => {}, desktopBots: true,
  })));
  await flush();
  const details = node.querySelector<HTMLButtonElement>('button[aria-label="Bot details"]')!;
  const panel = node.querySelector<HTMLElement>(".desktop-bots-inspector")!;
  const composer = node.querySelector<HTMLTextAreaElement>('.assistant-conversation textarea')!;
  expect(panel.inert).toBe(true);
  expect(panel.getAttribute("data-fold-state")).toBe("closed");
  expect(panel.querySelector("form")).toBeNull();
  act(() => details.click());
  await flush();
  expect(panel.inert).toBe(false);
  expect(node.querySelector<HTMLElement>(".assistant-conversation")!.inert).toBe(false);
  expect(node.querySelector<HTMLElement>(".assistant-heading")!.inert).toBe(false);
  act(() => vi.advanceTimersByTime(17));
  expect(document.activeElement).toBe(panel);
  act(() => {
    rename("Unsaved bot name");
    composer.focus();
    setValue(composer, "Keep this chat draft");
  });
  const nameInput = [...panel.querySelectorAll("label")]
    .find((label) => (label.textContent?.startsWith("Assistant name") || label.textContent?.startsWith("Name")))!.querySelector("input")!;
  act(() => node.querySelector<HTMLButtonElement>('[aria-label="Hide bot details"]')!.click());
  expect(panel.getAttribute("data-fold-state")).toBe("closing");
  expect(panel.inert).toBe(true);
  expect(nameInput.isConnected).toBe(true);
  expect(document.activeElement).toBe(composer);
  act(() => details.click());
  expect(panel.getAttribute("data-fold-state")).toBe("opening");
  expect(nameInput.value).toBe("Unsaved bot name");
  act(() => details.click());
  await act(async () => { await finishMotion(); });
  expect(panel.getAttribute("data-fold-state")).toBe("closed");
  view = { ...view, revision: 2, name: "Changed on the Host" };
  await act(async () => vi.advanceTimersByTime(2000));
  await flush();
  act(() => details.click());
  expect(nameInput.value).toBe("Unsaved bot name");
  expect(composer.value).toBe("Keep this chat draft");
  act(() => node.querySelector<HTMLButtonElement>(".assistant-send")!.click());
  await flush();
  expect(rpc.mock.calls.find(([method]) => method === "assistant.send")?.[1]).toMatchObject({ text: "Keep this chat draft" });
  expect(composer.value).toBe("");
  expect(panel.inert).toBe(false);
  expect(nameInput.value).toBe("Unsaved bot name");
  motion.mockRestore();
});

it("blocks desktop delegation text and attachments while preserving approval and question responses", async () => {
  const reason = "Delegation threads accept approvals and questions. Start a direct thread for a new message.";
  const approval: BotMessage = { id: "delegated-approval", kind: "input", revision: 1, createdAt: 1, text: "Allow target action?", inputKind: "approval", brainGeneration: 3, runId: "delegated-run", requestId: 7, resolved: false };
  const question: BotMessage = { ...approval, id: "delegated-question", revision: 2, inputKind: "question", requestId: 8, question: { requestId: 8, questions: [{ id: "choice", prompt: "Pick an option", multiSelect: false, allowCustom: false, options: [{ id: "first", label: "First choice" }] }] } };
  const base = chatRpc(configuredView(), [approval, question]);
  const rpc = vi.fn(async (method: string, params?: object) => method === "environment.describe" ? { capabilities: ["assistant.v1", "bots.shell.v1"] } : base(method, params));
  act(() => root.render(createElement(BotChat, { hostKey: "delegated", hostName: "Host", rpc: rpc as any, onOpen: () => {}, desktopBots: true, botReadOnlyReason: reason })));
  await flush();
  expect(node.querySelector<HTMLTextAreaElement>(".assistant-compose textarea")!.disabled).toBe(true);
  expect(node.querySelector<HTMLButtonElement>('[aria-label="Attach files"]')!.disabled).toBe(true);
  expect(node.querySelector<HTMLInputElement>('.assistant-file-input')!.disabled).toBe(true);
  expect(node.querySelector<HTMLButtonElement>(".assistant-send")!.disabled).toBe(true);
  expect(node.querySelector(".assistant-compose-dock")?.textContent).toContain(reason);
  act(() => node.querySelector(".assistant-compose")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  act(() => [...node.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Allow")!.click()); await flush();
  act(() => node.querySelector<HTMLButtonElement>('[data-question-option]')!.click());
  act(() => [...node.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Continue")!.click()); await flush();
  const answers = rpc.mock.calls.filter(([method]) => method === "assistant.respond").map(([, params]) => params);
  expect(answers).toEqual(expect.arrayContaining([
    expect.objectContaining({ messageId: "delegated-approval", runId: "delegated-run", requestId: 7, brainGeneration: 3, decision: "allow" }),
    expect.objectContaining({ messageId: "delegated-question", runId: "delegated-run", requestId: 8, brainGeneration: 3, reply: { kind: "answered", answers: { choice: ["first"] } } }),
  ]));
  expect(rpc.mock.calls.some(([method]) => method === "assistant.send" || method.startsWith("attachments."))).toBe(false);
});

it.each([false, true])("ignores a Bot read-only reason outside the capable desktop Bot shell (%s)", async (desktopBots) => {
  const rpc = chatRpc(configuredView());
  act(() => root.render(createElement(BotChat, { hostKey: "legacy", hostName: "Host", rpc: rpc as any, onOpen: () => {}, desktopBots, botReadOnlyReason: "Delegation restriction" })));
  await flush();
  expect(node.querySelector<HTMLTextAreaElement>(".assistant-compose textarea")!.disabled).toBe(false);
  expect(node.querySelector<HTMLButtonElement>('[aria-label="Attach files"]')!.disabled).toBe(false);
  expect(node.textContent).not.toContain("Delegation restriction");
});

it("keeps the frozen mobile client on assistant RPCs when the Host advertises every Bot capability", async () => {
  const approval: BotMessage = { id: "approval", kind: "input", revision: 1, createdAt: 1, text: "Allow action?", inputKind: "approval", brainGeneration: 2, runId: "default-run", requestId: 7, resolved: false };
  const question: BotMessage = { ...approval, id: "question", revision: 2, inputKind: "question", requestId: 8, question: { requestId: 8, questions: [{ id: "choice", prompt: "Pick one", multiSelect: false, allowCustom: false, options: [{ id: "first", label: "First" }] }] } };
  const base = chatRpc(configuredView(), [approval, question]);
  const rpc = vi.fn(async (method: string, params?: object) => {
    if (method === "environment.describe") return { capabilities: ["assistant.v1", "assistant.history", "bots.shell.v1", "bots.v1", "botMemory.v1", "bots.runtime.v1", "bots.management.v1", "bots.delegation.v1", "bots.teams.v1", "bots.rooms.v1"] };
    if (method === "assistant.messages") return { assistant: configuredView(), entries: [approval, question], nextRevision: 2, hasMore: false };
    return base(method, params);
  });
  act(() => root.render(createElement(MobileAssistant, { hostKey: "new-host", hostName: "Host", rpc: rpc as any, onOpen: () => {}, desktopBots: true, botReadOnlyReason: "Desktop restriction" })));
  await flush();
  expect(node.querySelector(".assistant-chat")?.getAttribute("data-layout")).toBe("mobile");
  expect(node.querySelector(".desktop-bots-workspace")).toBeNull();
  expect(node.textContent).not.toContain("Desktop restriction");
  act(() => [...node.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Allow")!.click()); await flush();
  act(() => node.querySelector<HTMLButtonElement>('[data-question-option]')!.click());
  act(() => [...node.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Continue")!.click()); await flush();
  act(() => setValue(node.querySelector<HTMLTextAreaElement>(".mobile-assistant-compose textarea")!, "Default thread message"));
  act(() => node.querySelector(".mobile-assistant-compose")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await flush();
  expect(rpc.mock.calls.filter(([method]) => method === "assistant.respond")).toHaveLength(2);
  expect(rpc.mock.calls.find(([method]) => method === "assistant.send")?.[1]).toMatchObject({ text: "Default thread message" });
  expect(rpc.mock.calls.some(([method]) => /^(bots|botThreads|botMemory|botDelegations|botTeams|botRooms)\./.test(method))).toBe(false);
});
