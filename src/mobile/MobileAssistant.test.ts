import { advanceMotionTimers, startMotionClock, stopMotionClock } from "./motionTestClock";
// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SurfaceVisibilityContext } from "../shared/ui/SurfaceVisibility";
import { MobileAssistant, type MobileAssistantHandle } from "./MobileAssistant";
import {
  fullBotPolicy as fullAssistantPolicy,
  type BotMessage as AssistantMessage,
  type BotConfiguration as AssistantView,
} from "../features/bots/model/botView";
import type { BotRpc as AssistantRpc } from "../features/bots/model/botRpc";
import { setUiLanguage } from "../shared/i18n/language";
import { KEYBOARD_EVENT, installKeyboardMotion } from "./keyboardMotion";

vi.mock("../features/bots/ui/BotWorkerDetails", () => ({
  BotWorkerDetails: () => null,
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
  vi.restoreAllMocks();
});
async function flush() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}
function fixture() {
  let view: AssistantView = {
    id: "a",
    name: "Assistant",
    revision: 1,
    chatRevision: 0,
    lifecycle: "idle",
    enabled: true,
    harness: "codex",
    model: "test",
    modelSettings: {},
    runtimeMode: "full-access",
    targetRuntimeMode: "full-access",
    policy: fullAssistantPolicy(),
    policyVersion: 1,
    triggers: { user: true, event: true, schedule: true },
    schedules: [],
    watches: [
      {
        id: "activity",
        enabled: true,
        projectIds: [],
        sessionIds: [],
        eventKinds: ["completed"],
        prompt: "Follow progress",
      },
    ],
    maxAutoTurns: 8,
    chainWindowMinutes: 15,
    brainGeneration: 3,
  };
  let messages: AssistantMessage[] = [];
  let failSend = false;
  const rpc = vi.fn(async (method: string, params?: any) => {
    if (method === "environment.describe")
      return { capabilities: ["assistant.v1"] };
    if (method === "assistant.get") return view;
    if (method === "assistant.messages")
      return {
        entries: messages,
        nextRevision: messages.length,
        hasMore: false,
      };
    if (method === "models.list")
      return { models: { codex: [{ id: "test", name: "Test" }] }, errors: {} };
    if (method === "projects.list")
      return [{ id: "project", name: "Project", cwd: "/project" }];
    if (method === "assistant.configure") {
      if (params.expectedRevision !== view.revision)
        throw new Error("Assistant settings changed. Reload before saving.");
      view = { ...view, ...params.patch, revision: view.revision + 1 };
    }
    if (method === "assistant.control")
      view = {
        ...view,
        lifecycle: params.action === "pause" ? "paused" : "idle",
      };
    if (method === "assistant.send" && failSend)
      throw new Error("Host connection failed");
    if (method === "attachments.upload")
      return { offset: params.offset + atob(params.data).length };
    return {};
  });
  return {
    rpc,
    view: () => view,
    update: (patch: Partial<AssistantView>) => {
      view = { ...view, ...patch };
    },
    messages: (entries: AssistantMessage[]) => {
      messages = entries;
    },
    failSend: (fail: boolean) => {
      failSend = fail;
    },
  };
}
function button(name: string) {
  const result = [...node.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) =>
      b.getAttribute("aria-label") === name ||
      b.textContent === name ||
      b.querySelector(".assistant-settings-disclosure-title")?.textContent ===
        name,
  );
  expect(result, name).toBeDefined();
  return result!;
}
function type(field: HTMLInputElement | HTMLTextAreaElement, text: string) {
  act(() => {
    const prototype =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function mount() {
  const data = fixture(),
    ref = createRef<MobileAssistantHandle>(),
    close = vi.fn();
  act(() =>
    root.render(
      createElement(MobileAssistant, {
        hostKey: "host",
        hostName: "Host",
        rpc: data.rpc as AssistantRpc,
        ref,
        onOpen: () => {},
        onClose: close,
      }),
    ),
  );
  await flush();
  return { ...data, ref, close };
}

function touch(target: Element, type: string, x: number, y = 100, pointerId = 1) {
  act(() => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerType: "touch", button: 0,
    pointerId, clientX: x, clientY: y,
  })));
}
async function mountConversation() {
  const data = await mount();
  data.messages([
    { kind: "user", id: "user", revision: 1, createdAt: 1, text: "Question" },
    { kind: "assistant", id: "reply", revision: 2, createdAt: 2, text: "A result\nNext line" },
  ]);
  await advanceMotionTimers(2000);
  await flush();
  return {
    ...data,
    log: node.querySelector<HTMLElement>(".assistant-messages")!,
    bubble: node.querySelector<HTMLElement>(".assistant-message-assistant")!,
    user: node.querySelector<HTMLElement>(".assistant-message-user")!,
    field: node.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message assistant"]')!,
  };
}

