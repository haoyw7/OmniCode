// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import type { HostSessionSummary } from "../features/connections/model/protocol";
import { setUiLanguage } from "../shared/i18n/language";
import { HARNESS_ICONS } from "../features/sessions/ui/HarnessIcon";
import { notificationText } from "./notificationText";
import { mobileNotificationTexts, showBrowserActivityNotification, showBrowserAssistantNotification } from "./notifications";

afterEach(() => {
  setUiLanguage("en");
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("updates native Remote status when language changes and preserves the computer name", () => {
  const host = "wy-ubuntu <工作站> {host}";
  setUiLanguage("en");
  expect(mobileNotificationTexts(host).connected).toBe(`Connected to ${host}`);
  setUiLanguage("zh-CN");
  const texts = mobileNotificationTexts(host);
  expect(texts.remote).toBe("Remote");
  expect(texts.connected).toBe(`已连接到 ${host}`);
  expect(texts.reconnecting).toBe(`正在重新连接到 ${host}`);
  expect(texts.reply).toBe("收到了一条新回复。");
});

function browserNotification() {
  const close = vi.fn();
  const banner = { onclick: undefined as (() => void) | undefined, close };
  const notification = vi.fn(function (_title: string, _options?: NotificationOptions) { return banner; });
  Object.assign(notification, { permission: "granted" });
  vi.stubGlobal("Notification", notification);
  return { notification, banner, close };
}

function session(): HostSessionSummary {
  return {
    id: "conversation",
    projectId: "project",
    title: "登录修复 <用户标题>",
    harness: "codex",
    status: "idle",
    revision: 10,
    updatedAt: 100,
    notificationPreview: { reply: "Login now works.", input: "Which environment should I deploy to?" },
  };
}

it("uses each conversation's latest reply and keeps click navigation tied to that conversation", () => {
  const { notification, banner, close } = browserNotification();
  const current = session();
  const open = vi.fn();
  setUiLanguage("zh-CN");
  showBrowserActivityNotification(current, "reply", "host", open);
  expect(notification).toHaveBeenLastCalledWith(current.title, {
    body: "Login now works.", tag: "host:conversation", icon: HARNESS_ICONS.codex,
  });
  banner.onclick?.();
  expect(open).toHaveBeenCalledWith({ environmentId: "host", projectId: "project", sessionId: "conversation" });
  expect(close).toHaveBeenCalledOnce();
  showBrowserActivityNotification({ ...current, id: "other", title: "Another task", notificationPreview: { reply: "Deployment completed.", input: null } }, "reply", "host", open);
  expect(notification).toHaveBeenLastCalledWith("Another task", {
    body: "Deployment completed.", tag: "host:other", icon: HARNESS_ICONS.codex,
  });
});

it("shows the concrete input request and falls back for older Hosts without showing an unrelated reply", () => {
  const { notification } = browserNotification();
  const current = session();
  showBrowserActivityNotification(current, "input", "host", vi.fn());
  expect(notification).toHaveBeenLastCalledWith(current.title, {
    body: "Which environment should I deploy to?", tag: "host:conversation", icon: HARNESS_ICONS.codex,
  });
  setUiLanguage("zh-CN");
  current.notificationPreview!.input = "  ";
  showBrowserActivityNotification(current, "input", "host", vi.fn());
  expect(notification.mock.calls.at(-1)?.[1]).toMatchObject({ body: mobileNotificationTexts().input });
  delete current.notificationPreview;
  showBrowserActivityNotification(current, "reply", "host", vi.fn());
  expect(notification.mock.calls.at(-1)?.[1]).toMatchObject({ body: "收到了一条新回复。" });
});

it("replaces only the stored agent prefix with its icon and preserves user titles", () => {
  const { notification } = browserNotification();
  const current = { ...session(), title: "codex · codex 使用说明", notificationPreview: { reply: "**拉取成功。** UID 为 `23358`。", input: null } };
  showBrowserActivityNotification(current, "reply", "host", vi.fn());
  expect(notification).toHaveBeenLastCalledWith("codex 使用说明", {
    body: "拉取成功。 UID 为 23358。", icon: HARNESS_ICONS.codex, tag: "host:conversation",
  });
  expect(current.title).toBe("codex · codex 使用说明");
  showBrowserActivityNotification({ ...current, title: "claude · 用户标题" }, "reply", "host", vi.fn());
  expect(notification.mock.calls.at(-1)?.[0]).toBe("claude · 用户标题");
  setUiLanguage("zh-CN");
  showBrowserActivityNotification({ ...current, title: "codex" }, "reply", "host", vi.fn());
  expect(notification.mock.calls.at(-1)?.[0]).toBe("新会话");
  expect(mobileNotificationTexts().newSession).toBe("新会话");
});

it.each([
  ["**实际增量拉取成功。** 已确认 byn，UID 为 `23358`。", "实际增量拉取成功。 已确认 byn，UID 为 23358。"],
  ["# 结果\n> **成功**\n- [x] 完成\n1. _测试_ ~~旧值~~", "结果 成功 完成 测试 旧值"],
  ["[文档](https://example.com/a_(b)) ![预览](image.png) [详情][ref]\n[ref]: https://example.com", "文档 预览 详情"],
  ["```sh\necho **/*.ts && echo $HOME\n```\n`a_b * 2`", "echo **/*.ts && echo $HOME a_b * 2"],
  ["user_name /tmp/a-b.ts #123 2 > 1 <user> \\*literal\\*", "user_name /tmp/a-b.ts #123 2 > 1 <user> *literal*"],
  ["**截断的回复…", "截断的回复…"],
  ["**粗体 *嵌套* 内容** 和 *斜体 **嵌套** 内容*", "粗体 嵌套 内容 和 斜体 嵌套 内容"],
  ["| 项目 | 结果 |\n| --- | :---: |\n| `a|b` | **通过** |", "项目 结果 a|b 通过"],
  ["## 标题 ##\n保留末尾 #", "标题 保留末尾 #"],
  ["---\n***\n___", ""],
])("formats Markdown preview %j as readable text", (source, expected) => {
  expect(notificationText(source)).toBe(expected);
});

it("cleans assistant and input previews and falls back when only formatting remains", () => {
  const { notification } = browserNotification();
  showBrowserActivityNotification({ ...session(), notificationPreview: { reply: null, input: "### 选择 **环境**" } }, "input", "host", vi.fn());
  expect(notification.mock.calls.at(-1)?.[1]?.body).toBe("选择 环境");
  showBrowserAssistantNotification({ id: "assistant", name: "小管家", revision: 2,
    latest: { id: "reply", revision: 2, kind: "reply", text: "**完成** `task_1`" } }, "host", vi.fn());
  expect(notification.mock.calls.at(-1)?.[1]?.body).toBe("完成 task_1");
  showBrowserActivityNotification({ ...session(), notificationPreview: { reply: "---", input: null } }, "reply", "host", vi.fn());
  expect(notification.mock.calls.at(-1)?.[1]?.body).toBe(mobileNotificationTexts().reply);
});

it("opens the assistant from its browser notification and localizes attachment-only replies", () => {
  const { notification, banner } = browserNotification();
  const open = vi.fn();
  setUiLanguage("zh-CN");
  showBrowserAssistantNotification({ id: "assistant", name: "小管家", revision: 2,
    latest: { id: "reply", revision: 2, kind: "reply", text: "" } }, "host", open);
  expect(notification).toHaveBeenCalledWith("小管家", { body: "收到了一条新回复。", tag: "host:assistant" });
  banner.onclick?.();
  expect(open).toHaveBeenCalledWith({ environmentId: "host", kind: "assistant" });
});
