import { createElement } from "react";
import { createRoot as createReactRoot, type Root } from "react-dom/client";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";

/** Isolate nuqs' global URL queue between component tests, including fake clocks. */
export function createRoot(container: Element): Root {
  const root = createReactRoot(container);
  const render = root.render.bind(root);
  root.render = children => render(createElement(NuqsTestingAdapter, { hasMemory: true, children }));
  return root;
}
