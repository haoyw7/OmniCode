// @vitest-environment happy-dom
import { startMotionClock, stopMotionClock, finishMotion } from "../../../../tests/helpers/sharedMotionClock";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";
import { Clipboard } from "@capacitor/clipboard";
import { BotChat } from "./BotChat";
import { MobileAssistant } from "../../../mobile/MobileAssistant";
import { fullBotPolicy, type BotMessage } from "../model/botView";
import { setUiLanguage } from "../../../shared/i18n/language";

vi.mock("./BotWorkerDetails", () => ({
  BotWorkerDetails: () => null,
}));
vi.mock("@capacitor/clipboard", () => ({ Clipboard: { write: vi.fn() } }));
let root: Root, node: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}
function openCopyMenu(kind = "assistant", label = "Copy") {
  const bubble = node.querySelector(`.assistant-message-${kind}`)!;
  act(() => {
    bubble.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, pointerType: "touch", button: 0, clientX: 80, clientY: 100,
    }));
    vi.advanceTimersByTime(450);
  });
  act(() => bubble.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch" })));
  return [...node.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
    .find((button) => button.textContent === label)!;
}
const sentAt = Date.UTC(2026, 9, 5, 12, 30);
async function mount(mobile: boolean) {
  let messages: BotMessage[] = [
    {
      id: "user",
      kind: "user",
      revision: 1,
      createdAt: sentAt,
      text: "My draft",
      readAt: null,
    },
    {
      id: "reply",
      kind: "assistant",
      revision: 2,
      createdAt: sentAt - 5000,
      text: "**Original**\nreply",
    },
  ];
  const rpc = vi.fn(async (method: string) => {
    if (method === "environment.describe")
      return { capabilities: ["assistant.v1"] };
    if (method === "assistant.get")
      return {
        id: "a",
        name: "Assistant",
        enabled: true,
        lifecycle: "idle",
        triggers: { user: true },
        policy: fullBotPolicy(),
      };
    if (method === "assistant.messages")
      return {
        entries: messages,
        nextRevision: Math.max(...messages.map((m) => m.revision)),
        hasMore: false,
      };
    if (method === "models.list") return { models: {}, errors: {} };
    return [];
  });
  act(() =>
    root.render(
      createElement(mobile ? MobileAssistant : BotChat, {
        hostKey: "host",
        hostName: "Host",
        rpc: rpc as any,
        onOpen: () => {},
      }),
    ),
  );
  await flush();
  return (next?: BotMessage[]) => {
    messages = next ?? messages.map((m) =>
      m.id === "user" ? { ...m, readAt: sentAt + 6000, revision: 3 } : m,
    );
  };
}
it.each([false, true])(
  "shows Host read state and stable send time; copies only message text (mobile=%s)",
  async (mobile) => {
    const markRead = await mount(mobile);
    const user = node.querySelector(".assistant-message-row-user")!;
    expect(
      node.querySelector(".assistant-message .assistant-message-meta"),
    ).toBeNull();
    expect(user.querySelector(".assistant-read-state")?.textContent).toBe(
      "Unread",
    );
    expect(
      node.querySelector(
        ".assistant-message-row-assistant .assistant-read-state",
      ),
    ).toBeNull();
    expect(user.querySelector("time")?.dateTime).toBe(
      new Date(sentAt).toISOString(),
    );
    const copy = mobile ? openCopyMenu() : node.querySelector<HTMLButtonElement>(
      '.assistant-message-row-assistant button[aria-label="Copy message"]',
    )!;
    if (mobile) {
      expect(node.querySelector(".assistant-message-row-assistant .assistant-message-meta")).toBeNull();
      expect(node.querySelector(".assistant-message-meta button")).toBeNull();
    }
    await act(async () => copy.click());
    expect(await navigator.clipboard.readText()).toBe("**Original**\nreply");
    if (!mobile) expect(copy.getAttribute("aria-label")).toBe("Copied");
    markRead();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await flush();
    expect(user.querySelector(".assistant-read-state")?.textContent).toBe(
      "Read",
    );
    expect(user.querySelector("time")?.dateTime).toBe(
      new Date(sentAt).toISOString(),
    );
    expect(node.querySelectorAll(".assistant-message-row-user")).toHaveLength(
      1,
    );
  },
);
it.each([false, true])(
  "shows receipts only on the latest unanswered user message (mobile=%s)",
  async (mobile) => {
    const update = await mount(mobile);
    const older = node.querySelector(".assistant-message-row-user")!;
    const latest: BotMessage = {
      id: "latest-user",
      kind: "user",
      revision: 3,
      createdAt: sentAt + 10000,
      text: "My next message",
      readAt: null,
    };
    update([
      {
        id: "user", kind: "user", revision: 4, createdAt: sentAt,
        text: "My draft", readAt: sentAt + 6000,
      },
      latest,
      {
        id: "status", kind: "status", revision: 5,
        createdAt: sentAt + 15000, text: "Working",
      },
    ]);
    await act(async () => vi.advanceTimersByTime(2000));
    await flush();
    const newest = node.querySelectorAll(".assistant-message-row-user")[1];
    expect(older.querySelector(".assistant-read-state")).toBeNull();
    expect(older.querySelector("time")?.dateTime).toBe(new Date(sentAt).toISOString());
    expect(!!older.querySelector('button[aria-label="Copy message"]')).toBe(!mobile);
    expect(newest.querySelector(".assistant-read-state")?.textContent).toBe("Unread");
    expect(node.querySelectorAll(".assistant-read-state")).toHaveLength(1);

    update([{ ...latest, revision: 6, readAt: sentAt + 16000 }]);
    await act(async () => vi.advanceTimersByTime(2000));
    await flush();
    expect(newest.querySelector(".assistant-read-state")?.textContent).toBe("Read");
    expect(node.querySelectorAll(".assistant-read-state")).toHaveLength(1);

    // Older Hosts may omit receipts on the latest message; an older receipt
    // must stay hidden rather than becoming the displayed status again.
    update([{ ...latest, revision: 7, readAt: undefined }]);
    await act(async () => vi.advanceTimersByTime(2000));
    await flush();
    expect(node.querySelector(".assistant-read-state")).toBeNull();
  },
);
it.each([
  [false, null],
  [false, sentAt + 1000],
  [true, null],
  [true, sentAt + 1000],
] as const)(
  "clears receipts after a reply and keeps late receipt updates hidden (mobile=%s, readAt=%s)",
  async (mobile, readAt) => {
    const update = await mount(mobile);
    const user: BotMessage = {
      id: "user", kind: "user", revision: 3, createdAt: sentAt,
      text: "My draft", readAt,
    };
    update([user]);
    await act(async () => vi.advanceTimersByTime(2000));
    await flush();
    expect(node.querySelector(".assistant-read-state")?.textContent).toBe(
      readAt === null ? "Unread" : "Read",
    );

    update([{
      id: "next-reply", kind: "assistant", revision: 4,
      createdAt: sentAt + 5000, text: "Next answer",
    }]);
    await act(async () => vi.advanceTimersByTime(2000));
    await flush();
    expect(node.querySelector(".assistant-read-state")).toBeNull();
    const row = node.querySelector(".assistant-message-row-user")!;
    expect(row.querySelector("time")?.dateTime).toBe(new Date(sentAt).toISOString());
    expect(!!row.querySelector('button[aria-label="Copy message"]')).toBe(!mobile);

    update([{ ...user, revision: 5, readAt: sentAt + 6000 }]);
    await act(async () => vi.advanceTimersByTime(2000));
    await flush();
    expect(node.querySelector(".assistant-read-state")).toBeNull();

    update([{
      id: "latest-user", kind: "user", revision: 6,
      createdAt: sentAt + 10000, text: "Another message", readAt: null,
    }]);
    await act(async () => vi.advanceTimersByTime(2000));
    await flush();
    expect(node.querySelectorAll(".assistant-read-state")).toHaveLength(1);
    expect(node.querySelector(".assistant-read-state")?.textContent).toBe("Unread");
    expect(row.querySelector(".assistant-read-state")).toBeNull();
  },
);
it.each(["assistant", "user"])("copies %s messages with the native clipboard and localized actions", async (kind) => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  const write = vi.spyOn(Clipboard, "write").mockResolvedValue();
  setUiLanguage("zh-CN");
  await mount(true);
  expect(node.querySelector(".assistant-read-state")?.textContent).toBe("未读");
  const copy = openCopyMenu(kind, "复制");
  expect(node.querySelector('[role="dialog"][aria-label="消息操作"]')).not.toBeNull();
  if (kind === "user") expect(copy.closest('[role="dialog"]')?.textContent).not.toContain("回复");
  await act(async () => copy.click());
  expect(write).toHaveBeenCalledWith({ string: kind === "assistant" ? "**Original**\nreply" : "My draft" });
  await act(async () => { await finishMotion(120); });
  expect(node.querySelector('[role="dialog"][aria-label="消息操作"]')).toBeNull();
});
it("surfaces a clipboard failure without claiming success", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  vi.spyOn(Clipboard, "write").mockRejectedValue(
    new Error("Clipboard unavailable"),
  );
  await mount(true);
  const copy = openCopyMenu();
  await act(async () => copy.click());
  expect(node.querySelector('[role="alert"]')?.textContent).toContain(
    "Clipboard unavailable",
  );
  expect(node.querySelector('button[aria-label="Copied"]')).toBeNull();
});
