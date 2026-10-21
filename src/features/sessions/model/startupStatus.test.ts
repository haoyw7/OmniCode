import { expect, it } from "vitest";
import { parseStartupProgress } from "../../../integrations/harness/core/startupProgress";
import { translate } from "../../../shared/i18n/language";
import { startupProgressText } from "./startupStatus";

const t = (key: string, values?: Record<string, string | number>) => translate(key, values, "en");

it("shows measured bytes without inventing a percentage when the total is unknown", () => {
  expect(startupProgressText({ stage: "downloading", completed: 2048, unit: "bytes" }, t)).toBe("2.0 KiB");
  expect(startupProgressText({ stage: "copying", completed: 1024, total: 2048, unit: "bytes" }, t)).toBe("1.0 KiB / 2.0 KiB (50%)");
});

it("localizes npm counters without treating processed packages as a known install total", () => {
  expect(startupProgressText({ stage: "installing-dependencies", completed: 3, downloaded: 2, unit: "packages" },
    (key, values) => translate(key, values, "zh-CN"))).toBe("已下载 2 个包 · 已处理 3 个包");
});

it("ignores malformed remote startup data", () => {
  for (const value of [{ stage: "unknown" }, { stage: "copying", completed: -1 },
    { stage: "copying", completed: 20, total: 10 }, { stage: "copying", completed: NaN },
    { stage: "copying", total: 0 }, { stage: "copying", unit: "secret-path" }]) {
    expect(parseStartupProgress(value)).toBeUndefined();
    expect(startupProgressText(value, t)).toBeUndefined();
  }
});
