import { describe, expect, it } from "vitest";
import {
  formatReleaseDate,
  formatUpdateReleaseDate,
  localizedReleaseNotes,
  presentReleaseNotes,
  releaseNotesForVersion,
  releaseNotesMarkdown,
  releaseNotesTitle,
} from "./releaseNotes";

const fixture = `# Changelog

## [Unreleased]

### Added
- Future work.

## [0.1.3] - 2026-09-01

### Fixed
- Newer fix.

## [0.1.2] - 2026-08-31

### Added
- Requested feature.

## [0.1.1]

### Fixed
- Older fix.
`;

const bilingual = `## [0.11.0] - 2026-10-09

<!-- release-notes:en -->
### Fixed
- English update.
<!-- /release-notes -->

<!-- release-notes:zh-CN -->
### 修复
- 中文更新。
<!-- /release-notes -->
`;

describe("localized release notes", () => {
  it.each([
    ["en", "English update.", "中文更新。"],
    ["zh-CN", "中文更新。", "English update."],
  ])("selects %s in bundled and feed notes", (language, included, excluded) => {
    const notes = presentReleaseNotes("0.11.0", bilingual, language);
    expect(notes?.date).toBe("2026-10-09");
    expect(notes?.markdown).toContain(included);
    expect(notes?.markdown).not.toContain(excluded);
    expect(notes?.markdown).not.toContain("release-notes:");
    expect(notes?.markdown).not.toContain("## [0.11.0]");
    expect(
      releaseNotesMarkdown({ version: "0.11.0" }, bilingual, language),
    ).toContain(included);
    expect(
      presentReleaseNotes("0.11.0", undefined, language)?.markdown,
    ).toContain(language === "en" ? "### Fixed" : "### 修复");
  });

  it("keeps old unmarked notes and falls back to English when a locale is absent", () => {
    expect(localizedReleaseNotes(fixture, "zh-CN")).toBe(fixture);
    expect(localizedReleaseNotes(bilingual, "fr")).toContain("English update.");
    expect(localizedReleaseNotes(bilingual, "fr")).not.toContain("中文更新。");
    expect(
      localizedReleaseNotes(
        "Shared\n<!-- release-notes:en -->\nOnly English\n<!-- /release-notes -->\nEnd",
        "zh-CN",
      ),
    ).toBe("Shared\nOnly English\nEnd");
  });
});

describe("releaseNotesForVersion", () => {
  it("extracts only the requested release", () => {
    const release = releaseNotesForVersion("0.1.2", fixture);

    expect(release?.source).toEqual({ version: "0.1.2" });
    expect(releaseNotesTitle(release!.source.version)).toBe(
      "What's new in OmniCode 0.1.2",
    );
    expect(release?.markdown).toContain("## [0.1.2]");
    expect(release?.markdown).not.toContain("## [0.1.3]");
    expect(release?.markdown).not.toContain("## [0.1.1]");
  });

  it.each(["", "   ", "Unreleased", "9.9.9"])(
    "returns null for unavailable version %j",
    (version) => {
      expect(releaseNotesForVersion(version, fixture)).toBeNull();
    },
  );

  it("requires the heading to occupy the complete line", () => {
    const malformed = `## Prefix [0.1.2]\nNo.\n\n## [0.1.2] soon\nStill no.`;
    expect(releaseNotesForVersion("0.1.2", malformed)).toBeNull();
  });

  it.each(["## [0.1.2]\n\nUndated.", "## [0.1.2] - 2026-08-31\n\nDated."])(
    "accepts supported heading %j",
    (changelog) => {
      expect(releaseNotesForVersion("0.1.2", changelog)?.markdown).toBe(
        changelog,
      );
    },
  );

  it("extracts the final release through the end of the changelog", () => {
    const release = releaseNotesForVersion("0.1.1", fixture);
    expect(release?.markdown).toContain("Older fix.");
  });

  it("escapes the requested version before matching", () => {
    expect(
      releaseNotesForVersion("0.1.2+test", "## [0.1.2+test]\n\nExact."),
    ).toEqual({
      source: { version: "0.1.2+test" },
      markdown: "## [0.1.2+test]\n\nExact.",
    });
  });
});

describe("releaseNotesMarkdown", () => {
  it("resolves a stored source against the bundled changelog shape", () => {
    const release = releaseNotesForVersion("0.1.2", fixture);
    expect(releaseNotesMarkdown(release!.source, fixture)).toBe(
      release?.markdown,
    );
  });
});

describe("presentReleaseNotes", () => {
  it("drops the version heading and keeps the dated body", () => {
    expect(presentReleaseNotes("0.1.2", fixture)).toEqual({
      version: "0.1.2",
      date: "2026-08-31",
      markdown: "### Added\n- Requested feature.",
    });
  });

  it("keeps undated releases without a date", () => {
    expect(presentReleaseNotes("0.1.1", fixture)).toEqual({
      version: "0.1.1",
      date: null,
      markdown: "### Fixed\n- Older fix.",
    });
  });

  it("returns null when the version is missing", () => {
    expect(presentReleaseNotes("9.9.9", fixture)).toBeNull();
  });
});

describe("formatReleaseDate", () => {
  it("formats a changelog ISO date", () => {
    expect(formatReleaseDate("2026-09-01")).toBe("1 Sep 2026");
  });

  it.each(["soon", "2026-13-01", "2026-09-1"])(
    "leaves invalid date %j alone",
    (value) => {
      expect(formatReleaseDate(value)).toBe(value);
    },
  );
});

describe("formatUpdateReleaseDate", () => {
  it("localizes publication dates without shifting UTC midnight to the previous day", () => {
    expect(formatUpdateReleaseDate("2026-09-30T00:00:00Z", "zh-CN")).toBe(
      "2026年9月30日",
    );
    expect(formatUpdateReleaseDate("2026-09-30", "en")).toBe(
      "September 30, 2026",
    );
  });

  it.each(["soon", "2026-13-01", "2026-02-30", "2026-09-1"])(
    "omits invalid date %j",
    (date) => {
      expect(formatUpdateReleaseDate(date, "zh-CN")).toBeNull();
    },
  );
});
