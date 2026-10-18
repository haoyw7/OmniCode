// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setUiLanguage } from "../../../shared/i18n/language";
import type { Block, HarnessId } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  setUiLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setUiLanguage("en");
  vi.unstubAllGlobals();
});

function render(harness: HarnessId, message: string, notice?: Block["notice"]) {
  const blocks: Block[] = [
    {
      id: "user",
      role: "user",
      text: "Continue",
      turnModel: { harness, id: "fixture", name: "Fixture" },
    },
    {
      id: "error",
      role: "system",
      text: message,
      ...(notice ? { notice } : {}),
    },
  ];
  act(() => root.render(createElement(AgentTranscript, { harness, blocks })));
  return blocks;
}

it.each<[HarnessId, string]>([
  ["codex", "thread fixture already has an active writer"],
  [
    "claude",
    "This conversation is already open in another running Claude session",
  ],
  [
    "omp",
    "Session publish lock unavailable for /tmp/chat.jsonl: another writer holds the publish lock",
  ],
  [
    "fx",
    "This session is open in another fx. Close it there, then press enter to retry.",
  ],
  [
    "hermes",
    "This chat is open in another Hermes window/terminal. Use it there, or start a new chat here.",
  ],
  [
    "cursor",
    "Chat fixture is already running in persistent session background",
  ],
])(
  "explains %s ownership errors without changing saved provider text",
  (harness, message) => {
    const blocks = render(harness, message, "error");
    expect(container.textContent).toContain("Session is in use elsewhere");
    expect(container.textContent).toContain("saved conversation");
    const details = container.querySelector("details");
    expect(details?.open).toBe(false);
    expect(details?.querySelector("pre")?.textContent).toBe(message);
    expect(blocks[1].text).toBe(message);
  },
);

it("keeps legacy Host lock errors visible outside the collapsed work trail", () => {
  const blocks = render("codex", "thread fixture already has an active writer");
  expect(container.textContent).toContain("Session is in use elsewhere");
  expect(blocks[1].notice).toBeUndefined();
});

it("updates the guidance language while preserving the original error", () => {
  const message = "thread fixture already has an active writer";
  render("codex", message, "error");
  act(() => setUiLanguage("zh-CN"));
  expect(container.textContent).toContain("会话正在其他客户端中使用");
  expect(container.querySelector("details pre")?.textContent).toBe(message);
});

it("does not turn ordinary busy or authentication errors into ownership notices", () => {
  render(
    "hermes",
    "Session is busy; switch models while the session is idle",
    "error",
  );
  expect(container.textContent).not.toContain("Session is in use elsewhere");
  expect(container.querySelector("[data-session-access-notice]")).toBeNull();
  render("codex", "authentication required", "error");
  expect(container.querySelector("[data-session-access-notice]")).toBeNull();
});

it("distinguishes unavailable fx access from confirmed external ownership", () => {
  render("fx", "Session is busy", "error");
  expect(container.textContent).toContain("Session is temporarily unavailable");
  expect(container.textContent).not.toContain(
    "Another client is keeping this session open",
  );
});

it("uses the historical turn's provider after switching the session provider", () => {
  const blocks: Block[] = [
    {
      id: "user",
      role: "user",
      text: "Continue",
      turnModel: { harness: "codex", id: "fixture", name: "Fixture" },
    },
    {
      id: "error",
      role: "system",
      text: "thread fixture already has an active writer",
    },
  ];
  act(() =>
    root.render(createElement(AgentTranscript, { harness: "fx", blocks })),
  );
  expect(container.textContent).toContain("Session is in use elsewhere");
  expect(container.textContent).toContain("Stopping a Codex reply");
});