it.each([false, true])("shows sending until the Host responds and clears it after success or failure (failure: %s)", async (failed) => {
  const { rpc, field, failSend } = await mountConversation();
  failSend(failed);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const invoke = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (method, params) => {
    if (method === "assistant.send") await pending;
    return invoke(method, params);
  });
  type(field, "Continue");
  const send = button("Send");
  act(() => send.click());
  expect(send.getAttribute("aria-busy")).toBe("true");
  expect(send.getAttribute("aria-label")).toBe("Sending...");
  expect(send.querySelector(".mobile-spin")).not.toBeNull();
  expect(send.disabled).toBe(true);
  expect(field.value).toBe("Continue");
  act(() => {
    send.click();
    send.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(rpc.mock.calls.filter(([method]) => method === "assistant.send")).toHaveLength(1);

  finish();
  await flush();
  expect(send.getAttribute("aria-busy")).toBeNull();
  expect(send.getAttribute("aria-label")).toBe("Send");
  expect(send.querySelector(".mobile-spin")).toBeNull();
  expect(field.value).toBe(failed ? "Continue" : "");
  if (failed) {
    const sent = rpc.mock.calls.find(([method]) => method === "assistant.send")![1];
    failSend(false);
    const retryPending = new Promise<void>((resolve) => { finish = resolve; });
    rpc.mockImplementation(async (method, params) => {
      if (method === "assistant.send") await retryPending;
      return invoke(method, params);
    });
    act(() => button("Retry message").click());
    expect(send.getAttribute("aria-busy")).toBe("true");
    expect(send.querySelector(".mobile-spin")).not.toBeNull();
    expect(button("Retry message").disabled).toBe(true);
    finish();
    await flush();
    expect(rpc.mock.calls.filter(([method]) => method === "assistant.send").at(-1)![1]).toEqual(sent);
    expect(send.getAttribute("aria-busy")).toBeNull();
    expect(send.querySelector(".mobile-spin")).toBeNull();
    expect(field.value).toBe("");
  }
});

it("keeps the send arrow while an assistant control request is pending", async () => {
  const { rpc, field } = await mountConversation();
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const invoke = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (method, params) => {
    if (method === "assistant.control") await pending;
    return invoke(method, params);
  });
  type(field, "Continue");
  act(() => button("Assistant options").click());
  act(() => button("Pause").click());
  const send = button("Send");
  expect(send.disabled).toBe(true);
  expect(send.getAttribute("aria-busy")).toBeNull();
  expect(send.querySelector(".mobile-spin")).toBeNull();
  finish();
  await flush();
  expect(send.disabled).toBe(false);
});

it("swipes a reply above the unchanged draft and sends the full quote with it", async () => {
  const { bubble, field, rpc, log } = await mountConversation();
  type(field, "Explain this");
  touch(bubble, "pointerdown", 80);
  touch(bubble, "pointermove", 160);
  touch(bubble, "lostpointercapture", 160);
  await advanceMotionTimers(500);
  expect(log.dataset.messageSwipe).toBe("reply");
  expect(node.querySelector('[role="dialog"][aria-label="Message actions"]')).toBeNull();
  touch(bubble, "pointerup", 160);
  expect(field.value).toBe("Explain this");
  expect(node.querySelector(".mobile-assistant-reply-preview blockquote")?.textContent).toBe("A result\nNext line");
  expect(log.inert).toBe(true);
  expect(node.querySelector(".mobile-assistant-reply-backdrop")?.getAttribute("data-active")).toBe("true");
  expect(document.activeElement).toBe(field);
  expect(log.dataset.messageSwipe).toBeUndefined();
  expect(rpc.mock.calls.some(([method]) => method === "assistant.send")).toBe(false);
  await advanceMotionTimers(32);
  act(() => button("Send").click());
  await flush();
  expect(rpc.mock.calls.find(([method]) => method === "assistant.send")?.[1].text).toBe("> A result\n> Next line\n\nExplain this");
  expect(field.value).toBe("");
  expect(log.inert).toBe(false);
  expect(node.querySelector<HTMLElement>(".mobile-assistant-reply-collapse")?.inert).toBe(true);
  await advanceMotionTimers(351);
  expect(node.querySelector(".mobile-assistant-reply-preview")).toBeNull();
});

it("cancels reply focus with Back, the close button or the backdrop while preserving the draft", async () => {
  const { bubble, field, log, ref, close } = await mountConversation();
  type(field, "Keep my draft");
  const reply = () => {
    touch(bubble, "pointerdown", 80);
    touch(bubble, "pointermove", 160);
    touch(bubble, "pointerup", 160);
  };
  for (const cancel of [
    () => ref.current!.back(),
    () => node.querySelector<HTMLButtonElement>(".mobile-assistant-reply-cancel")!.click(),
    () => node.querySelector<HTMLButtonElement>(".mobile-assistant-reply-backdrop")!.click(),
  ]) {
    reply();
    act(() => cancel());
    expect(field.value).toBe("Keep my draft");
    expect(log.inert).toBe(false);
    const fold = node.querySelector<HTMLElement>(".mobile-assistant-reply-collapse")!;
    expect(fold.dataset.foldState).toBe("closing");
    expect(fold.inert).toBe(true);
    expect(fold.textContent).toContain("A result\nNext line");
    // Reopening during exit keeps the content and restores interaction.
    reply();
    expect(fold.dataset.foldState).toBe("opening");
    expect(fold.inert).toBe(false);
    act(() => ref.current!.back());
    await advanceMotionTimers(351);
    expect(node.querySelector(".mobile-assistant-reply-preview")).toBeNull();
  }
  expect(close).not.toHaveBeenCalled();
});

it("restores a quoted draft after reopening and retains the same payload through a failed send", async () => {
  const { bubble, field } = await mountConversation();
  type(field, "Explain this");
  touch(bubble, "pointerdown", 80);
  touch(bubble, "pointermove", 160);
  touch(bubble, "pointerup", 160);
  act(() => root.unmount());
  root = createRoot(node);
  const data = await mount();
  expect(node.querySelector("textarea")?.value).toBe("Explain this");
  expect(node.querySelector(".mobile-assistant-reply-preview blockquote")?.textContent).toBe("A result\nNext line");
  data.failSend(true);
  act(() => button("Send").click());
  await flush();
  const sent = data.rpc.mock.calls.find(([method]) => method === "assistant.send")![1];
  expect(sent.text).toBe("> A result\n> Next line\n\nExplain this");
  expect(node.querySelector(".mobile-assistant-reply-preview")).not.toBeNull();
  data.failSend(false);
  act(() => button("Retry message").click());
  await flush();
  expect(data.rpc.mock.calls.filter(([method]) => method === "assistant.send").at(-1)![1]).toEqual(sent);
  expect(localStorage.getItem("monocode.assistant-reply:host")).toBeNull();
});

