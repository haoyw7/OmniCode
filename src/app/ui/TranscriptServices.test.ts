// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TranscriptServices } from "./TranscriptServices";
import { AgentMarkdown } from "../../shared/ui/markdown/AgentMarkdown";
import { setUiLanguage } from "../../shared/i18n/language";

vi.mock("../../features/inbox/ui/InboxMedia", () => ({
  InboxMedia: ({ src, alt }: { src: string; alt?: string }) =>
    createElement("span", { "data-trusted-media": src }, alt),
}));

afterEach(() => vi.unstubAllGlobals());

it("preserves the inbox media allowlist while keeping generic Markdown remote images disabled", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  const root = createRoot(node);
  const trusted = "https://github.com/user-attachments/assets/123";
  const text = `![Allowed](${trusted})\n\n![Blocked](https://example.com/image.png)`;
  try {
    await act(async () => root.render(createElement(TranscriptServices, null,
      createElement(AgentMarkdown, { text, allowRemoteMedia: true }))));
    expect(node.querySelectorAll("[data-trusted-media]")).toHaveLength(1);
    expect(node.querySelector("[data-trusted-media]")?.getAttribute("data-trusted-media")).toBe(trusted);
    expect(node.querySelector('img[src="https://example.com/image.png"]')).toBeNull();
    await act(async () => root.render(createElement(TranscriptServices, null,
      createElement(AgentMarkdown, { text }))));
    expect(node.querySelector("[data-trusted-media]")).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});

it("injects the configured highlighter and desktop copy service into shared Markdown", async () => {
  setUiLanguage("en");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const node = document.createElement("div");
  const root = createRoot(node);
  try {
    await act(async () => root.render(createElement(TranscriptServices, null,
      createElement(AgentMarkdown, { text: "```js lineNumbers\nconst answer = 42;\n```" }))));
    await act(async () => {
      await vi.waitFor(() => expect(node.querySelector(".markdown-code-token")).not.toBeNull());
    });
    expect(node.querySelector(".markdown-code-numbered-line")?.textContent).toBe("const answer = 42;");
    expect(node.querySelector(".markdown-code-token")?.getAttribute("style")).toContain("--sdm-c");
    await act(async () => node.querySelector<HTMLButtonElement>('[aria-label="Copy code"]')!.click());
    expect(copy).toHaveBeenCalledWith("const answer = 42;");
  } finally {
    await act(async () => root.unmount());
    copy.mockRestore();
  }
});
