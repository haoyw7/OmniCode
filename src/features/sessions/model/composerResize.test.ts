import { describe, expect, it } from "vitest";
import {
  COMPOSER_MAX_HEIGHT,
  growComposer,
  isInsertion,
  resizeComposer,
} from "./composerResize";

function field(scrollHeight: number, height = "") {
  return { style: { height }, scrollHeight };
}

describe("resizeComposer", () => {
  it("grows the field to fit the draft", () => {
    const el = field(88);
    resizeComposer(el);
    expect(el.style.height).toBe("88px");
  });

  it("stops growing at the max height", () => {
    const el = field(400);
    resizeComposer(el);
    expect(el.style.height).toBe(`${COMPOSER_MAX_HEIGHT}px`);
  });

  it("supports a taller field without changing the composer default", () => {
    const el = field(400);
    resizeComposer(el, Number.POSITIVE_INFINITY);
    expect(el.style.height).toBe("400px");
  });

  it.each([
    [88, 140],
    [140, 88],
    [160, 400],
  ])(
    "keeps the composer space while measuring from %i to %i",
    (height, nextHeight) => {
      const wrapper = { style: { minHeight: "20px" }, offsetHeight: height };
      const style = { height: `${height}px` };
      let measured = false;
      const el = {
        style,
        parentElement: wrapper,
        get scrollHeight() {
          if (style.height === "auto") {
            // Reading layout here must not briefly expand the transcript's
            // viewport and clamp its scroll position before the final resize.
            expect(wrapper.style.minHeight).toBe(`${height}px`);
            measured = true;
          }
          return nextHeight;
        },
      };
      resizeComposer(el);
      expect(measured).toBe(true);
      expect(style.height).toBe(
        `${Math.min(nextHeight, COMPOSER_MAX_HEIGHT)}px`,
      );
      expect(wrapper.style.minHeight).toBe("20px");
    },
  );

  it("leaves the height alone when the field has no layout box", () => {
    const wrapper = { style: { minHeight: "20px" }, offsetHeight: 0 };
    const el = { ...field(0, "88px"), parentElement: wrapper };
    resizeComposer(el);
    expect(el.style.height).toBe("88px");
    expect(wrapper.style.minHeight).toBe("20px");
  });
});

describe("growComposer", () => {
  it("leaves a field whose draft still fits untouched", () => {
    const el = { style: { height: "40px" }, scrollHeight: 40, clientHeight: 40 };
    growComposer(el);
    expect(el.style.height).toBe("40px");
  });

  it("grows to the new content up to the max height", () => {
    const el = { style: { height: "40px" }, scrollHeight: 62, clientHeight: 40 };
    growComposer(el);
    expect(el.style.height).toBe("62px");
    el.scrollHeight = 400;
    el.clientHeight = 62;
    growComposer(el);
    expect(el.style.height).toBe(`${COMPOSER_MAX_HEIGHT}px`);
  });
});

describe("isInsertion", () => {
  it.each([
    ["", "a"],
    ["abc", "abcd"],
    ["abc", "aXbc"],
    ["abc", "abc\n"],
    ["aa", "aaa"],
  ])("treats %j -> %j as an insertion", (previous, next) => {
    expect(isInsertion(previous, next)).toBe(true);
  });

  it.each([
    ["abc", "ab"],
    ["abc", "abd"],
    ["a\n\n\nb", "aXYZb"],
    ["abc", "xyzw"],
  ])("treats %j -> %j as an edit that may shrink", (previous, next) => {
    expect(isInsertion(previous, next)).toBe(false);
  });
});