it.each(["background", "user", "assistant"])("reveals every message time while swiping left from %s", async (start) => {
  const { log, bubble, user, field } = await mountConversation();
  const target = start === "background" ? log : start === "user" ? user : bubble;
  expect(log.querySelectorAll(".assistant-swipe-time")).toHaveLength(2);
  expect(bubble.parentElement!.querySelector(".assistant-message-meta")).toBeNull();
  expect(log.querySelector(".assistant-message-meta button")).toBeNull();
  touch(target, "pointerdown", 260);
  touch(target, "pointermove", 160);
  expect(log.dataset.messageSwipe).toBe("time");
  await advanceMotionTimers(20);
  const times = [...log.querySelectorAll<HTMLElement>(".assistant-swipe-time")];
  for (const time of times) {
    expect(time.style.transform).toBe("translateX(6px)");
    expect(time.style.opacity).toBe("1");
  }
  touch(target, "pointerup", 160);
  expect(log.dataset.messageSwipe).toBeUndefined();
  await advanceMotionTimers(600);
  for (const time of times) expect(time.style.transform).toBe("");
  expect(field.value).toBe("");
});

it("cancels short, reversed, vertical, interrupted and multiple-touch gestures", async () => {
  const { log, bubble, user, field } = await mountConversation();
  touch(bubble, "pointerdown", 80);
  touch(bubble, "pointermove", 120);
  touch(bubble, "pointerup", 120);
  touch(bubble, "pointerdown", 80);
  touch(bubble, "pointermove", 165);
  touch(bubble, "pointermove", 85);
  touch(bubble, "pointerup", 85);
  touch(bubble, "pointerdown", 80);
  touch(bubble, "pointermove", 85, 160);
  touch(bubble, "pointermove", 180, 160);
  touch(bubble, "pointerup", 180, 160);
  touch(bubble, "pointerdown", 80);
  touch(bubble, "pointermove", 180);
  touch(bubble, "pointercancel", 180);
  touch(bubble, "pointerdown", 80);
  touch(bubble, "pointermove", 180);
  touch(log, "pointerdown", 200, 100, 2);
  touch(bubble, "pointerup", 180);
  touch(log, "pointerup", 200, 100, 2);
  touch(user, "pointerdown", 80);
  touch(user, "pointermove", 180);
  touch(user, "pointerup", 180);
  expect(field.value).toBe("");
  expect(log.dataset.messageSwipe).toBeUndefined();
  await advanceMotionTimers(500);
  expect(node.querySelector('[role="dialog"][aria-label="Message actions"]')).toBeNull();
});

it("keeps time gestures and copy available when replies are disabled", async () => {
  const { log, bubble, field, update } = await mountConversation();
  update({ enabled: false });
  await advanceMotionTimers(2000);
  await flush();
  touch(bubble, "pointerdown", 80);
  touch(bubble, "pointermove", 180);
  touch(bubble, "pointerup", 180);
  expect(field.value).toBe("");
  touch(bubble, "pointerdown", 180);
  touch(bubble, "pointermove", 80);
  expect(log.dataset.messageSwipe).toBe("time");
  touch(bubble, "pointerup", 80);
  touch(bubble, "pointerdown", 80);
  await advanceMotionTimers(450);
  touch(bubble, "pointerup", 80);
  expect(button("Reply").disabled).toBe(true);
  expect(button("Copy").disabled).toBe(false);
});
it("expands activity inside the center capsule and retains it through closing and rapid restart", async () => {
  const data = await mount();
  const capsule = node.querySelector(".mobile-assistant-header > .mobile-header-title")!;
  const fold = () => capsule.querySelector<HTMLElement>(".mobile-assistant-activity-collapse");
  expect(fold()).toBeNull();
  data.update({
    lifecycle: "running",
    activity: { action: "sessions.get", sessionTitle: "pi · ncmcli", at: 1 },
  });
  await advanceMotionTimers(2000);
  await flush();
  expect(fold()?.dataset.foldState).toBe("opening");
  expect(fold()?.textContent).toBe("Reading pi · ncmcli");
  expect(fold()?.inert).toBe(false);
  expect(node.querySelector(".assistant-messages .assistant-working")).toBeNull();
  data.messages([{
    kind: "assistant", id: "reply", revision: 1, createdAt: 1,
    text: "A streaming reply", streaming: true,
  }]);
  await advanceMotionTimers(350);
  await flush();
  expect(fold()?.dataset.foldState).toBe("open");
  expect(fold()?.textContent).toBe("Reading pi · ncmcli");

  data.update({ lifecycle: "idle", activity: undefined });
  await advanceMotionTimers(250);
  await flush();
  expect(fold()?.dataset.foldState).toBe("closing");
  expect(fold()?.textContent).toBe("Reading pi · ncmcli");
  expect(fold()?.inert).toBe(true);
  expect(fold()?.getAttribute("aria-hidden")).toBe("true");
  await advanceMotionTimers(150);

  // A new send can restart activity before the closing animation finishes.
  data.update({ lifecycle: "running", activity: { action: "files.read", at: 2 } });
  type(node.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message assistant"]')!, "Continue");
  act(() => button("Send").click());
  await flush();
  expect(fold()?.dataset.foldState).toBe("opening");
  expect(fold()?.textContent).toBe("Going through the files");
  expect(fold()?.inert).toBe(false);
  await advanceMotionTimers(100);
  expect(fold()?.dataset.foldState).toBe("opening");
  await advanceMotionTimers(150);
  expect(fold()?.dataset.foldState).toBe("open");

  data.update({ lifecycle: "idle", activity: undefined });
  await advanceMotionTimers(2000);
  await flush();
  expect(fold()?.dataset.foldState).toBe("closing");
  await advanceMotionTimers(350);
  expect(fold()).toBeNull();
  expect(capsule.querySelector("strong")?.textContent).toBe("Assistant");
});

it("localizes capsule activity and respects reduced motion", async () => {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: query === "(prefers-reduced-motion: reduce)",
  }) as MediaQueryList);
  setUiLanguage("zh-CN");
  const data = await mount();
  data.update({
    lifecycle: "running",
    activity: { action: "sessions.get", sessionTitle: "pi · ncmcli", at: 1 },
  });
  await advanceMotionTimers(2000);
  await flush();
  const fold = node.querySelector<HTMLElement>(".mobile-assistant-activity-collapse");
  expect(fold?.dataset.foldState).toBe("open");
  expect(fold?.textContent).toBe("正在查看「pi · ncmcli」");
  data.update({ lifecycle: "idle", activity: undefined });
  await advanceMotionTimers(250);
  await flush();
  expect(node.querySelector(".mobile-assistant-activity-collapse")).toBeNull();
});

