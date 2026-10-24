import { createRoot } from "react-dom/client";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MarkdownDocumentPreview } from "../../../shared/ui/markdown/MarkdownDocumentPreview";

describe("MarkdownDocumentPreview", () => {
  it.each([
    "---\r\ntitle: Windows\r\n---\r\n\r\n# Heading",
    "\uFEFF---\ntitle: BOM\n---\n\n# Heading",
    "---\ntitle: End marker\n...\n\n# Heading",
    "---\n---\n\n# Heading",
  ])("separates leading frontmatter from the Markdown body: %j", (text) => {
    const html = renderToStaticMarkup(
      createElement(MarkdownDocumentPreview, {
        text,
        metadataLabel: "Properties",
      }),
    );

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Properties");
    expect(html).toMatch(/<h1[^>]*>Heading<\/h1>/);
    expect(html).not.toContain('data-streamdown="horizontal-rule"');
  });

  it.each([
    "# No frontmatter",
    "---\ntitle: unfinished\n\n# Still ordinary Markdown",
    "Before\n\n---\ntitle: not at the start\n---",
  ])("leaves ordinary or unfinished Markdown untouched: %j", (text) => {
    const html = renderToStaticMarkup(
      createElement(MarkdownDocumentPreview, {
        text,
        metadataLabel: "Properties",
      }),
    );

    expect(html).not.toContain('aria-expanded="false"');
  });

  it("reveals verbatim metadata and closes it through the shared disclosure", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const node = document.createElement("div");
    document.body.append(node);
    const root = createRoot(node);
    try {
      await act(async () => root.render(createElement(MarkdownDocumentPreview, {
        text: "---\ntitle: Example Note\ntags:\n  - alpha\n  - beta\n---\n\nBody.", metadataLabel: "Properties",
      })));
      const trigger = node.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(node.querySelector("pre")).toBeNull();
      await act(async () => trigger.click());
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(node.querySelector("pre")?.textContent?.trim()).toBe("title: Example Note\ntags:\n  - alpha\n  - beta");
      expect(node.querySelector("p")?.textContent).toBe("Body.");
      expect(node.querySelector("ul")).toBeNull();
      await act(async () => trigger.click());
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(node.querySelector('[data-fold-state="closing"], [data-fold-state="closed"]') ?? node.querySelector("pre")).toBeTruthy();
    } finally {
      await act(async () => root.unmount());
      node.remove();
      vi.unstubAllGlobals();
    }
  });

  // https://github.com/hardbeat920/monocode/issues/591
  it("keeps consecutive lines on their own lines", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownDocumentPreview, {
        text: "> first line\n> second line\n> third line",
        metadataLabel: "Properties",
      }),
    );

    expect(html).toContain("<p>first line<br/>second line<br/>third line</p>");
  });
});
