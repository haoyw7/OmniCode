import { useTranslation } from "../../../shared/i18n/useTranslation";
import { CopyTurnButton } from "../../sessions/ui/CopyTurnButton";

export function BotMessageTime({
  createdAt,
  className,
}: {
  createdAt: number;
  className?: string;
}) {
  const { language } = useTranslation();
  const date = new Date(createdAt);
  return (
    <time
      className={className}
      dateTime={date.toISOString()}
      title={date.toLocaleString(language)}
    >
      {date.toLocaleTimeString(language, {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </time>
  );
}

export function BotMessageMeta({
  text,
  createdAt,
  read,
  mobile = false,
}: {
  text: string;
  createdAt: number;
  read?: boolean;
  mobile?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="assistant-message-meta">
      <BotMessageTime createdAt={createdAt} />
      {read !== undefined && (
        <span className="assistant-read-state" data-read={read}>
          {t(read ? "Read" : "Unread")}
        </span>
      )}
      {!mobile && text && (
        <CopyTurnButton text={text} label={t("Copy message")} />
      )}
    </div>
  );
}