it("opens Reply on a stationary long press, cancels scrolling holds and closes with Back", async () => {
  const data = await mount();
  data.messages([
    {
      kind: "assistant",
      id: "reply",
      revision: 1,
      createdAt: 1,
      text: "A result",
    },
  ]);
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  await flush();
  const bubble = node.querySelector(".assistant-message-assistant")!;
  const field = node.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Message assistant"]',
  )!;
  type(field, "Explain this");
  const pointer = (type: string, y = 100) =>
    act(() =>
      bubble.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerType: "touch",
          button: 0,
          clientX: 80,
          clientY: y,
        }),
      ),
    );
  pointer("pointerdown");
  pointer("pointermove", 130);
  await advanceMotionTimers(500);
  expect(node.querySelector('[role="dialog"][aria-label="Message actions"]')).toBeNull();
  pointer("pointerdown");
  await advanceMotionTimers(449);
  expect(node.querySelector('[role="dialog"][aria-label="Message actions"]')).toBeNull();
  await advanceMotionTimers(1);
  expect(
    node.querySelector('[role="dialog"][aria-label="Message actions"]'),
  ).not.toBeNull();
  pointer("pointerup");
  act(() => data.ref.current!.back());
  expect(data.close).not.toHaveBeenCalled();
  await advanceMotionTimers(400);
  expect(node.querySelector('[role="dialog"][aria-label="Message actions"]')).toBeNull();
  pointer("pointerdown");
  await advanceMotionTimers(450);
  pointer("pointerup");
  act(() => button("Reply").click());
  expect(field.value).toBe("Explain this");
  expect(node.querySelector(".mobile-assistant-reply-preview blockquote")?.textContent).toBe("A result");
  expect(document.activeElement).toBe(field);
  expect(
    data.rpc.mock.calls.some(([method]) => method === "assistant.send"),
  ).toBe(false);
});
it.each([true, false])(
  "waits for initial sync before deciding whether to show setup (configured: %s)",
  async (configured) => {
    const data = fixture();
    let resolve!: (view: AssistantView | null) => void;
    const pending = new Promise<AssistantView | null>((done) => {
      resolve = done;
    });
    const rpc: AssistantRpc = async <T>(method: string, params?: object) =>
      (method === "assistant.get"
        ? await pending
        : await data.rpc(method, params)) as T;
    act(() =>
      root.render(
        createElement(MobileAssistant, {
          hostKey: "host",
          hostName: "Host",
          rpc,
          onOpen: () => {},
        }),
      ),
    );
    await flush();
    await advanceMotionTimers(500);
    expect(node.textContent).toContain("Connecting…");
    expect(node.querySelector(".mobile-assistant-settings-page")).toBeNull();
    expect(node.querySelector(".assistant-settings")).toBeNull();

    resolve(configured ? data.view() : null);
    await flush();
    if (configured) {
      expect(node.querySelector(".assistant-conversation")).not.toBeNull();
      expect(node.querySelector(".mobile-assistant-settings-page")).toBeNull();
    } else {
      expect(
        node
          .querySelector(".mobile-assistant-settings-page")
          ?.getAttribute("aria-hidden"),
      ).not.toBe("true");
      expect(node.textContent).toContain("Set up assistant");
      expect(node.querySelector(".assistant-settings")).not.toBeNull();
    }
  },
);

it("keeps setup hidden after a failed initial sync and recovers on retry", async () => {
  const data = fixture();
  let failed = false;
  const rpc: AssistantRpc = async <T>(method: string, params?: object) => {
    if (method === "assistant.get" && !failed) {
      failed = true;
      throw new Error("Host connection failed");
    }
    return (await data.rpc(method, params)) as T;
  };
  act(() =>
    root.render(
      createElement(MobileAssistant, {
        hostKey: "host",
        hostName: "Host",
        rpc,
        onOpen: () => {},
      }),
    ),
  );
  await flush();
  expect(node.textContent).toContain("Host connection failed");
  expect(node.querySelector(".mobile-assistant-settings-page")).toBeNull();
  await advanceMotionTimers(2000);
  await flush();
  expect(node.querySelector(".assistant-conversation")).not.toBeNull();
  expect(node.querySelector(".mobile-assistant-settings-page")).toBeNull();
});

