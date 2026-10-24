import { createElement, type ReactNode } from "react";
import { createRoot as createReactRoot, type Root, type RootOptions } from "react-dom/client";
import { renderToStaticMarkup as renderReactMarkup } from "react-dom/server";
import { SessionPresentationProvider } from "../../src/app/ui/SessionPresentationProvider";

/** Integration fixtures use the same cross-feature composition as AppView. */
export function createRoot(container: Element | DocumentFragment, options?: RootOptions): Root {
  const root = createReactRoot(container, options);
  return {
    render: children => root.render(createElement(SessionPresentationProvider, null, children)),
    unmount: () => root.unmount(),
  };
}

export function renderToStaticMarkup(children: ReactNode): string {
  return renderReactMarkup(createElement(SessionPresentationProvider, null, children));
}
