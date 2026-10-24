import bundledChangelog from "../../../CHANGELOG.md?raw";
import { formatBuildVersion } from "./buildVersion";
import { getUiLanguage, translate } from "../i18n/language";

export type ReleaseNotesTabSource = {
  version: string;
};

export type ReleaseNotesDocument = {
  source: ReleaseNotesTabSource;
  markdown: string;
};

export function releaseNotesTitle(version: string): string {
  return translate("What's new in OmniCode {version}", {
    version: formatBuildVersion(version),
  });
}

/** The same bilingual Markdown serves GitHub, updater feeds and bundled notes. */
export function localizedReleaseNotes(
  markdown: string,
  language: string = getUiLanguage(),
): string {
  const blocks =
    /<!-- release-notes:(en|zh-CN) -->\r?\n([\s\S]*?)<!-- \/release-notes -->/g;
  const locales = new Set(
    [...markdown.matchAll(blocks)].map((match) => match[1]),
  );
  if (!locales.size) return markdown;
  const selected = locales.has(language)
    ? language
    : locales.has("en")
      ? "en"
      : "zh-CN";
  return markdown
    .replace(blocks, (_block, locale: string, body: string) =>
      locale === selected ? body.trim() : "",
    )
    .trim();
}

export function releaseNotesForVersion(
  version: string,
  changelog: string = bundledChangelog,
  language: string = getUiLanguage(),
): ReleaseNotesDocument | null {
  const normalized = version.trim();
  if (!normalized || normalized === "Unreleased") return null;

  const escapedVersion = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(
    `^## \\[${escapedVersion}\\](?: - \\d{4}-\\d{2}-\\d{2})?\\r?$`,
    "gm",
  );
  const match = heading.exec(changelog);
  if (!match) return null;

  const nextHeading = /^## /gm;
  nextHeading.lastIndex = match.index + match[0].length;
  const next = nextHeading.exec(changelog);
  const markdown = localizedReleaseNotes(
    changelog.slice(match.index, next?.index).trimEnd(),
    language,
  );

  return {
    source: { version: normalized },
    markdown,
  };
}

export function releaseNotesMarkdown(
  source: ReleaseNotesTabSource,
  changelog: string = bundledChangelog,
  language: string = getUiLanguage(),
): string | null {
  return (
    releaseNotesForVersion(source.version, changelog, language)?.markdown ??
    null
  );
}

export type ReleaseNotesPresentation = {
  version: string;
  date: string | null;
  markdown: string;
};

/** Changelog body for the What's new modal: version heading lives in the chrome. */
export function presentReleaseNotes(
  version: string,
  changelog: string = bundledChangelog,
  language: string = getUiLanguage(),
): ReleaseNotesPresentation | null {
  const release = releaseNotesForVersion(version, changelog, language);
  if (!release) return null;

  const escapedVersion = release.source.version.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const heading = new RegExp(
    `^## \\[${escapedVersion}\\](?: - (\\d{4}-\\d{2}-\\d{2}))?\\r?\\n*`,
  );
  const match = heading.exec(release.markdown);

  return {
    version: release.source.version,
    date: match?.[1] ?? null,
    markdown: match
      ? release.markdown.slice(match[0].length).trimStart()
      : release.markdown,
  };
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function formatReleaseDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return iso;
  return `${Number(match[3])} ${month} ${match[1]}`;
}

/** Keep the publication's calendar date, without shifting it across time zones. */
export function formatUpdateReleaseDate(
  iso: string,
  language: string,
): string | null {
  const day = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(day);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== day
  )
    return null;
  return new Intl.DateTimeFormat(language, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
