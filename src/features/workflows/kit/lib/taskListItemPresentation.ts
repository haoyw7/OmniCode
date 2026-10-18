// Relative time for run rows (ZCode's task list wording).
export function formatTaskRelativeTime(timestamp: number, intl: { formatMessage: (descriptor: { id: string }, values?: Record<string, string>) => string }): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return intl.formatMessage({ id: "sidePane.time.justNow" });
  if (minutes < 60) return intl.formatMessage({ id: "sidePane.time.minutesAgo" }, { count: String(minutes) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return intl.formatMessage({ id: "sidePane.time.hoursAgo" }, { count: String(hours) });
  return intl.formatMessage({ id: "sidePane.time.daysAgo" }, { count: String(Math.floor(hours / 24)) });
}
