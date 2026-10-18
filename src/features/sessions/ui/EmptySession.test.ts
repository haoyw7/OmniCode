import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptySession } from "./EmptySession";

describe("empty session", () => {
  it("renders the project greeting and composer", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptySession, {
        cwd: "/work/demo",
        composer: createElement("textarea", { "aria-label": "Message" }),
      }),
    );

    expect(markup).toContain("What should we work on in demo?");
    expect(markup).toContain('aria-label="Message"');
  });

  it("leaves the surface empty when the composer is docked elsewhere", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptySession, {
        cwd: "/work/demo",
      }),
    );

    expect(markup).not.toContain("<h1");
  });
});
