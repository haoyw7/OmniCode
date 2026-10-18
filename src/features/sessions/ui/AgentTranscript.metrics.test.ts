// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TurnMetricsBadge } from "./transcript/TurnMetrics";
import { setUiLanguage } from "../../../shared/i18n/language";
import type { GenerationSample } from "../model/generationSample";
import type { TurnMetrics } from "../model/session";
import { TranscriptPlatformContext } from "./TranscriptPlatform";
const sample: GenerationSample = {
  outputTokens: 76,
  durationMs: 227_000,
  tokenSource: "provider",
  method: "stream-estimate",
  scope: "last-text-segment",
};
function markup(element: ReactElement) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  const root = createRoot(node);
  act(() => root.render(element));
  const result = node.innerHTML;
  act(() => root.unmount());
  return result;
}
function render(metrics: TurnMetrics) {
  return markup(createElement(TurnMetricsBadge, { metrics }));
}
afterEach(() => {
  setUiLanguage("en");
  vi.unstubAllGlobals();
});
it("shows a fractional speed without using whole-turn elapsed time", () => {
  setUiLanguage("en");
  const markup = render({ generationSample: sample });
  expect(markup).toContain("0.33 tok/s");
  expect(markup).toContain("Provider-reported tokens");
});
it("shows text-only estimated samples and very small positive rates", () => {
  setUiLanguage("en");
  expect(
    render({
      generationSample: {
        ...sample,
        outputTokens: 1,
        tokenSource: "text-estimate",
        estimator: "text-heuristic-v1",
      },
    }),
  ).toContain("<0.01 tok/s");
  expect(
    render({
      generationSample: {
        ...sample,
        tokenSource: "text-estimate",
        estimator: "text-heuristic-v1",
      },
    }),
  ).toContain("Text tokens");
});
it("does not invent a speed for history or malformed samples", () => {
  setUiLanguage("en");
  expect(render({ outputTokens: 76 })).toContain("Generation rate unavailable");
  expect(render({ outputTokens: 76 })).not.toContain("tok/s");
  expect(render({ generationSample: { ...sample, durationMs: 0 } })).toContain(
    "Generation rate unavailable",
  );
  expect(render({ generationSample: null })).toContain(
    "Generation rate unavailable",
  );
});
it("localizes the shared desktop/mobile badge", () => {
  setUiLanguage("zh-CN");
  const metrics = { generationSample: sample };
  expect(render(metrics)).toContain("正文生成 0.33 tok/s");
  const mobile = markup(
    createElement(
      TranscriptPlatformContext.Provider,
      {
        value: {
          localFiles: false,
          copyText: async () => {},
          copyMessage: async () => {},
          openExternal: async () => {},
          readBinaryFile: async () => new Uint8Array(),
        },
      },
      createElement(TurnMetricsBadge, { metrics }),
    ),
  );
  expect(mobile).toContain("正文生成 0.33 tok/s");
});
