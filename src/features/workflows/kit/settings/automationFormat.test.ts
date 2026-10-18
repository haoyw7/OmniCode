// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { setUiLanguage, type UiLanguage } from "../../../../shared/i18n/language";
import { workflowIntl } from "../i18n/IntlProvider";
import { formatRelativeToNow } from "./automationFormat";

afterEach(() => {
  setUiLanguage("en");
  localStorage.clear();
});

const now = Date.UTC(2026, 9, 13, 12);
const cases: [number, string, string][] = [
  [-1, "just now", "刚刚"],
  [1, "soon", "即将"],
  [-120_000, "2m ago", "2 分钟前"],
  [120_000, "in 2m", "2 分钟后"],
  [-7_200_000, "2h ago", "2 小时前"],
  [7_200_000, "in 2h", "2 小时后"],
  [-172_800_000, "2d ago", "2 天前"],
  [172_800_000, "in 2d", "2 天后"],
];

describe.each<UiLanguage>(["en", "zh-CN"])("workflow relative time in %s", language => {
  it.each(cases)("resolves message IDs and interpolates the time offset %d", (offset, english, chinese) => {
    setUiLanguage(language);
    expect(formatRelativeToNow(now + offset, now, workflowIntl)).toBe(language === "en" ? english : chinese);
  });
});
