import { describe, expect, it } from "vitest";
import {
  parseStreamingMarkdown,
  StreamingMarkdownParser,
} from "./streamingMarkdown";

describe("streaming Markdown blocks", () => {
  it("closes incomplete emphasis within its paragraph", () => {
    const blocks = parseStreamingMarkdown(
      "First **unfinished\n\nSecond paragraph.",
    );
    expect(blocks[0]).toBe("First **unfinished**");
    expect(blocks.at(-1)).toBe("Second paragraph.");
  });

  it.each([
    "> ```markdown\n> **literal** and [link](url)\n> ```",
    "- Example:\n\n  ```markdown\n  **literal** and [link](url)\n  ```",
  ])("preserves complete code inside a list or blockquote", (source) => {
    // These container blocks still use prose repair. The performance shortcut
    // is deliberately limited to top-level fences, rather than rewriting lists
    // and quotes or treating their surrounding prose as literal code.
    expect(parseStreamingMarkdown(source).join("")).toBe(source);
  });

  it.each(["```", "````", "~~~"])(
    "preserves literal markers in an open or closed %s fence",
    (fence) => {
      const source = `${fence}markdown\n# Prompt\n\n**unfinished emphasis\n[unfinished link](https://example.com\n\`inline code`;
      expect(parseStreamingMarkdown(source)).toEqual([source]);
      const closed = `${source}\n${fence}`;
      expect(parseStreamingMarkdown(closed)).toEqual([closed]);
    },
  );

  it("repairs unfinished prose after a Markdown fence without changing the fence", () => {
    const fence =
      "````markdown\n**literal** and [link](url)\n```ts\nconst x = 1;\n```\n````\n";
    const blocks = parseStreamingMarkdown(
      `Introduction.\n\n${fence}\nThis is **unfinished`,
    );
    expect(blocks.find((block) => block.startsWith("````"))?.trimEnd()).toBe(
      fence.trimEnd(),
    );
    expect(blocks.at(-1)).toBe("This is **unfinished**");
  });

  it("keeps incomplete links and inline code readable while prose streams", () => {
    expect(
      parseStreamingMarkdown("Read [the docs](https://example.com").join(""),
    ).toContain("streamdown:incomplete-link");
    expect(parseStreamingMarkdown("Run `npm test").join("")).toBe(
      "Run `npm test`",
    );
  });

  it("preserves indented fences and content with a shorter nested fence", () => {
    const source =
      "  ````markdown\n# Instructions\n```typescript\nconst x = 1;\n```\n  ````";
    expect(parseStreamingMarkdown(source)).toEqual([source]);
  });
});

describe("incremental Markdown parser", () => {
  const examples = [
    "# Heading\n\nFirst **bold** paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n\nTail",
    "intro\n\n- first\n\n- second\n\n  continuation\n\nAfter\n\nTail",
    "intro\n\nHeading\n-------\n\n| one | two |\n| --- | --- |\n| a | b |\n\nTail",
    "intro\n\n> quote\n>\n> continued\n\nAfter\n\nTail",
    "intro\n\n````markdown\n```js\n**literal\n```\n````\n\nAfter\n\nTail",
    "intro\n\n    indented\n\n    continued\n\nAfter\n\nTail",
    "[forward][ref]\n\nSecond\n\nThird\n\n[ref]: https://example.com\n\nTail",
    "A[^note]\n\nSecond\n\nThird\n\n[^note]: a note\n\nTail",
    "intro\n\n<div>\n\ninside\n\n</div>\n\nAfter\n\nTail",
    "intro\n\n$$\nx + y\n\n= z\n$$\n\nTail",
    "intro\r\n\r\nNext\r\n\r\nTail",
  ];
  it.each(examples)(
    "matches full parsing across every append boundary: %s",
    (text) => {
      const parser = new StreamingMarkdownParser();
      for (let end = 1; end <= text.length; end++) {
        expect(parser.parse(text.slice(0, end))).toEqual(
          parseStreamingMarkdown(text.slice(0, end)),
        );
      }
    },
  );
  it("reuses committed blocks, retains only the tail, and resets on replacement", () => {
    const parser = new StreamingMarkdownParser();
    const text = "First\n\nSecond\n\nThird\n\nTail";
    parser.parse(text);
    expect(parser.committed.length).toBeGreaterThan(0);
    const committed = parser.committed;
    parser.advance(" continued");
    expect(parser.committed).toBe(committed);
    expect(parser.buffer.length).toBeLessThan(text.length);
    expect(parser.parse("replacement")).toEqual(["replacement"]);
    expect(parser.committed).toHaveLength(0);
    expect(parser.parse("")).toEqual([]);
  });
});
