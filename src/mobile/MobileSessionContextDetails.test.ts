// @vitest-environment happy-dom
import { act, createElement, createRef, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { MobileSessionStatus } from "./MobileSessionStatus";
import { newSession } from "../features/sessions/model/session";
import { setUiLanguage } from "../shared/i18n/language";
import { applyReducedMotion } from "../shared/lib/reducedMotion";

vi.mock("./MobileSheet", () => ({
  SHEET_WIDTH: { list: 300 },
  MobileSheet: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));

afterEach(() => { setUiLanguage("en"); applyReducedMotion("system"); vi.unstubAllGlobals(); });

it("opens localized context details from mobile session status without translating tool names", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  applyReducedMotion("on");
  setUiLanguage("zh-CN");
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const session = { ...newSession("claude", "/repo"), context: {
    used: 1000, window: 10000, breakdown: {
      used: 1000, window: 10000, updatedAt: 1000, estimated: true,
      categories: [{ name: "Messages", tokens: 1000, kind: "used" as const }],
      toolResultTokens: 600,
      tools: [{ name: "mcp__demo__read", group: "mcp" as const, tokens: 100, deferred: true }],
    },
  } };
  try {
    act(() => root.render(createElement(MobileSessionStatus, {
      snapshot: { session, projectId: "project", revision: 1, status: "idle", createdAt: 1, updatedAt: 1 },
      hostName: "Host", hostStatus: { state: "connected" }, anchor: createRef<HTMLElement>(), onClose: () => {},
    })));
    const toggle = node.querySelector<HTMLButtonElement>(".mobile-status-context-toggle")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    act(() => toggle.click());
    expect(node.textContent).toContain("工具结果");
    expect(node.textContent).toContain("6.0%");
    act(() => node.querySelector<HTMLButtonElement>(".context-breakdown-toggle")!.click());
    expect(node.textContent).toContain("mcp__demo__read");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  } finally {
    act(() => root.unmount());
    node.remove();
  }
});
