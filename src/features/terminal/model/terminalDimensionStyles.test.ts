// @vitest-environment happy-dom
import type { Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import { deduplicateTerminalDimensionStyles } from "./terminalLayout";

function fixture() {
  const style = document.createElement("style");
  style.textContent = ".xterm-rows span { display: inline-block; }";
  const renderer = { _dimensionsStyleElement: style };
  const term = { _core: { _renderService: { _renderer: { value: renderer } } } } as unknown as Terminal;
  return { term, style, renderer };
}

function observe(style: HTMLStyleElement) {
  const observer = new MutationObserver(() => {});
  observer.observe(style, { childList: true, characterData: true, subtree: true });
  return observer;
}

describe("terminal dimension stylesheet", () => {
  it("preserves the stylesheet text node through repeated identical resize writes", () => {
    const { term, style } = fixture();
    const text = style.firstChild;
    deduplicateTerminalDimensionStyles(term);
    const observer = observe(style);
    try {
      for (let i = 0; i < 20; i++) style.textContent = style.textContent;
      expect(style.firstChild).toBe(text);
      expect(observer.takeRecords()).toHaveLength(0);
    } finally { observer.disconnect(); }
  });

  it("allows changed CSS and checks actual contents after other DOM edits", () => {
    const { term, style } = fixture();
    deduplicateTerminalDimensionStyles(term);
    const original = style.textContent;
    const text = style.firstChild;
    style.textContent = ".xterm-rows span { height: 100%; }";
    expect(style.firstChild).not.toBe(text);
    expect(style.textContent).toContain("height: 100%");
    style.replaceChildren(document.createTextNode("external change"));
    style.textContent = original;
    expect(style.textContent).toBe(original);
    style.textContent = null;
    expect(style.textContent).toBe("");
  });

  it("leaves the global DOM prototype and other stylesheets untouched", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, "textContent");
    const { term } = fixture();
    const other = fixture().style;
    const text = other.firstChild;
    deduplicateTerminalDimensionStyles(term);
    expect(Object.getOwnPropertyDescriptor(Node.prototype, "textContent")).toEqual(descriptor);
    other.textContent = other.textContent;
    expect(other.firstChild).not.toBe(text);
  });

  it("is idempotent and covers a replacement renderer stylesheet", () => {
    const { term, style, renderer } = fixture();
    deduplicateTerminalDimensionStyles(term);
    const setter = Object.getOwnPropertyDescriptor(style, "textContent")!.set;
    deduplicateTerminalDimensionStyles(term);
    expect(Object.getOwnPropertyDescriptor(style, "textContent")!.set).toBe(setter);
    const replacement = fixture().style;
    renderer._dimensionsStyleElement = replacement;
    deduplicateTerminalDimensionStyles(term);
    const text = replacement.firstChild;
    replacement.textContent = replacement.textContent;
    expect(replacement.firstChild).toBe(text);
  });

  it("safely skips terminals without this DOM renderer", () => {
    expect(() => deduplicateTerminalDimensionStyles({} as Terminal)).not.toThrow();
    expect(() => deduplicateTerminalDimensionStyles({ _core: { _renderService: {} } } as unknown as Terminal)).not.toThrow();
  });
});
