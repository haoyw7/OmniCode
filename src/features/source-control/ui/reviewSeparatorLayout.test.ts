// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createReviewSeparatorLayout } from "./reviewSeparatorLayout";

let callback: ResizeObserverCallback;
const observe = vi.fn();
const unobserve = vi.fn();
const disconnect = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class {
    constructor(next: ResizeObserverCallback) { callback = next; }
    observe = observe;
    unobserve = unobserve;
    disconnect = disconnect;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture(overflow = "wrap") {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<pre data-overflow="${overflow}"><code data-unified data-container-size>
    <div data-separator="line-info"><div data-separator-wrapper></div></div>
  </code></pre>`;
  const code = root.querySelector("code")!;
  const heading = root.querySelector<HTMLElement>("[data-separator-wrapper]")!;
  return { host, root, code, heading };
}
function resize(code: HTMLElement, width: number) {
  callback([{ target: code, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
}

it("uses observed fractional widths without reading layout or rewriting unchanged styles", () => {
  const { host, code, heading } = fixture();
  const layout = createReviewSeparatorLayout();
  const read = vi.spyOn(code, "getBoundingClientRect").mockImplementation(() => { throw Error("layout read"); });
  layout.update(host);
  resize(code, 512.25);
  expect(heading.style.width).toBe("512.25px");
  const mutations = new MutationObserver(() => {});
  mutations.observe(heading, { attributes: true, attributeFilter: ["style"] });
  resize(code, 512.25);
  layout.update(host);
  expect(mutations.takeRecords()).toHaveLength(0);
  resize(code, 310.5);
  expect(heading.style.width).toBe("310.5px");
  resize(code, 0);
  expect(heading.style.width).toBe("310.5px");
  expect(read).not.toHaveBeenCalled();
  mutations.disconnect();
  layout.dispose();
});

it("sizes replaced hunk headings immediately even when the column width has not changed", () => {
  const { host, code, heading } = fixture();
  const layout = createReviewSeparatorLayout();
  layout.update(host);
  resize(code, 600);
  const next = document.createElement("div");
  next.setAttribute("data-separator-wrapper", "");
  heading.replaceWith(next);
  layout.update(host);
  expect(next.style.width).toBe("600px");
  expect(observe).toHaveBeenCalledTimes(1);
  layout.dispose();
});

it("releases replaced columns and restores owned styles on disposal", () => {
  const first = fixture();
  first.heading.style.setProperty("width", "42px", "important");
  const next = fixture();
  const layout = createReviewSeparatorLayout();
  layout.update(first.host);
  resize(first.code, 500);
  layout.update(next.host);
  expect(unobserve).toHaveBeenCalledWith(first.code);
  expect(first.heading.style.getPropertyValue("width")).toBe("42px");
  expect(first.heading.style.getPropertyPriority("width")).toBe("important");
  resize(next.code, 400);
  layout.dispose();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(next.heading.style.width).toBe("");
  resize(next.code, 700);
  expect(next.heading.style.width).toBe("");
});

it("leaves scrolling and partial diff layouts unobserved", () => {
  const scrolling = fixture("scroll");
  const partial = fixture();
  partial.code.removeAttribute("data-container-size");
  const layout = createReviewSeparatorLayout();
  layout.update(scrolling.host);
  layout.update(partial.host);
  expect(observe).not.toHaveBeenCalled();
  layout.dispose();
});
