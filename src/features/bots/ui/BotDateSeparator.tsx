import { useTranslation } from "../../../shared/i18n/useTranslation";

const CONVERSATION_GAP_MS = 5 * 60_000;

export function BotDateSeparator({
  createdAt,
  previousCreatedAt,
}: {
  createdAt: number;
  previousCreatedAt?: number;
}) {
  const { language } = useTranslation();
  if (
    previousCreatedAt !== undefined &&
    createdAt - previousCreatedAt < CONVERSATION_GAP_MS
  )
    return null;
  const date = new Date(createdAt);
  return (
    <time
      className="assistant-date-separator"
      dateTime={date.toISOString()}
      title={date.toLocaleString(language)}
    >
      {date.toLocaleString(language, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })}
    </time>
  );
}
