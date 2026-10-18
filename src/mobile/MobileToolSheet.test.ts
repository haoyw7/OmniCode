import { startMotionClock, stopMotionClock, advanceMotionTimers } from "./motionTestClock";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../features/sessions/model/session";
import { setUiLanguage } from "../shared/i18n/language";
import { AgentTranscript } from "../features/sessions/ui/AgentTranscript";
import { TranscriptPlatformContext } from "../features/sessions/ui/TranscriptPlatform";
import { MobileToolSheet, toolDetails } from "./MobileToolSheet";
import {
  decodePreview,
  fencedSource,
  MAX_PREVIEW_BYTES,
} from "./MobileFileSheet";

const shell: Block = {
  id: "shell",
  role: "tool",
  text: "npm test",
  tool: {
    kind: "shell",
    status: "completed",
    detail: "npm test -- --run src/app.test.ts",
    preview: { kind: "shell", output: "1 passed\n" },
  },
};

const edit: Block = {
  id: "edit",
  role: "tool",
  text: "Edit src/app.ts",
  tool: {
    kind: "edit",
    status: "completed",
    preview: {
      kind: "write",
      path: "src/app.ts",
      additions: 1,
      deletions: 1,
      lines: [
        { number: 1, kind: "del", text: "before" },
        { number: 1, kind: "add", text: "after" },
      ],
    },
  },
};

function transcript(openTool?: (block: Block) => void) {
  const platform = {
    copyText: async () => {},
    copyMessage: async () => {},
    openExternal: async () => {},
    readBinaryFile: async () => new Uint8Array(),
    localFiles: false,
    openTool,
  };
  return renderToStaticMarkup(
    createElement(
      TranscriptPlatformContext.Provider,
      { value: platform },
      createElement(AgentTranscript, {
        blocks: [{ id: "user", role: "user", text: "Run tests" }, shell],
        busy: true,
      }),
    ),
  );
}

describe("mobile tool details", () => {
  it("makes tool rows tappable only when the platform can show details", () => {
    expect(transcript(() => {})).toContain("data-tool-open-row");
    expect(transcript()).not.toContain("data-tool-open-row");
  });

  it.each(["read", "execute", "search"])(
    "shows a completed %s result stored in detail as output, not input",
    (kind) => {
      const block: Block = {
        id: kind,
        role: "tool",
        text: kind === "read" ? "Read package.json" : "Run a tool",
        tool: {
          kind,
          status: "completed",
          detail: "Full tool result\nlast line",
        },
      };
      expect(toolDetails(block)).toMatchObject({
        input: undefined,
        output: "Full tool result\nlast line",
      });
    },
  );

  it("shows errors as output and avoids duplicating a preview result as input", () => {
    expect(
      toolDetails({
        id: "failed",
        role: "tool",
        text: "Read missing.txt",
        tool: { kind: "read", status: "failed", detail: "File not found" },
      }),
    ).toMatchObject({
      state: "rejected",
      input: undefined,
      output: "File not found",
    });
    expect(
      toolDetails({
        ...shell,
        tool: { ...shell.tool, detail: "1 passed\n" },
      }),
    ).toMatchObject({ input: undefined, output: "1 passed" });
  });

  it("does not label an ambiguous running detail as input or output", () => {
    expect(
      toolDetails({
        ...shell,
        tool: { kind: "execute", status: "running", detail: "Partial result" },
      }),
    ).toMatchObject({
      input: undefined,
      output: undefined,
      details: "Partial result",
    });
  });

  it("identifies the returned file range without assuming the whole file was read", () => {
    const read: Block = {
      id: "read",
      role: "tool",
      text: "Read package.json",
      tool: {
        kind: "read",
        status: "completed",
        detail: "1\t{\n2\tname\n3\tprivate\n4\tversion\n5\ttype",
        preview: { kind: "read", path: "/repo/package.json" },
      },
    };
    expect(toolDetails(read).readOutput).toEqual({
      count: 5,
      start: 1,
      end: 5,
    });
    expect(
      toolDetails({ ...read, tool: { ...read.tool, detail: "20→a\n21→b" } })
        .readOutput,
    ).toEqual({ count: 2, start: 20, end: 21 });
    expect(
      toolDetails({ ...read, tool: { ...read.tool, detail: "plain\ntext\n" } })
        .readOutput,
    ).toEqual({ count: 2 });
    expect(
      toolDetails({ ...read, tool: { ...read.tool, detail: "1\ta\n3\tb" } })
        .readOutput,
    ).toEqual({ count: 2 });
    expect(
      toolDetails({ ...read, tool: { ...read.tool, status: "failed" } })
        .readOutput,
    ).toBeUndefined();
    expect(toolDetails(shell).readOutput).toBeUndefined();
  });

  it("separates a tool call's input, output and diff", () => {
    expect(toolDetails(shell, "/repo")).toMatchObject({
      state: "accepted",
      input: "npm test -- --run src/app.test.ts",
      output: "1 passed",
      preview: undefined,
    });
    const details = toolDetails(edit, "/repo");
    expect(details.path).toBe("/repo/src/app.ts");
    expect(details.preview?.lines).toHaveLength(2);
  });
});

