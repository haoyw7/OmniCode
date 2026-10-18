// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Folder, IconArtworkContext, Plus } from "../shared/ui/icons";
import { mobileIconArtwork } from "./icons";
import { MobileSpinner } from "./MobileSpinner";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mobile = (children: React.ReactNode) =>
  createElement(
    IconArtworkContext.Provider,
    { value: mobileIconArtwork },
    children,
  );

describe("mobile icon artwork", () => {
  it("scopes the replacement to mobile and preserves glyphs absent from the sheet", () => {
    const desktop = renderToStaticMarkup(createElement(Plus));
    const replacement = renderToStaticMarkup(mobile(createElement(Plus)));
    expect(replacement).toContain('data-ui-icon-artwork=""');
    expect(replacement).toContain('fill="currentColor"');
    expect(desktop).not.toContain("data-ui-icon-artwork");
    expect(renderToStaticMarkup(createElement(Plus))).toBe(desktop);
    expect(renderToStaticMarkup(mobile(createElement(Folder)))).toBe(
      renderToStaticMarkup(createElement(Folder)),
    );
  });

  it("keeps SVG refs, accessible labels, styling and replacement artwork through portals", async () => {
    const container = document.createElement("div");
    const portal = document.createElement("div");
    document.body.append(container, portal);
    const root = createRoot(container);
    const ref = createRef<SVGSVGElement>();
    try {
      await act(async () =>
        root.render(
          mobile(
            createPortal(
              createElement(Plus, {
                ref,
                size: 18,
                color: "tomato",
                className: "size-4",
                role: "img",
                "aria-label": "Add",
              }),
              portal,
            ),
          ),
        ),
      );
      expect(ref.current).toBe(portal.querySelector("svg"));
      expect(ref.current?.getAttribute("data-ui-icon-artwork")).toBe("");
      expect(ref.current?.getAttribute("width")).toBe("18");
      expect(ref.current?.getAttribute("color")).toBe("tomato");
      expect(ref.current?.getAttribute("class")).toBe("size-4");
      expect(ref.current?.getAttribute("aria-label")).toBe("Add");
      expect(ref.current?.getAttribute("aria-hidden")).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      portal.remove();
    }
  });

  it("keeps the spinner SVG mounted for the offscreen animation controller", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          mobile(
            createElement(MobileSpinner, {
              size: 20,
              className: "animate-spin",
            }),
          ),
        ),
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("data-ui-icon-artwork")).toBe("");
      expect(svg?.getAttribute("class")).toBe("animate-spin");
      expect(svg?.getAttribute("width")).toBe("20");
    } finally {
      await act(async () => root.unmount());
    }
  });
});