it("handles menu, settings and exit as separate back steps while retaining the draft", async () => {
  const data = await mount();
  const composer = node.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Message assistant"]',
  )!;
  type(composer, "Continue the project");
  act(() => button("Assistant options").click());
  act(() => data.ref.current!.back());
  expect(button("Assistant options").getAttribute("aria-expanded")).toBe(
    "false",
  );
  expect(data.close).not.toHaveBeenCalled();
  act(() => button("Assistant options").click());
  act(() => button("Settings").click());
  await flush();
  const page = node.querySelector<HTMLElement>(
    ".mobile-assistant-settings-page",
  )!;
  const sheet = page.closest<HTMLElement>(".mobile-sheet")!;
  const backdrop = sheet.closest<HTMLElement>(".mobile-sheet-backdrop")!;
  expect(backdrop.getAttribute("data-placement")).toBe("bottom");
  expect(backdrop.getAttribute("data-fold-state")).toBe("opening");
  expect(sheet.getAttribute("role")).toBe("dialog");
  expect(sheet.getAttribute("aria-label")).toBe("Assistant settings");
  expect(sheet.querySelector(".mobile-sheet-grip")).not.toBeNull();
  expect(
    node.querySelector<HTMLElement>(".assistant-conversation")!.inert,
  ).toBe(true);
  await advanceMotionTimers(600);
  act(() => data.ref.current!.back());
  expect(backdrop.getAttribute("data-fold-state")).toBe("closing");
  expect(backdrop.inert).toBe(true);
  expect(composer.value).toBe("Continue the project");
  await advanceMotionTimers(119);
  expect(node.querySelector(".mobile-assistant-settings-page")).toBe(page);
  await advanceMotionTimers(600);
  expect(node.querySelector(".mobile-assistant-settings-page")).toBeNull();
  act(() => data.ref.current!.back());
  expect(data.close).toHaveBeenCalledOnce();
});
it("reopens the settings sheet during closing without losing unsaved edits", async () => {
  const data = await mount();
  act(() => button("Assistant options").click());
  act(() => button("Settings").click());
  await flush();
  const page = node.querySelector<HTMLElement>(
    ".mobile-assistant-settings-page",
  )!;
  const backdrop = page.closest<HTMLElement>(".mobile-sheet-backdrop")!;
  const name = page.querySelector<HTMLInputElement>("input:not([type])")!;
  type(name, "Unsaved assistant name");
  await advanceMotionTimers(600);
  act(() => data.ref.current!.back());
  await advanceMotionTimers(60);
  act(() => button("Assistant options").click());
  act(() => button("Settings").click());
  expect(node.querySelector(".mobile-assistant-settings-page")).toBe(page);
  expect(backdrop.getAttribute("data-fold-state")).toBe("opening");
  expect(backdrop.inert).toBe(false);
  expect(name.value).toBe("Unsaved assistant name");
  await advanceMotionTimers(600);
  expect(backdrop.getAttribute("data-fold-state")).toBe("open");
  act(() => data.ref.current!.back());
  await advanceMotionTimers(600);
  expect(node.querySelector(".mobile-assistant-settings-page")).toBeNull();
});
it("opens and closes the settings sheet immediately with reduced motion", async () => {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
  } as MediaQueryList);
  const data = await mount();
  act(() => button("Assistant options").click());
  act(() => button("Settings").click());
  await flush();
  const page = node.querySelector<HTMLElement>(
    ".mobile-assistant-settings-page",
  )!;
  expect(
    page.closest(".mobile-sheet-backdrop")?.getAttribute("data-fold-state"),
  ).toBe("open");
  act(() => data.ref.current!.back());
  expect(node.querySelector(".mobile-assistant-settings-page")).toBeNull();
  expect(data.close).not.toHaveBeenCalled();
});
it("releases the settings action bar's space during typing and restores unsaved actions after keyboard reversal", async () => {
  const stop = installKeyboardMotion();
  const keyboard = (height: number) => act(() => window.dispatchEvent(new CustomEvent(KEYBOARD_EVENT, {
    detail: { height, viewport: 800, duration: 240, easing: "linear" },
  })));
  try {
    await mount();
    act(() => button("Assistant options").click());
    act(() => button("Settings").click());
    await flush();
    const name = node.querySelector<HTMLInputElement>('.assistant-settings input:not([type])')!;
    type(name, "Unsaved name");
    const actions = () => node.querySelector<HTMLElement>(".mobile-assistant-settings-actions");
    const footer = node.querySelector(".assistant-settings-footer");
    keyboard(320);
    expect(actions()?.dataset.foldState).toBe("closing");
    expect(actions()?.inert).toBe(true);
    expect(node.querySelector(".assistant-settings-footer")).toBe(footer);
    await advanceMotionTimers(80);
    keyboard(0);
    expect(actions()?.dataset.foldState).toBe("opening");
    expect(actions()?.inert).toBe(false);
    keyboard(320);
    await advanceMotionTimers(251);
    expect(actions()).toBeNull();
    expect(node.querySelector(".assistant-settings-footer")).toBeNull();
    expect(name.value).toBe("Unsaved name");
    keyboard(0);
    expect(actions()?.dataset.foldState).toBe("opening");
    await advanceMotionTimers(251);
    expect(actions()?.dataset.foldState).toBe("open");
    expect(button("Save settings").disabled).toBe(false);
    expect(button("Reset")).toBeDefined();
  } finally { stop(); }
});
it("opens settings above an existing keyboard and restores actions without animation for reduced motion", async () => {
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
  const stop = installKeyboardMotion();
  const keyboard = (height: number) => act(() => window.dispatchEvent(new CustomEvent(KEYBOARD_EVENT, {
    detail: { height, viewport: 800, duration: 240, easing: "linear" },
  })));
  try {
    await mount();
    keyboard(320);
    act(() => button("Assistant options").click());
    act(() => button("Settings").click());
    await flush();
    expect(node.querySelector(".assistant-settings")).not.toBeNull();
    expect(node.querySelector(".assistant-settings-footer")).toBeNull();
    keyboard(0);
    expect(node.querySelector<HTMLElement>(".mobile-assistant-settings-actions")?.dataset.foldState).toBe("open");
    keyboard(320);
    expect(node.querySelector(".assistant-settings-footer")).toBeNull();
  } finally { stop(); }
});
it("uses the current generation for lifecycle controls from the phone menu", async () => {
  const data = await mount();
  act(() => button("Assistant options").click());
  act(() => button("Pause").click());
  await flush();
  expect(
    data.rpc.mock.calls.find(([method]) => method === "assistant.control")?.[1],
  ).toMatchObject({ action: "pause", expectedGeneration: 3 });
  act(() => button("Assistant options").click());
  act(() => button("Continue").click());
  await flush();
  expect(
    data.rpc.mock.calls
      .filter(([method]) => method === "assistant.control")
      .at(-1)?.[1],
  ).toMatchObject({ action: "resume", expectedGeneration: 3 });
});
it("retains the settings revision during polling and saves phone project switches after reload", async () => {
  const data = await mount();
  act(() => button("Assistant options").click());
  act(() => button("Settings").click());
  data.update({ revision: 2, name: "Other device" });
  await advanceMotionTimers(2000);
  await flush();
  const name = [...node.querySelectorAll("label")]
    .find((l) => l.textContent?.startsWith("Assistant name"))!
    .querySelector("input")!;
  type(name, "Phone helper");
  act(() => button("Save settings").click());
  await flush();
  expect(node.querySelector('[role="alert"]')?.textContent).toContain(
    "settings changed",
  );
  expect(
    data.rpc.mock.calls.find(([m]) => m === "assistant.configure")?.[1]
      .expectedRevision,
  ).toBe(1);
  act(() => button("Reload settings").click());
  act(() => button("Assistant wakeups").click());
  expect(node.querySelector("select[multiple]")).toBeNull();
  const all = node.querySelector<HTMLInputElement>(
    ".assistant-watch-projects .assistant-check input",
  )!;
  expect(all.checked).toBe(true);
  expect(
    node.querySelector(".assistant-watch-projects .assistant-chip"),
  ).toBeNull();
  act(() => all.click());
  const project = node.querySelector<HTMLInputElement>(
    ".assistant-watch-projects .assistant-chip input",
  )!;
  act(() => project.click());
  act(() => button("Save settings").click());
  await flush();
  const saved = data.rpc.mock.calls
    .filter(([m]) => m === "assistant.configure")
    .at(-1)![1];
  expect(saved.expectedRevision).toBe(2);
  expect(saved.patch.watches[0].projectIds).toEqual(["project"]);
  expect(
    node.querySelector<HTMLElement>(".assistant-conversation")!.inert,
  ).toBe(false);
});
it("keeps uploaded attachments across settings and retries a failed send with the same receipt ID", async () => {
  const data = await mount();
  const fileInput = node.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(fileInput, "files", {
    configurable: true,
    value: [new File(["content"], "notes.txt", { type: "text/plain" })],
  });
  act(() => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
  await flush();
  expect(
    node.querySelector(".mobile-assistant-attachments")?.textContent,
  ).toContain("notes.txt");
  act(() => button("Assistant options").click());
  act(() => button("Settings").click());
  act(() => data.ref.current!.back());
  await advanceMotionTimers(351);
  expect(
    node.querySelector(".mobile-assistant-attachments")?.textContent,
  ).toContain("notes.txt");
  data.failSend(true);
  act(() => button("Send").click());
  await flush();
  const sent = data.rpc.mock.calls.find(([m]) => m === "assistant.send")![1];
  expect(sent.attachments[0].name).toBe("notes.txt");
  data.failSend(false);
  act(() => button("Retry message").click());
  await flush();
  expect(
    data.rpc.mock.calls.filter(([m]) => m === "assistant.send").at(-1)![1]
      .commandId,
  ).toBe(sent.commandId);
  expect(
    node
      .querySelector<HTMLElement>(".mobile-assistant-attachments")
      ?.closest<HTMLElement>(".zen-fold-item")?.inert,
  ).toBe(true);
  await advanceMotionTimers(351);
  expect(node.querySelector(".mobile-assistant-attachments")).toBeNull();
});
it("does not pull a reader to the bottom on polling, and follows messages once back at the bottom", async () => {
  const data = await mount();
  const log = node.querySelector<HTMLElement>('[role="log"]')!;
  Object.defineProperties(log, {
    scrollHeight: { value: 1000 },
    clientHeight: { value: 300 },
  });
  log.scrollTo = vi.fn();
  log.scrollTop = 100;
  act(() => log.dispatchEvent(new Event("scroll")));
  data.messages([
    {
      kind: "assistant",
      id: "reply",
      revision: 1,
      createdAt: 1,
      text: "Progress",
    },
  ]);
  await advanceMotionTimers(2000);
  await flush();
  expect(log.scrollTo).not.toHaveBeenCalled();
  log.scrollTop = 700;
  act(() => log.dispatchEvent(new Event("scroll")));
  data.messages([
    {
      kind: "assistant",
      id: "reply",
      revision: 2,
      createdAt: 1,
      text: "Completed",
    },
  ]);
  await advanceMotionTimers(2000);
  await flush();
  expect(log.scrollTo).toHaveBeenCalledWith({ top: 700 });
});

it("reserves the assistant dock border box without repeated height reads during animation", async () => {
  const observers: { notify: (entries: ResizeObserverEntry[]) => void; observe: ReturnType<typeof vi.fn> }[] = [];
  vi.spyOn(globalThis, "ResizeObserver").mockImplementation(function (callback) {
    const observer = {
      notify: (entries: ResizeObserverEntry[]) => callback(entries, {} as ResizeObserver),
      observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(),
    };
    observers.push(observer);
    return observer;
  });
  await mount();
  const dock = node.querySelector<HTMLElement>(".mobile-assistant-compose-dock")!;
  const conversation = dock.parentElement!;
  const observer = observers.find(({ observe }) =>
    observe.mock.calls.some(([target, options]) => target === dock && options?.box === "border-box"),
  )!;
  const height = vi.spyOn(dock, "offsetHeight", "get").mockReturnValue(142);
  const delivered = {
    target: dock,
    contentRect: { width: 360, height: 100 },
    borderBoxSize: [{ blockSize: 122.75, inlineSize: 400 }],
  } as ResizeObserverEntry;
  act(() => observer.notify([delivered]));
  expect(conversation.style.getPropertyValue("--mobile-assistant-dock-height")).toBe("calc(123px + max(0px, var(--mobile-safe-bottom) - 14px))");
  expect(height).not.toHaveBeenCalled();
  // Older observers without borderBoxSize must still reserve padding/borders.
  act(() => observer.notify([{ target: dock, contentRect: delivered.contentRect } as ResizeObserverEntry]));
  expect(conversation.style.getPropertyValue("--mobile-assistant-dock-height")).toBe("calc(142px + max(0px, var(--mobile-safe-bottom) - 14px))");
  expect(height).toHaveBeenCalledOnce();
});

it("keeps new bubbles below the floating header as replies grow and the viewport shrinks", async () => {
  const observers: Array<{ targets: Element[]; resize: () => void }> = [];
  vi.stubGlobal("ResizeObserver", class {
    targets: Element[] = [];
    constructor(readonly resize: () => void) { observers.push(this); }
    observe(target: Element) { this.targets.push(target); }
    disconnect() { this.targets = []; }
  });
  const data = await mount();
  const log = node.querySelector<HTMLElement>('[role="log"]')!;
  log.style.scrollPaddingTop = "80px";
  let viewport = 500, bubbleTop = 450, bubbleHeight = 200;
  Object.defineProperties(log, {
    scrollHeight: { get: () => bubbleTop + bubbleHeight + 20 },
    clientHeight: { get: () => viewport },
  });
  const getRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    if (this === log) return new DOMRect(0, 0, 400, viewport);
    if (this.parentElement === log && this.matches(".assistant-message-row"))
      return new DOMRect(18, bubbleTop - log.scrollTop, 300, bubbleHeight);
    return getRect.call(this);
  });
  log.scrollTo = vi.fn((options: ScrollToOptions) => {
    log.scrollTop = options.top ?? 0;
    log.dispatchEvent(new Event("scroll"));
  });
  const message: AssistantMessage = {
    kind: "assistant", id: "reply", revision: 1, createdAt: 1,
    text: "A growing reply", streaming: true,
  };
  data.messages([message]);
  await advanceMotionTimers(2000);
  await flush();
  expect(log.scrollTop).toBe(170);
  const resize = () => act(() => {
    observers.filter((observer) => observer.targets.includes(log)).at(-1)!.resize();
  });

  // Character reveal can grow the bubble between polls. Automatic scrolling
  // stops at its start rather than pushing it behind the floating capsules.
  bubbleHeight = 900;
  resize();
  expect(log.scrollTop).toBe(370);
  expect(node.querySelector(".assistant-message-row")!.getBoundingClientRect().top).toBe(80);
  viewport = 300;
  resize();
  expect(log.scrollTop).toBe(370);

  // Reading farther down a long reply pauses following instead of snapping
  // the reader back to its start on the next resize or poll.
  log.scrollTop = 500;
  act(() => log.dispatchEvent(new Event("scroll")));
  vi.mocked(log.scrollTo).mockClear();
  bubbleHeight = 1100;
  resize();
  data.messages([{ ...message, revision: 2, text: "More of the reply" }]);
  await advanceMotionTimers(2000);
  await flush();
  expect(log.scrollTo).not.toHaveBeenCalled();

  log.scrollTop = 370;
  act(() => log.dispatchEvent(new Event("scroll")));
  bubbleTop = 1650;
  bubbleHeight = 80;
  data.messages([
    { ...message, revision: 2 },
    { ...message, id: "next", revision: 3, text: "Next reply" },
  ]);
  await advanceMotionTimers(2000);
  await flush();
  expect(log.scrollTop).toBe(1450);
  expect(log.lastElementChild!.getBoundingClientRect().top).toBe(200);
});

