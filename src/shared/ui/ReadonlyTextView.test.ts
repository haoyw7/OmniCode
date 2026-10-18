// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReadonlyTextEditor from "./ReadonlyTextEditor";
import {
  isLongText,
  ReadonlyTextStateContext,
  type ReadonlyTextProps,
} from "./ReadonlyTextView";
import { SurfaceVisibilityContext } from "./SurfaceVisibility";

describe("long read-only text", () => {
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("IntersectionObserver", undefined);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const editor = () =>
    EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-editor")!)!;
  async function render(
    props: ReadonlyTextProps,
    visible = true,
    saved?: Map<string, unknown>,
  ) {
    await act(async () =>
      root.render(
        createElement(
          ReadonlyTextStateContext.Provider,
          { value: saved },
          createElement(
            SurfaceVisibilityContext.Provider,
            { value: visible },
            createElement(ReadonlyTextEditor, props),
          ),
        ),
      ),
    );
  }

  it("bounds rendered DOM for 50,000 lines while retaining the full document and cited line", async () => {
    const text = Array.from({ length: 50_000 }, (_, i) => `log ${i}`).join(
      "\n",
    );
    await render({ text, line: 40_000 });
    expect(editor().state.doc.toString()).toBe(text);
    expect(
      editor().state.doc.lineAt(editor().state.selection.main.head).number,
    ).toBe(40_000);
    expect(editor().state.readOnly).toBe(true);
    expect(editor().contentDOM.contentEditable).toBe("false");
    expect(host.querySelectorAll(".cm-line").length).toBeLessThan(100);
  });

  it("appends without recreating the editor, losing selection or pulling a reader to the end", async () => {
    const text = "line\n".repeat(1000);
    await render({ text });
    const view = editor();
    Object.defineProperty(view.scrollDOM, "clientHeight", {
      configurable: true,
      value: 300,
    });
    Object.defineProperty(view.scrollDOM, "scrollHeight", {
      configurable: true,
      value: 22000,
    });
    view.scrollDOM.scrollTop = 600;
    view.dispatch({ selection: { anchor: 10, head: 20 } });
    await render({ text: text + "last line" });
    expect(editor()).toBe(view);
    expect(view.state.doc.toString()).toBe(text + "last line");
    expect(view.state.selection.main).toMatchObject({ anchor: 10, head: 20 });
    expect(view.scrollDOM.scrollTop).toBe(600);
  });

  it("copies every character of a huge single line and changes wrapping without rebuilding", async () => {
    const text = "x".repeat(500_000);
    const onCopy = vi.fn(async () => {});
    await render({ text, onCopy });
    const view = editor();
    const buttons = [...host.querySelectorAll("button")];
    await act(async () =>
      buttons.find((button) => button.textContent === "Copy all")!.click(),
    );
    expect(onCopy).toHaveBeenCalledWith(text);
    await act(async () =>
      buttons.find((button) => button.textContent === "Wrap lines")!.click(),
    );
    expect(editor()).toBe(view);
    expect(host.querySelector('[aria-pressed="true"]')).not.toBeNull();
    expect(view.state.doc.length).toBe(text.length);
  });

  it("defers a hidden editor and retains only reading position during navigation", async () => {
    const saved = new Map<string, unknown>();
    await render({ text: "old", stateKey: "output" }, false, saved);
    expect(host.querySelector(".cm-editor")).toBeNull();
    await render(
      { text: "latest\n".repeat(1000), stateKey: "output" },
      true,
      saved,
    );
    expect(editor().state.doc.lines).toBe(1001);
    editor().scrollDOM.scrollTop = 450;
    editor().scrollDOM.scrollLeft = 30;
    editor().scrollDOM.dispatchEvent(new Event("scroll"));
    expect(saved.get("readonly:output")).toEqual({
      top: 450,
      left: 30,
      wrap: false,
    });
  });

  it("routes both excessive line counts and oversized single lines to the bounded view", () => {
    expect(isLongText("a\n".repeat(301))).toBe(true);
    expect(isLongText("x".repeat(25_000))).toBe(true);
    expect(isLongText("const answer = 42;\n")).toBe(false);
  });

  it("retains diff markers and source line numbers while decorating only visible lines", async () => {
    const text = Array.from(
      { length: 5000 },
      (_, i) => `${i % 2 ? "+" : "-"}${i + 1}\tvalue`,
    ).join("\n");
    await render({ text, diff: true });
    expect(editor().state.doc.toString()).toBe(text);
    expect(host.querySelectorAll(".readonly-diff-add").length).toBeGreaterThan(
      0,
    );
    expect(host.querySelectorAll(".readonly-diff-del").length).toBeGreaterThan(
      0,
    );
    expect(host.querySelectorAll(".cm-line").length).toBeLessThan(100);
  });
});
