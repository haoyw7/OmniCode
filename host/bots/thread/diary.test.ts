import { expect, it } from "vitest";
import { diaryBrief, dueDiaryDays } from "./diary";

it("waits a few hours into the next local day before a day is due", () => {
  expect(dueDiaryDays(Date.UTC(2026, 9, 9, 3), "UTC")).toEqual([
    "2026-10-05",
    "2026-10-06",
    "2026-10-07",
  ]);
  expect(dueDiaryDays(Date.UTC(2026, 9, 9, 5), "UTC").at(-1)).toBe("2026-10-08");
  // 05:00 in Shanghai is still the previous UTC day.
  expect(dueDiaryDays(Date.UTC(2026, 9, 8, 21), "Asia/Shanghai").at(-1)).toBe(
    "2026-10-08",
  );
});

it("briefs a fresh brain with the newest current diary entries", () => {
  const old = `- 2026-09-01 · 2026-08-31: ${"旧".repeat(3_000)}`;
  expect(
    diaryBrief(
      [
        "# chat-days",
        old,
        "- ~~2026-10-07 · 2026-10-06: superseded~~",
        "- 2026-10-08 · 2026-10-07: 用户点了《读心术》。",
      ].join("\n"),
    ),
  ).toBe("- 2026-10-08 · 2026-10-07: 用户点了《读心术》。");
});
