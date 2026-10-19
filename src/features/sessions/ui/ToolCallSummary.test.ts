// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewFromTool } from "../../../integrations/harness/providers/claude/claudeProtocol";
import { AgentTranscript } from "./AgentTranscript";
import type { Block } from "../model/session";
import { TranscriptPlatformContext } from "./TranscriptPlatform";
import { ToolCallSummary } from "./transcript/tools/ToolCallParts";
import { mobileTranscriptPlatform } from "../../../mobile/transcriptPlatform";

let container: HTMLDivElement;
let root: Root;
const path = "/Users/me/Documents/notes.md";
const preview = previewFromTool("Edit", {
  file_path: path,
  old_string: "  before\nkeep",
  new_string: "  after\nkeep",
})!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function focusAndHover(trigger: HTMLButtonElement) {
  act(() => {
    trigger.focus();
    trigger.dispatchEvent(new PointerEvent("pointerover", {
      bubbles: true,
      pointerType: "mouse",
    }));
    vi.advanceTimersByTime(1000);
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(trigger.hasAttribute("aria-haspopup")).toBe(false);
}

describe("tool file navigation", () => {
  it.each(["desktop", "mobile"])(
    "opens the diff without a hover or focus preview on %s",
    (platform) => {
      const onOpenDiff = vi.fn();
      const summary = createElement(ToolCallSummary, {
        label: `Edit ${path}`, preview, onOpenDiff,
      });
      act(() => root.render(platform === "mobile"
        ? createElement(TranscriptPlatformContext.Provider, {
            value: mobileTranscriptPlatform,
          }, summary)
        : summary));
      const trigger = container.querySelector<HTMLButtonElement>("button")!;
      expect(trigger).not.toBeNull();
      focusAndHover(trigger);
      act(() => trigger.click());
      expect(onOpenDiff).toHaveBeenCalledExactlyOnceWith(path);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    },
  );

  it.each([true, false])(
    "preserves expanded activity file navigation (diff handler: %s)",
    (hasDiffHandler) => {
      const onOpenFile = vi.fn();
      const onOpenDiff = hasDiffHandler ? vi.fn() : undefined;
      const blocks: Block[] = [
        { id: "user", role: "user", text: "Update my notes" },
        {
          id: "edit", role: "tool", text: `Edit ${path}`,
          tool: { kind: "edit", status: "completed", preview },
        },
        { id: "answer", role: "assistant", text: "Updated your notes." },
      ];
      act(() => root.render(
        createElement(AgentTranscript, { blocks, onOpenFile, onOpenDiff }),
      ));
      const expand = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Show the work"]',
      )!;
      act(() => expand.click());
      const trigger = container.querySelector<HTMLButtonElement>(
        `button[aria-label="Open ${path}"]`,
      )!;
      expect(trigger).not.toBeNull();
      focusAndHover(trigger);
      act(() => trigger.click());
      expect(onOpenDiff ?? onOpenFile).toHaveBeenCalledExactlyOnceWith(path);
      if (onOpenDiff) expect(onOpenFile).not.toHaveBeenCalled();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    },
  );
});
