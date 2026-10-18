// @vitest-environment happy-dom
import { startMotionClock, stopMotionClock, finishMotion } from "../../../../tests/helpers/sharedMotionClock";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BotMessage } from "../model/botView";
import { BotMessages } from "./BotMessages";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { quoteBotReply, splitBotReply } from "../model/botReply";

vi.mock("../../sessions/ui/AgentMarkdown", () => ({
  AgentMarkdown: vi.fn(({ text }: { text: string }) =>
    createElement("p", null, text),
  ),
}));
vi.mock("../../sessions/ui/useTranscriptRenderingPlatform", () => ({
  AfterTextReveal: ({ children }: { children: React.ReactNode }) => children,
}));
let root: Root, node: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  startMotionClock();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  vi.mocked(AgentMarkdown).mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  stopMotionClock();
  vi.unstubAllGlobals();
});

it.each([true, false])("separates the quote above a mobile sent bubble while retaining full copy text (mobile: %s)", (mobile) => {
  const quote = "我先检查你电脑上\n\n本地提交和远程分支，再推送已有提交";
  const text = `${quoteBotReply(quote)}\n\n你好\n请继续`;
  const bindReply = vi.fn(() => ({}));
  act(() => root.render(createElement(BotMessages, {
    messages: [{ kind: "user", id: "sent", revision: 1, createdAt: 1, text }],
    canRead: true,
    mobile,
    busy: false,
    bindReply,
    onOpen: vi.fn(),
    onRespond: vi.fn(),
  })));
  expect(node.querySelector(".assistant-message-user")?.textContent).toBe(mobile ? "你好\n请继续" : text);
  const context = node.querySelector(".assistant-message-reply-context");
  if (mobile) {
    expect(context?.textContent).toBe(quote);
    expect(context?.querySelector("svg")).not.toBeNull();
    expect(bindReply).toHaveBeenCalledWith(text, false);
  } else expect(context).toBeNull();
});

it.each([true, false])("keeps delegation status compatible with mobile while rendering desktop cards (mobile: %s)", (mobile) => {
  const renderBotDelegation = vi.fn((id: string, revision: number) => createElement("article", { "data-delegation": id }, `Delegation revision ${revision}`));
  const message = { id: "delegation-status", kind: "status", code: "delegation", text: "Bot request completed", delegationId: "d-1", revision: 7, createdAt: 1 } as BotMessage;
  act(() => root.render(createElement(BotMessages, {
    messages: [message], mobile, canRead: false, busy: false,
    onOpen: vi.fn(), onRespond: vi.fn(), bindReply: () => ({}), renderBotDelegation,
  })));
  if (mobile) {
    expect(renderBotDelegation).not.toHaveBeenCalled();
    expect(node.querySelector(".assistant-message-status")?.textContent).toBe(message.text);
  } else {
    expect(renderBotDelegation).toHaveBeenCalledWith("d-1", 7);
    expect(node.querySelector('[data-delegation="d-1"]')?.textContent).toBe("Delegation revision 7");
  }
});
it("recognizes legacy multiline quotes without consuming the reply's own paragraphs", () => {
  expect(splitBotReply("> First\r\n> \r\n> Last\r\n\r\nReply\r\n\r\nDetails")).toEqual({
    quote: "First\n\nLast", text: "Reply\r\n\r\nDetails",
  });
  for (const text of ["Hello\n\nWorld", "> literal without reply", "> Quote\nUnquoted\n\nBody", "A > B\n\nBody"])
    expect(splitBotReply(text)).toBeUndefined();
});

it("leaves settled message rows alone while the final reply grows", () => {
  const messages: BotMessage[] = Array.from(
    { length: 40 },
    (_, index) => ({
      kind: "assistant",
      id: String(index),
      text: `Reply ${index}`,
      revision: index,
      createdAt: index,
    }),
  );
  const actions = {
    onOpen: vi.fn(),
    onRespond: vi.fn(),
    bindReply: vi.fn(() => ({})),
  };
  const render = (messages: BotMessage[], busy = false) =>
    act(() =>
      root.render(
        createElement(BotMessages, {
          ...actions,
          messages,
          canRead: true,
          allowedProjects: "all",
          mobile: true,
          busy,
        }),
      ),
    );
  render(messages);
  vi.mocked(AgentMarkdown).mockClear();
  actions.bindReply.mockClear();
  render(messages);
  render(messages, true);
  expect(AgentMarkdown).not.toHaveBeenCalled();
  expect(actions.bindReply).not.toHaveBeenCalled();
  const next = messages.slice();
  next[39] = {
    ...next[39],
    text: "New output",
    revision: 41,
  } as BotMessage;
  render(next, true);
  expect(AgentMarkdown).toHaveBeenCalledTimes(1);
  expect(actions.bindReply).toHaveBeenCalledOnce();
  expect(node.textContent).toContain("New output");
});