it("shows only the latest compact card for a repeated session", async () => {
  const data = await mount();
  const ref = { environmentId: "host", projectId: "project", sessionId: "task" };
  data.messages([1, 2, 3].map((revision) => ({
    kind: "session-card" as const, id: `card-${revision}`, revision, createdAt: revision,
    ref, title: `codex · Task ${revision}`, projectName: "Project", harness: "codex" as const,
    model: "codex:gpt-6.1-sol", actionId: `action-${revision}`, status: "completed" as const,
  })));
  await advanceMotionTimers(2000);
  await flush();
  expect(node.querySelectorAll(".assistant-card")).toHaveLength(1);
  expect(node.querySelector(".assistant-card-title strong")?.textContent).toBe("Task 3");
  expect(node.querySelector(".assistant-card button")?.getAttribute("aria-label")).toBe("Open session: Task 3");
  expect(node.querySelector(".assistant-card button")?.textContent).toBe("");
  expect(node.querySelector(".assistant-card-project")?.textContent).toBe("Project");
  expect(node.querySelector(".assistant-card-project svg")).not.toBeNull();
  expect(node.querySelector(".assistant-card-provider")?.getAttribute("aria-label")).toBe("Codex");
  expect(node.querySelector(".assistant-card-provider")?.textContent).toBe("");
  expect(node.querySelector(".assistant-card-model")?.textContent).toBe("gpt-6.1-sol");
});

