import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { setUiLanguage } from "../../shared/i18n/language";
import { WhatsNewBody } from "./WhatsNewDialog";

describe("WhatsNewBody", () => {
  beforeAll(() => setUiLanguage("en"));

  it("renders the version notes without the changelog heading", () => {
    const markup = renderToStaticMarkup(
      createElement(WhatsNewBody, { version: "0.1.25" }),
    );

    expect(markup).toContain("whats-new-md");
    expect(markup).toContain("What&#x27;s new in OmniCode 0.1.25");
    expect(markup).not.toContain("## [0.1.25]");
  });
});
