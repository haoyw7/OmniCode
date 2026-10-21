import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";

describe("AgentMarkdown text direction", () => {
  it("detects direction independently for RTL and LTR blocks", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: [
          "# راهنمای تنظیمات",
          "",
          "این متن فارسی است.",
          "",
          "1. مرحله اول",
          "2. مرحله دوم",
          "",
          "English remains left to right.",
        ].join("\n"),
      }),
    );

    expect(markup).toMatch(/dir="rtl"[^>]*><h1/);
    expect(markup).toMatch(/dir="rtl"[^>]*><p/);
    expect(markup).toMatch(/dir="rtl"[^>]*><ol/);
    expect(markup).toMatch(/dir="ltr"[^>]*><p/);
  });

  it("isolates links and inline code inside RTL prose", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "مسیر `templates/admin/settings.html` و [پیوند](https://example.com) را بررسی کنید.",
      }),
    );

    expect(markup).toContain('<code dir="ltr"');
    expect(markup).toContain('dir="auto"');
  });

  it("keeps fenced code blocks LTR when their content is Arabic", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```txt\nمرحبا بالعالم\n```",
      }),
    );

    expect(markup).toContain('class="markdown-code-shell" dir="ltr"');
  });
});

describe("AgentMarkdown inline code", () => {
  it("lets a long inline code span grow instead of clipping to a fixed height", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "1. `Before I refactor the transcript rendering, summarize how turns are grouped, in five bullets.`",
      }),
    );

    const match = markup.match(/<code dir="ltr" class="([^"]*)"/);
    expect(match).not.toBeNull();
    const classes = match![1].split(/\s+/);
    expect(classes).toContain("inline-flex");
    expect(classes).toContain("max-w-full");
    expect(classes).toContain("[overflow-wrap:anywhere]");
    expect(classes).not.toContain("h-6");
  });
});

describe("AgentMarkdown code fence highlighting", () => {
  it("falls back to JS highlighting for a fence tagged text", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```text\nconst x = 1;\n```",
      }),
    );

    expect(markup).toContain('data-language="js"');
    expect(markup).not.toContain('data-language="text"');
  });

  it("falls back to JS highlighting for an untagged fence", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```\nconst x = 1;\n```",
      }),
    );

    expect(markup).toContain('data-language="js"');
  });

  it("leaves an explicit real language alone", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```python\nx = 1\n```",
      }),
    );

    expect(markup).toContain('data-language="python"');
  });

  it("keeps a text fence labeled text despite the JS highlighting fallback", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```text\nconst x = 1;\n```",
      }),
    );

    expect(markup).toContain('data-language="js"');
    expect(markup).toMatch(/class="markdown-code-label"[^>]*>text<\/span>/);
  });

  it("leaves an untagged fence without a visible language label", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```\nconst x = 1;\n```",
      }),
    );

    expect(markup).toMatch(/class="markdown-code-label"[^>]*><\/span>/);
  });

  it("keeps the plaintext and txt fallbacks labeled with their own fence language", () => {
    const plaintextMarkup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```plaintext\nconst x = 1;\n```",
      }),
    );
    expect(plaintextMarkup).toContain('data-language="js"');
    expect(plaintextMarkup).toMatch(
      /class="markdown-code-label"[^>]*>plaintext<\/span>/,
    );

    const txtMarkup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```txt\nconst x = 1;\n```",
      }),
    );
    expect(txtMarkup).toContain('data-language="js"');
    expect(txtMarkup).toMatch(/class="markdown-code-label"[^>]*>txt<\/span>/);
  });

  it("labels known languages with their display name and keeps unknown tags", () => {
    const typescript = renderToStaticMarkup(
      createElement(AgentMarkdown, { text: "```ts\nconst x = 1;\n```" }),
    );
    expect(typescript).toMatch(
      /class="markdown-code-label"[^>]*>TypeScript<\/span>/,
    );

    const unknown = renderToStaticMarkup(
      createElement(AgentMarkdown, { text: "```nim\necho 1\n```" }),
    );
    expect(unknown).toMatch(/class="markdown-code-label"[^>]*>nim<\/span>/);
  });

  it("offers an unpressed wrap toggle beside the copy button", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, { text: "```ts\nconst x = 1;\n```" }),
    );
    expect(markup).toMatch(
      /<button(?=[^>]*aria-pressed="false")(?=[^>]*class="[^"]*markdown-code-wrap)[^>]*>/,
    );
    expect(markup).not.toContain("data-wrap");
  });

  it("numbers lines only for citations or fences that ask for it", () => {
    const snippet = renderToStaticMarkup(
      createElement(AgentMarkdown, { text: "```ts\nconst x = 1;\n```" }),
    );
    expect(snippet).not.toContain("markdown-code-numbered-line");

    const requested = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```ts lineNumbers\nconst x = 1;\n```",
      }),
    );
    expect(requested).toContain("markdown-code-numbered-line");

    const citation = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "```12:14:src/app.ts\nconst x = 1;\n```",
      }),
    );
    expect(citation).toContain("markdown-code-numbered-line");
  });
});

describe("AgentMarkdown note images", () => {
  it("keeps app-owned note image references for the async image resolver", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: "![Diagram](/note-assets/note-1/123-diagram.png)",
      }),
    );

    expect(markup).toContain(
      'data-note-image="/note-assets/note-1/123-diagram.png"',
    );
    expect(markup).toContain('alt="Diagram"');
  });
});
