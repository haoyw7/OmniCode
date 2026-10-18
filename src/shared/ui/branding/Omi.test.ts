// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { Omi } from "./Omi";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it.each(["original", "circle", "triangle", "square"] as const)("keeps %s artwork nodes across parent renders so animations do not restart", (shape) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(Omi, { shape, compact: true, animated: true, className: "a" })));
  const artwork = container.querySelector("svg")!.firstElementChild;
  expect(artwork).not.toBeNull();
  act(() => root.render(createElement(Omi, { shape, compact: true, animated: true, className: "b" })));
  expect(container.querySelector("svg")!.firstElementChild).toBe(artwork);
  act(() => root.unmount());
});

it("changes the contour while retaining the expression and separate eye animations", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const contours = new Set<string>();
  for (const shape of ["original", "circle", "triangle", "square"] as const) {
    act(() => root.render(createElement(Omi, { shape, expression: "joyful", compact: true, animated: true })));
    const svg = container.querySelector("svg")!;
    contours.add(svg.querySelector("path")!.getAttribute("d")!);
    expect(svg.getAttribute("data-expression")).toBe("joyful");
    expect(svg.querySelector(".omx-gaze .omx-blink")).not.toBeNull();
    expect(svg.querySelector(".omx-face > path")).not.toBeNull();
    if (shape === "triangle") expect(svg.querySelector(".omx-face")!.parentElement!.getAttribute("transform")).toBe("translate(23 37) scale(0.82)");
  }
  expect(contours.size).toBe(4);
  act(() => root.unmount());
});

it.each(["original", "circle", "triangle", "square"] as const)("fills %s without closing its outline and gives the face a separate color", (shape) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(Omi, { shape, variant: "filled", expression: "joyful", animated: true })));
  const contour = container.querySelector("path")!;
  expect(contour.getAttribute("fill")).toBe("currentColor");
  expect(contour.getAttribute("d")).not.toMatch(/[zZ]/);
  const face = container.querySelector(".omx-face")!;
  expect(face.getAttribute("fill")).toContain("--omi-face-color");
  expect(face.getAttribute("stroke")).toBe(face.getAttribute("fill"));
  expect(face.querySelector(".omx-gaze .omx-blink")).not.toBeNull();
  act(() => root.render(createElement(Omi, { shape, variant: "filled", expression: "joyful", animated: true, className: "changed" })));
  expect(container.querySelector(".omx-face")).toBe(face);
  act(() => root.unmount());
});
