export const BUILD_VERSION_TIME_ZONE = "America/Los_Angeles";

/** Human-readable build date; independent of the viewer/builder's local zone. */
export function formatBuildDate(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUILD_VERSION_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value;
  return `${value("month")}-${value("day")}-${value("hour")}${value("minute")}`;
}

/** Keep native SemVer for update comparisons; show LAN timestamps as dates. */
export function formatBuildVersion(version: string): string {
  const match = /^\d+\.\d+\.\d+-lan\.(\d{13})$/.exec(version);
  return match ? formatBuildDate(Number(match[1])) : version;
}
