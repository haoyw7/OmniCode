import { startMotionClock, stopMotionClock, finishMotion, motionFrame } from "../../../../tests/helpers/sharedMotionClock";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FileDiffProps } from "@pierre/diffs/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import {
  ADD_TO_CHAT_EVENT,
  type AddToChatRequest,
} from "../../sessions/model/quoteDraft";
import { prepareReviewDiff } from "../model/reviewDiff";
import { ReviewDiffViewer } from "./ReviewDiffViewer";

const hover = vi.hoisted(() => ({
  side: "deletions" as "additions" | "deletions",
  lineNumber: 2,
}));
const rendering = vi.hoisted(() => ({ postRender: undefined as undefined | ((container: HTMLElement) => void) }));
vi.mock("@pierre/diffs/react", () => ({
  useWorkerPool: () => undefined,
  Virtualizer: ({ children }: { children: React.ReactNode }) =>
    createElement("div", { "data-virtualizer": "" }, children),
  FileDiff: (props: FileDiffProps<number>) => {
    rendering.postRender = props.options?.onPostRender as typeof rendering.postRender;
    return createElement(
      "div",
      { "data-pierre": "" },
      props.renderGutterUtility?.(() => hover),
      ...(props.lineAnnotations?.map((annotation) =>
        createElement(
          "div",
          { key: annotation.metadata },
          props.renderAnnotation?.(annotation),
        ),
      ) ?? []),
    );
  },
}));
vi.mock("../../../shared/hooks/useColorScheme", () => ({
  useColorScheme: () => "dark",
}));

let root: Root;
let container: HTMLDivElement;
const diff = prepareReviewDiff({
  original: "one\nremoved\nthree\n",
  current: "one\nadded\nextra\nthree\n",
  binary: false,
  tooLarge: false,
});
const stage = vi.fn();
function render(expanded: boolean) {
  act(() =>
    root.render(
      createElement(AnimatedCollapse, {
        expanded,
        motion: "height",
        children: () =>
          createElement(ReviewDiffViewer, {
            path: "/repo/a.ts",
            relative: "a.ts",
            diff,
            busy: false,
            onStageHunk: stage,
          }),
      }),
    ),
  );
}
function openComment() {
  act(() =>
    container
      .querySelector<HTMLButtonElement>('button[title="Comment on line"]')!
      .click(),
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  startMotionClock();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  stage.mockClear();
  hover.side = "deletions";
  hover.lineNumber = 2;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  stopMotionClock();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([
  ["deletions", 2, "`/repo/a.ts:2` (deleted line)", "> -removed"],
  ["additions", 3, "`/repo/a.ts:3`", "> +extra"],
  ["additions", 4, "`/repo/a.ts:4`", ">  three"],
] as const)(
  "sends a %s line %s comment through the existing add-to-chat event",
  async (side, line, location, quote) => {
    hover.side = side;
    hover.lineNumber = line;
    render(true);
    openComment();
    const textarea = document.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Leave a comment…"]',
    )!;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(textarea, "Please check this");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const received: AddToChatRequest[] = [];
    const listener = (event: Event) =>
      received.push((event as CustomEvent<AddToChatRequest>).detail);
    window.addEventListener(ADD_TO_CHAT_EVENT, listener);
    try {
      act(() =>
        textarea
          .closest("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          ),
      );
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ mode: "plain" });
      expect(received[0].text).toContain(location);
      expect(received[0].text).toContain(quote);
      expect(received[0].text).toContain("Please check this");
      await act(async () => finishMotion());
      expect(
        document.querySelector('textarea[placeholder="Leave a comment…"]'),
      ).toBeNull();
    } finally {
      window.removeEventListener(ADD_TO_CHAT_EVENT, listener);
    }
  },
);

it("disables actions and removes the comment portal during closing, then supports rapid reversal", async () => {
  render(true);
  openComment();
  expect(
    document.querySelector('textarea[placeholder="Leave a comment…"]'),
  ).not.toBeNull();
  const viewer = container.querySelector("[data-pierre]");
  render(false);
  expect(container.querySelector("[data-pierre]")).toBe(viewer);
  expect(container.querySelector<HTMLElement>(".zen-fold-item")?.inert).toBe(
    true,
  );
  expect(
    document.querySelector('textarea[placeholder="Leave a comment…"]'),
  ).toBeNull();
  expect(
    [...container.querySelectorAll<HTMLButtonElement>("button")].every(
      (button) => button.disabled,
    ),
  ).toBe(true);
  await act(async () => { vi.advanceTimersByTime(100); motionFrame(100); });
  render(true);
  expect(container.querySelector("[data-pierre]")).toBe(viewer);
  expect(
    container.querySelector<HTMLButtonElement>(
      'button[title="Comment on line"]',
    )?.disabled,
  ).toBe(false);
  await act(async () => finishMotion());
  expect(container.querySelector("[data-pierre]")).toBe(viewer);
  render(false);
  await act(async () => finishMotion());
  expect(container.querySelector("[data-pierre]")).toBeNull();
});

it("waits for rendered code or an error before reporting readiness and resets on unmount", () => {
  const onReady = vi.fn();
  act(() => root.render(createElement(ReviewDiffViewer, {
    path: "/repo/test.ts", relative: "test.ts", diff, busy: false, onReady,
  })));
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  act(() => rendering.postRender?.(host));
  expect(onReady).not.toHaveBeenCalled();
  const line = document.createElement("span");
  line.setAttribute("data-line", "");
  shadow.append(line);
  act(() => rendering.postRender?.(host));
  expect(onReady).toHaveBeenLastCalledWith(true);
  line.remove();
  const error = document.createElement("div");
  error.setAttribute("data-error-wrapper", "");
  shadow.append(error);
  onReady.mockClear();
  act(() => rendering.postRender?.(host));
  expect(onReady).toHaveBeenCalledWith(true);
  act(() => root.render(null));
  expect(onReady).toHaveBeenLastCalledWith(false);
});

it("marks non-textual diff notices ready without waiting for the code renderer", () => {
  const onReady = vi.fn();
  act(() => root.render(createElement(ReviewDiffViewer, {
    path: "/repo/image.png", relative: "image.png", diff: { ...diff, binary: true }, busy: false, onReady,
  })));
  expect(onReady).toHaveBeenCalledWith(true);
  expect(container.textContent).toContain("Binary file changed");
});

it("passes Monocode chunk positions to the stage action", () => {
  render(true);
  const button = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((item) => item.textContent === "Stage hunk")!;
  act(() => button.click());
  expect(stage).toHaveBeenCalledWith(
    diff.unified!.lines.find((line) => line.kind === "add")!.pos,
  );
});

it("renders large patches instead of replacing them with a size notice", () => {
  const large = prepareReviewDiff({
    original: "", current: "new\n".repeat(2_000), binary: false, tooLarge: false,
  });
  act(() => root.render(createElement(ReviewDiffViewer, {
    path: "/repo/large.ts", relative: "large.ts", diff: large, busy: false, onStageHunk: stage,
  })));
  expect(container.querySelector("[data-virtualizer] [data-pierre]")).not.toBeNull();
  expect(container.textContent).not.toContain("too large");
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((item) => item.textContent === "Stage hunk")!;
  act(() => button.click());
  expect(stage).toHaveBeenCalledWith(0);
});
