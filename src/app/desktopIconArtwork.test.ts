import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  configureDefaultIconArtwork,
  IconArtworkContext,
  LoaderCircle,
  Plus,
  Star,
} from "../shared/ui/icons";
import { desktopIconArtwork } from "./desktopIconArtwork";

afterEach(() => configureDefaultIconArtwork({}));

describe("desktop icon artwork", () => {
  it("applies to independent roots and keeps unmapped glyphs available", () => {
    configureDefaultIconArtwork(desktopIconArtwork);
    for (let root = 0; root < 2; root++) {
      expect(renderToStaticMarkup(createElement(Plus))).toContain(
        'data-ui-icon-artwork=""',
      );
    }
    const loader = renderToStaticMarkup(
      createElement(LoaderCircle, { className: "animate-spin" }),
    );
    expect(loader).not.toContain("data-ui-icon-artwork");
    expect(loader).toContain("animate-spin");
    expect(loader).toContain('stroke="currentColor"');
  });

  it("lets a platform context fully override the desktop default", () => {
    configureDefaultIconArtwork(desktopIconArtwork);
    const html = renderToStaticMarkup(
      createElement(
        IconArtworkContext.Provider,
        { value: {} },
        createElement(Plus),
      ),
    );
    expect(html).not.toContain("data-ui-icon-artwork");
    expect(html).toContain('stroke="currentColor"');
  });

  it("preserves size, color, accessible labels and SVG children", () => {
    configureDefaultIconArtwork(desktopIconArtwork);
    const html = renderToStaticMarkup(
      createElement(
        Plus,
        {
          size: 18,
          color: "tomato",
          className: "toolbar-add",
          "aria-label": "Add",
          absoluteStrokeWidth: true,
        },
        createElement("title", null, "Add"),
      ),
    );
    expect(html).toContain('width="18" height="18"');
    expect(html).toContain('color="tomato"');
    expect(html).toContain('class="toolbar-add"');
    expect(html).toContain('aria-label="Add"');
    expect(html).not.toContain('aria-hidden="true"');
    expect(html).not.toContain("absoluteStrokeWidth");
    expect(html).toContain("<title>Add</title>");
  });

  it("preserves the fill prop used to toggle favorite state", () => {
    configureDefaultIconArtwork(desktopIconArtwork);
    for (const fill of ["none", "currentColor"]) {
      const html = renderToStaticMarkup(createElement(Star, { fill }));
      expect(html.slice(0, html.indexOf(">"))).toContain(`fill="${fill}"`);
      expect(html).toContain('data-ui-icon-artwork=""');
    }
  });
});