describe("MobileToolSheet", () => {
  let root: Root;
  let node: HTMLDivElement;
  beforeEach(() => {
  startMotionClock();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setUiLanguage("en");
    node = document.createElement("div");
    document.body.append(node);
    root = createRoot(node);
  });
  afterEach(() => {
  stopMotionClock();
    act(() => root.unmount());
    node.remove();
    setUiLanguage("en");
    vi.unstubAllGlobals();
  });

  it("renders every returned line of a read under Output", () => {
    const output = Array.from(
      { length: 40 },
      (_, index) => `line ${index + 1}`,
    ).join("\n");
    act(() =>
      root.render(
        createElement(MobileToolSheet, {
          block: {
            id: "read",
            role: "tool",
            text: "Read package.json",
            tool: { kind: "read", status: "completed", detail: output },
          },
          onClose: () => {},
        }),
      ),
    );
    expect(node.querySelector("h3")?.textContent).toBe("Output");
    expect(node.querySelector("pre")?.textContent).toBe(output);
    expect(node.querySelector('[role="note"]')?.textContent).toBe(
      "Tool returned 40 lines; this may not be the complete file.",
    );
  });

  it("explains the first five returned lines in Chinese and keeps the notice out of copied output", async () => {
    setUiLanguage("zh-CN");
    const copyText = vi.fn(async () => {});
    const output = "1\t{\n2\tname\n3\tprivate\n4\tversion\n5\ttype";
    act(() =>
      root.render(
        createElement(
          TranscriptPlatformContext.Provider,
          {
            value: {
              copyText,
              copyMessage: async () => {},
              openExternal: async () => {},
              readBinaryFile: async () => new Uint8Array(),
              localFiles: false,
            },
          },
          createElement(MobileToolSheet, {
            block: {
              id: "read",
              role: "tool",
              text: "Read package.json",
              tool: {
                kind: "read",
                status: "completed",
                detail: output,
                preview: { kind: "read", path: "/repo/package.json" },
              },
            },
            onOpenFile: () => {},
            onClose: () => {},
          }),
        ),
      ),
    );
    const notice = node.querySelector('[role="note"]');
    expect(notice?.textContent).toContain(
      "本次工具返回前 5 行，未必是完整文件。",
    );
    expect(notice?.textContent).toContain("点击“查看文件”查看完整内容。");
    expect(
      notice?.compareDocumentPosition(node.querySelector("pre")!)! &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await act(async () =>
      node
        .querySelector<HTMLButtonElement>('button[aria-label="复制"]')!
        .click(),
    );
    expect(copyText).toHaveBeenCalledWith(output);
  });

  it("shows a noninitial range and omits unavailable file navigation instructions", () => {
    act(() =>
      root.render(
        createElement(MobileToolSheet, {
          block: {
            id: "read",
            role: "tool",
            text: "Read app.ts",
            tool: { kind: "read", status: "completed", detail: "20\ta\n21\tb" },
          },
          onClose: () => {},
        }),
      ),
    );
    expect(node.querySelector('[role="note"]')?.textContent).toBe(
      "Tool returned lines 20–21; this may not be the complete file.",
    );
  });

  it("does not show file excerpt notices on commands or edits", () => {
    for (const block of [shell, edit]) {
      act(() =>
        root.render(
          createElement(MobileToolSheet, { block, onClose: () => {} }),
        ),
      );
      expect(node.querySelector('[role="note"]')).toBeNull();
    }
  });

  it("shows output and opens the edited file", () => {
    const onOpenFile = vi.fn();
    act(() =>
      root.render(
        createElement(MobileToolSheet, {
          block: edit,
          cwd: "/repo",
          onOpenFile,
          onClose: () => {},
        }),
      ),
    );
    const row = node.querySelector(".mobile-tool-diff .mobile-git-file-row")!;
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(row.textContent).toContain("src/app.ts");
    expect(node.querySelector(".mobile-tool-diff .mobile-git-diff")).not.toBeNull();
    const view = [...node.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("View file"),
    );
    act(() => view?.click());
    expect(onOpenFile).toHaveBeenCalledWith("/repo/src/app.ts");

    act(() =>
      root.render(
        createElement(MobileToolSheet, {
          block: shell,
          onClose: () => {},
        }),
      ),
    );
    expect(node.querySelector(".mobile-detail-pre")?.textContent).toContain(
      "npm test -- --run",
    );
    expect(node.textContent).toContain("1 passed");
  });

  it("keeps diff content mounted and inert while closing, including rapid reversal", async () => {
    vi.useFakeTimers();
    try {
      act(() =>
        root.render(
          createElement(MobileToolSheet, {
            block: edit,
            onClose: () => {},
          }),
        ),
      );
      const toggle = node.querySelector<HTMLButtonElement>(
        ".mobile-tool-diff .mobile-git-file-row",
      )!;
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      act(() => toggle.click());
      const closing = node.querySelector(
        '.mobile-tool-diff [data-fold-state="closing"]',
      )!;
      expect(closing.hasAttribute("inert")).toBe(true);
      expect(closing.querySelector(".mobile-git-diff")).not.toBeNull();
      act(() => toggle.click());
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(closing.hasAttribute("inert")).toBe(false);
      await advanceMotionTimers(400);
      expect(
        node.querySelector('.mobile-tool-diff [data-fold-state="open"]'),
      ).not.toBeNull();
      act(() => toggle.click());
      await advanceMotionTimers(400);
      expect(node.querySelector(".mobile-tool-diff .mobile-git-diff")).toBeNull();
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      act(() => toggle.click());
      expect(node.querySelector(".mobile-tool-diff .mobile-git-diff")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("mobile file preview helpers", () => {
  it("decodes text and refuses binaries or oversized files", () => {
    expect(decodePreview(new TextEncoder().encode("hi\n"))).toMatchObject({
      kind: "text",
      text: "hi\n",
    });
    expect(decodePreview(new Uint8Array([0xff, 0xfe, 0x00]))).toMatchObject({
      kind: "binary",
    });
    expect(decodePreview(new Uint8Array(MAX_PREVIEW_BYTES + 1))).toMatchObject({
      kind: "large",
    });
  });

  it("fences source longer than any backtick run inside it", () => {
    expect(fencedSource("a ``` b", "md")).toBe("````md\na ``` b\n````");
  });
});