it("picks settings values from a sheet and closes it with back", async () => {
  const data = await mount();
  act(() => button("Assistant options").click());
  act(() => button("Settings").click());
  act(() => button("Assistant permissions").click());
  expect(node.querySelector(".assistant-settings select")).toBeNull();
  const trigger = () =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.getAttribute("aria-label")?.startsWith("Assistant execution permissions:"),
    )!;
  act(() => trigger().click());
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  act(() => data.ref.current!.back());
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  expect(node.querySelector(".mobile-assistant-settings-page")).not.toBeNull();
  act(() => trigger().click());
  act(() =>
    [...document.querySelectorAll<HTMLElement>('[role="radio"]')]
      .find((r) => r.textContent === "Supervised")!
      .click(),
  );
  expect(trigger().getAttribute("aria-label")).toBe(
    "Assistant execution permissions: Supervised",
  );
  act(() => button("Save settings").click());
  await flush();
  expect(
    data.rpc.mock.calls.find(([m]) => m === "assistant.configure")?.[1].patch
      .runtimeMode,
  ).toBe("supervised");
});

it("closes only the nested settings picker on Escape", async () => {
  const data = await mount();
  act(() => button("Assistant options").click());
  act(() => button("Settings").click());
  act(() => button("Assistant permissions").click());
  await flush();
  await advanceMotionTimers(600);
  const page = node.querySelector<HTMLElement>(
    ".mobile-assistant-settings-page",
  )!;
  const trigger = page.querySelector<HTMLButtonElement>(
    '[aria-label="Assistant execution permissions: Full access"]',
  )!;
  act(() => trigger.click());
  const picker = node.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Assistant execution permissions"]',
  )!;
  act(() =>
    picker.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    })),
  );
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(
    page.closest(".mobile-sheet-backdrop")?.getAttribute("data-fold-state"),
  ).toBe("open");
  await advanceMotionTimers(600);
  expect(
    node.querySelector('[role="dialog"][aria-label="Assistant execution permissions"]'),
  ).toBeNull();
  expect(node.querySelector(".mobile-assistant-settings-page")).toBe(page);
  expect(data.close).not.toHaveBeenCalled();
});

