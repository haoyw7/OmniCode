import { describe, expect, it } from "vitest";
import { formatBuildDate, formatBuildVersion } from "./buildVersion";

describe("build version dates", () => {
  it("formats the agreed month-day-time in the build timezone", () => {
    const timestamp = Date.parse("2026-10-07T15:40:00Z");
    expect(formatBuildDate(timestamp)).toBe("10-07-0840");
    expect(formatBuildVersion(`0.7.1-lan.${timestamp}`)).toBe("10-07-0840");
  });

  it("uses midnight as 0000 and handles winter and year boundaries", () => {
    expect(formatBuildDate(Date.parse("2026-10-07T07:00:00Z"))).toBe(
      "10-07-0000",
    );
    expect(formatBuildDate(Date.parse("2027-01-01T07:59:00Z"))).toBe(
      "12-31-2359",
    );
    expect(formatBuildDate(Date.parse("2027-01-01T08:00:00Z"))).toBe(
      "01-01-0000",
    );
  });

  it("preserves regular versions and historical short LAN counters", () => {
    for (const version of ["0.7.0", "0.7.1-lan.123", "10-07-0840", "…"])
      expect(formatBuildVersion(version)).toBe(version);
  });
});
