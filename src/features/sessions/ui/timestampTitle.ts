const titles = new Map<string, string>();
const MAX_TITLES = 512;

/** Preserve native full-date formatting, including runtime time-zone changes. */
export function timestampTitle(epochMs: number, language: string): string {
  const date = new Date(epochMs);
  // The local civil time and zone name change when the system zone changes.
  // Caching only by epoch/locale, or retaining a default-zone Intl formatter,
  // would keep the old zone alive. toString is locale-independent and avoids
  // constructing an Intl formatter on every render of an unchanged timestamp.
  const key = `${language}\0${epochMs}\0${date.toString()}`;
  const cached = titles.get(key);
  if (cached !== undefined) return cached;
  const title = date.toLocaleString(language);
  if (titles.size >= MAX_TITLES) titles.delete(titles.keys().next().value!);
  titles.set(key, title);
  return title;
}