it("acknowledges mobile assistant messages only while the page and document are visible", async () => {
  const data = fixture();
  data.messages([{ kind: "assistant", id: "reply", revision: 1, createdAt: 1, text: "Hello" }]);
  const render = (visible: boolean) => act(() => root.render(
    createElement(SurfaceVisibilityContext.Provider, { value: visible },
      createElement(MobileAssistant, {
        hostKey: "read-mobile", hostName: "Host", rpc: data.rpc as AssistantRpc, onOpen: () => {},
      })),
  ));
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  render(false);
  await flush();
  expect(localStorage.getItem("monocode.assistant-read:read-mobile")).toBeNull();
  render(true);
  await flush();
  expect(localStorage.getItem("monocode.assistant-read:read-mobile")).toBeNull();
  visibility.mockReturnValue("visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(localStorage.getItem("monocode.assistant-read:read-mobile")).toBe("1");
  render(false);
  data.messages([{ kind: "assistant", id: "next", revision: 2, createdAt: 2, text: "New reply" }]);
  await advanceMotionTimers(2000);
  expect(localStorage.getItem("monocode.assistant-read:read-mobile")).toBe("1");
  render(true);
  await flush();
  expect(localStorage.getItem("monocode.assistant-read:read-mobile")).toBe("2");
});

it("keeps one log observer across revisions and stops background polling while hidden", async () => {
  const observers: Array<{ targets: Set<Element>; observe: ReturnType<typeof vi.fn>; disconnected: boolean }> = [];
  vi.stubGlobal("ResizeObserver", class {
    targets = new Set<Element>();
    disconnected = false;
    observe = vi.fn((element: Element) => { this.targets.add(element); });
    unobserve = (element: Element) => { this.targets.delete(element); };
    disconnect = () => { this.disconnected = true; this.targets.clear(); };
    constructor() { observers.push(this); }
  });
  const data = fixture();
  const props = { hostKey: "host", hostName: "Computer", rpc: data.rpc as AssistantRpc, onOpen: vi.fn() };
  const render = (visible: boolean) => act(() => root.render(
    createElement(SurfaceVisibilityContext.Provider, { value: visible }, createElement(MobileAssistant, props)),
  ));
  render(true);
  await flush();
  const log = node.querySelector<HTMLElement>('[role="log"]')!;
  const observer = observers.find((entry) => entry.targets.has(log))!;
  const reply: AssistantMessage = { kind: "assistant", id: "reply", revision: 1, createdAt: 1, text: "Reply" };
  for (const revision of [1, 2]) {
    data.messages([{ ...reply, revision, text: `Reply ${revision}` }]);
    await advanceMotionTimers(2000);
    await flush();
    expect(observers.find((entry) => entry.targets.has(log))).toBe(observer);
    expect(observer.disconnected).toBe(false);
  }
  log.scrollTo = vi.fn();
  observer.observe.mockClear();
  await advanceMotionTimers(2000);
  await flush();
  expect(log.scrollTo).not.toHaveBeenCalled();
  expect(observer.observe).not.toHaveBeenCalled();
  render(false);
  expect(observer.disconnected).toBe(true);
  data.rpc.mockClear();
  await advanceMotionTimers(6000);
  expect(data.rpc).not.toHaveBeenCalled();
  render(true);
  await flush();
  expect(data.rpc).toHaveBeenCalledWith("assistant.get");
});
