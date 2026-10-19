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
  method: "stream-observed",
  scope: "turn",
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
  expect(markup).toContain("Estimated turn TPS 0.33 tok/s");
  expect(markup).toContain("excludes initial waits and tool execution");
});
it("keeps older request totals distinct from generation TPS", () => {
  setUiLanguage("en");
  const result = render({ generationSample: { ...sample, method: "request-total" } });
  expect(result).toContain("Request throughput 0.33 tok/s");
  expect(result).toContain("Total output tokens ÷ total LLM request time");
  expect(result).not.toContain("TPS");
});
it("shows very small positive rates", () => {
  setUiLanguage("en");
  expect(render({ generationSample: { ...sample, outputTokens: 1 } })).toContain("<0.01 tok/s");
});
it("identifies text-estimated token counts instead of claiming provider usage", () => {
  setUiLanguage("en");
  expect(render({ generationSample: { ...sample, tokenSource: "text-estimate", estimator: "text-heuristic-v1" } }))
    .toContain("Tokens estimated from streamed text; provider output usage unavailable");
  setUiLanguage("zh-CN");
  expect(render({ generationSample: { ...sample, tokenSource: "text-estimate", estimator: "text-heuristic-v1" } }))
    .toContain("token 按流式文本估算");
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
  expect(render(metrics)).toContain("本轮估算 TPS 0.33 tok/s");
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
  expect(mobile).toContain("本轮估算 TPS 0.33 tok/s");
  expect(mobile).toContain("不含首段等待和工具执行");
});
