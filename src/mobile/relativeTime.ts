import {
  getUiLanguage,
  translate,
  type UiLanguage,
} from "../shared/i18n/language";

const formatters = new Map<UiLanguage, Intl.RelativeTimeFormat>();

export function formatMobileRelativeTime(
  timestamp: number,
  now = Date.now(),
  language = getUiLanguage(),
): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(now))
    return "—";
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes === 0) return translate("Just now", undefined, language);
  const [amount, unit]: [number, Intl.RelativeTimeFormatUnit] =
    minutes < 60
      ? [minutes, "minute"]
      : minutes < 1440
        ? [Math.floor(minutes / 60), "hour"]
        : [Math.floor(minutes / 1440), "day"];
  let formatter = formatters.get(language);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(language, { numeric: "always" });
    formatters.set(language, formatter);
  }
  return formatter.format(-amount, unit);
}