it.each(["user", "assistant"] as const)("renders persisted %s attachments above the caption and opens them", async kind => {
  const image = { id: "photo", name: "photo.png", mimeType: "image/png", kind: "image" as const, size: 3 };
  const readImage = vi.fn(async () => btoa("png"));
  const props = {
    messages: [{ id: "message", revision: 1, createdAt: 1, kind, text: "Caption", attachments: [image,
      { id: "file", name: "notes.txt", mimeType: "text/plain", kind: "file" as const, size: 1 },
    ] }],
    canRead: true, mobile: true, busy: false, readImage, onOpenAttachment: vi.fn(),
    bindReply: vi.fn(() => ({})), onOpen: vi.fn(), onRespond: vi.fn(),
  };
  await act(async () => root.render(createElement(BotMessages, props)));
  const media = node.querySelector(".assistant-message-media")!;
  expect(media.querySelector(".attachment-chip-thumbnail")?.getAttribute("src")).toBe(`data:image/png;base64,${btoa("png")}`);
  expect(media.querySelector(".attachment-chip-card-name")?.textContent).toBe("notes.txt");
  expect(media.nextElementSibling?.textContent).toBe("Caption");
  act(() => media.querySelector<HTMLButtonElement>("[aria-label=\"Open notes.txt\"]")!.click());
  expect(props.onOpenAttachment).toHaveBeenCalledExactlyOnceWith("message", props.messages[0].attachments[1]);
  expect(readImage).toHaveBeenCalledExactlyOnceWith("message", image);
  await act(async () => root.render(createElement(BotMessages, { ...props, busy: true })));
  await act(async () => root.render(createElement(BotMessages, {
    ...props, messages: [{ ...props.messages[0], revision: 2, attachments: props.messages[0].attachments.map(file => ({ ...file })) }],
  })));
  expect(readImage).toHaveBeenCalledOnce();
  act(() => media.querySelector<HTMLButtonElement>("button")!.click());
  expect(document.querySelector(".image-lightbox img")?.getAttribute("alt")).toBe("photo.png");
  act(() => document.querySelector<HTMLButtonElement>(".image-lightbox-close")!.click());
  await act(async () => { await finishMotion(); });
  expect(document.querySelector(".image-lightbox")).toBeNull();
});

it("shows image-only history without an empty bubble and falls back to its filename if unavailable", async () => {
  const readImage = vi.fn().mockRejectedValue(new Error("Older Host"));
  await act(async () => root.render(createElement(BotMessages, {
    messages: [{ id: "message", revision: 1, createdAt: 1, kind: "user", text: "", attachments: [
      { id: "photo", name: "photo.png", mimeType: "image/png", kind: "image", size: 3 },
    ] }],
    canRead: true, mobile: true, busy: false, readImage,
    bindReply: vi.fn(() => ({})), onOpen: vi.fn(), onRespond: vi.fn(),
  })));
  expect(node.querySelector(".assistant-message-user")).toBeNull();
  expect(node.querySelector(".assistant-message-media")?.textContent).toBe("photo.png");
  expect(node.querySelector(".attachment-chip-thumbnail")).toBeNull();
});

it("connects adjacent desktop bubbles without connecting across senders or long gaps", () => {
  const messages: BotMessage[] = [
    { id: "a", kind: "assistant", text: "One", revision: 1, createdAt: 1 },
    { id: "b", kind: "assistant", text: "Two", revision: 2, createdAt: 2 },
    { id: "c", kind: "user", text: "Three", revision: 3, createdAt: 3 },
    { id: "d", kind: "user", text: "Four", revision: 4, createdAt: 60004 },
  ];
  act(() => root.render(createElement(BotMessages, { messages, botsLayout: true, canRead: true, mobile: false, busy: false, bindReply: () => ({}), onOpen: () => {}, onRespond: () => {} })));
  expect(node.querySelector('[data-message-id="b"]')?.getAttribute("data-connected")).toBe("true");
  expect(node.querySelector('[data-message-id="c"]')?.hasAttribute("data-connected")).toBe(false);
  expect(node.querySelector('[data-message-id="d"]')?.hasAttribute("data-connected")).toBe(false);
});
