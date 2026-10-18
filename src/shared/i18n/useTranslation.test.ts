// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { EmptySession } from "../../features/sessions/ui/EmptySession";
import { setUiLanguage } from "./language";
import { useTranslation } from "./useTranslation";

afterEach(() => {
  setUiLanguage("en");
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("switches live labels while preserving mounted editor state and user content", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setUiLanguage("en");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Workspace() {
    const { t } = useTranslation();
    const [count, setCount] = useState(0);
    return createElement(
      "div",
      null,
      createElement(
        "button",
        { onClick: () => setCount(count + 1) },
        `${t("Settings")} ${count}`,
      ),
      createElement(EmptySession, {
        cwd: "/work/Settings",
        hasChatBackground: true,
        composer: createElement("textarea", {
          defaultValue: "My draft /plan 设置",
        }),
      }),
    );
  }
  try {
    await act(async () => root.render(createElement(Workspace)));
    const textarea = container.querySelector("textarea")!;
    await act(async () => container.querySelector("button")!.click());
    await act(async () => setUiLanguage("zh-CN"));
    expect(container.querySelector("button")?.textContent).toBe("设置 1");
    expect(container.querySelector("h1")?.textContent).toBe(
      "我们在 Settings 中做些什么？",
    );
    expect(container.querySelector("textarea")).toBe(textarea);
    expect(textarea.value).toBe("My draft /plan 设置");
    await act(async () => setUiLanguage("en"));
    expect(container.querySelector("button")?.textContent).toBe("Settings 1");
    expect(container.querySelector("h1")?.textContent).toBe(
      "What should we work on in Settings?",
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
