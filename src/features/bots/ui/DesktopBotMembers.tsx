import type { BotView } from "../model/bots";
import { useTranslation } from "../../../shared/i18n/useTranslation";

export function DesktopBotMembers({ bots, ids, onChange, ordered = false, disabled = false }: {
  bots: BotView[]; ids: string[]; onChange: (ids: string[]) => void; ordered?: boolean; disabled?: boolean;
}) {
  const { t } = useTranslation();
  const choices = bots.filter(bot => !bot.archivedAt || ids.includes(bot.id));
  const name = (id: string) => bots.find(bot => bot.id === id)?.name ?? t("Unavailable Bot");
  const move = (index: number, direction: number) => {
    const next = [...ids]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; onChange(next);
  };
  return <fieldset className="desktop-bot-members" disabled={disabled}>
    <legend>{t("Members")}</legend>
    <div className="desktop-bot-member-options">{[...new Set([...choices.map(bot => bot.id), ...ids])].map(id => <label key={id}>
      <input data-ui="checkbox" type="checkbox" checked={ids.includes(id)} onChange={event => onChange(event.target.checked ? [...ids, id] : ids.filter(value => value !== id))} />{name(id)}
    </label>)}</div>
    {ordered && <><strong>{t("Speaking order")}</strong><ol>{ids.map((id, index) => <li key={id}><span>{name(id)}</span>
      <button type="button" disabled={disabled || index === 0} aria-label={`${t("Move up")}: ${name(id)}`} onClick={() => move(index, -1)}>{t("Move up")}</button>
      <button type="button" disabled={disabled || index === ids.length - 1} aria-label={`${t("Move down")}: ${name(id)}`} onClick={() => move(index, 1)}>{t("Move down")}</button>
    </li>)}</ol></>}
  </fieldset>;
}
