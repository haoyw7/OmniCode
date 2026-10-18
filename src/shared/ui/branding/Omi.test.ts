// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { Omi } from "./Omi";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps its artwork nodes across parent renders so animations do not restart", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(Omi, { compact: true, animated: true, className: "a" })));
  const artwork = container.querySelector("svg")!.firstElementChild;
  expect(artwork).not.toBeNull();
  act(() => root.render(createElement(Omi, { compact: true, animated: true, className: "b" })));
  expect(container.querySelector("svg")!.firstElementChild).toBe(artwork);
  act(() => root.unmount());
});
