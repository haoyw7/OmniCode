// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WatchedSessions } from "./BotSettings";
import { fullBotPolicy, type BotPolicy } from "../model/botView";
import {
  followSessionProjects,
  removeWatchedSession,
} from "../model/botSessions";
import { setUiLanguage } from "../../../shared/i18n/language";

let root: Root, node: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setUiLanguage("zh-CN");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  setUiLanguage("en");
  vi.unstubAllGlobals();
});

it("lists only followed conversations, keeps stale references removable, and removes the last item", async () => {
  const loadSessions = vi.fn(async () => [
    {
      id: "s",
      title: "codex · 修复页面",
      projectId: "p",
      harness: "codex" as const,
    },
    { id: "other", title: "无关会话", projectId: "p", harness: "pi" as const },
  ]);
  function Settings() {
    const [state, setState] = useState({
      policy: {
        ...fullBotPolicy(),
        followedSessions: [
          { projectId: "p", sessionId: "s" },
          { projectId: "p", sessionId: "missing" },
        ],
      },
      watches: [],
    });
    return createElement(WatchedSessions, {
      ...state,
      active: true,
      projectIds: ["p"],
      loadSessions,
      onRemove: (id) =>
        setState(
          (old) =>
            removeWatchedSession(old.policy, old.watches, id) as typeof old,
        ),
    });
  }
  await act(async () => root.render(createElement(Settings)));
  expect(node.textContent).toContain("已关注会话");
  expect(node.textContent).toContain("修复页面");
  expect(node.textContent).not.toContain("codex ·");
  expect(node.textContent).not.toContain("无关会话");
  expect(node.querySelectorAll(".assistant-watched-session")).toHaveLength(2);
  expect(
    node.querySelector(
      ".assistant-watched-session img, .assistant-watched-session svg",
    ),
  ).not.toBeNull();
  await act(async () =>
    node
      .querySelector<HTMLButtonElement>(
        '[aria-label="移除已关注会话：修复页面"]',
      )!
      .click(),
  );
  expect(node.querySelectorAll(".assistant-watched-session")).toHaveLength(1);
  await act(async () =>
    node
      .querySelector<HTMLButtonElement>(
        '[aria-label="移除已关注会话：missing"]',
      )!
      .click(),
  );
  expect(node.querySelectorAll(".assistant-watched-session")).toHaveLength(0);
  expect(node.textContent).toContain("暂无已关注会话");
});

it("follows multiple project scopes or all conversations and keeps individual removal available", async () => {
  const projects = ["项目甲", "项目乙", "项目丙"].map((name, index) => ({
    id: `p${index}`,
    name,
  }));
  const sessions = projects.map((p, index) => ({
    id: `s${index}`,
    title: `会话${index}`,
    projectId: p.id,
    harness: "codex" as const,
  }));
  const loadSessions = vi.fn(async () => sessions);
  function Settings() {
    const [policy, setPolicy] = useState<BotPolicy>(
      fullBotPolicy(),
    );
    return createElement(WatchedSessions, {
      active: true,
      policy,
      watches: [],
      projects,
      projectIds: projects.map((p) => p.id),
      loadSessions,
      onRemove: (id) =>
        setPolicy((old) => removeWatchedSession(old, [], id).policy),
      onFollowScope: (scope, rows) =>
        setPolicy((old) => followSessionProjects(old, scope, rows)),
    });
  }
  const button = (text: string) =>
    [...node.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === text,
    )!;
  await act(async () => root.render(createElement(Settings)));
  await act(async () => button("按项目关注").click());
  expect(button("按项目关注").getAttribute("aria-expanded")).toBe("true");
  for (const name of ["项目甲", "项目乙"])
    await act(async () =>
      [...node.querySelectorAll(".assistant-watch-project")]
        .find(
          (row) =>
            row.querySelector(".assistant-watch-project-name > span")
              ?.textContent === name,
        )!
        .querySelector("input")!
        .click(),
    );
  await act(async () => button("关注所选项目").click());
  expect(button("按项目关注").getAttribute("aria-expanded")).toBe("false");
  expect(node.querySelectorAll(".assistant-watched-session")).toHaveLength(2);
  expect(node.textContent).toContain("自动关注项目：项目甲, 项目乙");
  await act(async () =>
    node
      .querySelector<HTMLButtonElement>('[aria-label="移除已关注会话：会话0"]')!
      .click(),
  );
  expect(node.querySelectorAll(".assistant-watched-session")).toHaveLength(1);
  await act(async () => button("关注所有会话").click());
  expect(node.querySelectorAll(".assistant-watched-session")).toHaveLength(3);
  expect(node.textContent).toContain("自动关注所有会话");
  await act(async () =>
    node
      .querySelector<HTMLButtonElement>('[aria-label="移除已关注会话：会话1"]')!
      .click(),
  );
  expect(node.querySelectorAll(".assistant-watched-session")).toHaveLength(2);
  await act(async () => button("取消范围关注").click());
  expect(node.querySelectorAll(".assistant-watched-session")).toHaveLength(0);
});

it("lists recent conversations first and mounts large follow scopes a page at a time", async () => {
  const sessions = Array.from({ length: 120 }, (_, i) => ({
    id: `s${i}`,
    title: `会话 ${i}`,
    projectId: i % 2 ? "b" : "a",
    harness: "codex" as const,
    activityAt: i,
  }));
  const loadSessions = vi.fn(async () => sessions);
  await act(async () =>
    root.render(
      createElement(WatchedSessions, {
        active: true,
        policy: { ...fullBotPolicy(), followedProjects: "all" },
        watches: [],
        projectIds: ["a", "b"],
        projects: [
          { id: "a", name: "Alpha" },
          { id: "b", name: "Beta" },
        ],
        loadSessions,
        onRemove: () => {},
        onFollowScope: () => {},
      }),
    ),
  );
  const rows = () => node.querySelectorAll(".assistant-watched-session");
  expect(rows()).toHaveLength(50);
  expect(rows()[0].textContent).toContain("会话 119");
  const more = () =>
    node.querySelector<HTMLButtonElement>(".assistant-watched-more");
  expect(more()?.textContent).toContain("70");
  act(() => more()!.click());
  expect(rows()).toHaveLength(100);
  act(() => more()!.click());
  expect(rows()).toHaveLength(120);
  expect(more()).toBeNull();

  const search = node.querySelector<HTMLInputElement>('input[type="search"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "beta");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // Matching a project name finds its conversations; paging restarts.
  expect(rows()).toHaveLength(50);
  expect([...rows()].every((row) => row.textContent?.includes("Beta"))).toBe(true);
  expect(more()?.textContent).toContain("10");
});
